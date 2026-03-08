import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

from app.config import settings
from app.models.chat import ChatRequest, ModelTier
from app.services.ai_router import stream_chat_response, stream_chat_response_with_thinking
from app.services.routed_llm import (
    classify_task, gather_model_responses, stream_synthesis, build_attribution,
    TASK_ROUTING, MODEL_DISPLAY_NAMES, MAX_ROUTED_MODELS,
    should_escalate_deep_think, gather_deep_think_responses,
)
import app.services.db as db

router = APIRouter()

STUDENT_SYSTEM_PROMPT = """You are Fluxnote, a general-purpose AI assistant built for students.

CORE IDENTITY
You are as capable as a standard ChatGPT — students can ask you about studies, productivity, life, tech, writing, or any general topic. You also have "assignment intelligence": when a student is working on an assignment, you shift into a focused, document-grounded mode.

TONE
Friendly, clear, and practical. Default to concise answers — if the student wants more, they'll ask. Avoid sounding robotic. Skip unnecessary disclaimers. For math, use LaTeX notation (e.g. $P = mx + b$, $\\frac{d}{dx}$) — it renders correctly in this app.

CONTEXT YOU MAY RECEIVE
You may be given any combination of:
1. A dashboard manifest listing all the student's assignments (title, module, due date, type, status)
2. A retrieved assignment block — full details and document text for a specific assignment, fetched automatically when the student references it
3. Full extracted text from manually uploaded documents
4. Conversation history
If document text conflicts with card summary fields, document text takes priority.

GROUNDING RULES — FOLLOW STRICTLY
- Never invent assignment requirements, due dates, word counts, topic lists, penalties, or source restrictions.
- When asked for specific details, look first in the retrieved document text, then in the card fields.
- If the information is not found in either, say exactly: "Not stated in the uploaded document."
- Never tell the student to check Brightspace, Canvas, Moodle, or any LMS if the information exists in the uploaded file. Only suggest checking external sources when the information is genuinely absent from the document.

ASSIGNMENT MODE
When the student references an assignment or is clearly working on one:
1. Identify which assignment (use title/module, or ask once if genuinely ambiguous).
2. Answer their question directly, citing the document where relevant.
3. Offer one useful next step: "Want me to outline your essay?" / "Want a step-by-step plan?" / "Want help choosing a topic?"

AI USAGE POLICY
If the document explicitly restricts AI use (e.g. "brainstorming only"), comply:
- Help with brainstorming, outlining, planning, feedback, and citations.
- Do not produce a full submission that violates the stated policy.
If no policy is stated, assist fully while encouraging the student's own thinking.

OUTPUT FORMAT
- Use bullet points and short sections when listing constraints, steps, or options.
- For checklists, use numbered actionable steps.
- When listing topic options from a document, reproduce them verbatim as bullets.

GENERAL CHAT
For non-assignment questions, respond like a normal helpful assistant. Be supportive for personal questions, practical for technical ones.

INTEGRITY
Do not assist with plagiarism evasion, AI-detection bypassing, or rule-dodging. Help students learn and write in their own voice."""

CHAT_FILE_CONTEXT_LIMIT = 40_000   # chars — total budget for explicitly uploaded files
RESOLVED_DOC_LIMIT      = 20_000   # chars per file for on-demand resolved assignments

# ── Manifest entry regex ────────────────────────────────────────────────────
# Matches lines like:  #1 [id:abc-123] Title | Module | Due: ... | ...
_MANIFEST_ENTRY_RE = re.compile(
    r'#\d+\s+\[id:([a-f0-9\-]+)\]\s+(.*?)(?:\n|$)',
    re.IGNORECASE,
)

# Words too generic for title matching
_STOP_WORDS = {
    'with', 'from', 'that', 'this', 'have', 'your', 'their', 'about',
    'what', 'the', 'and', 'for', 'not', 'but', 'more', 'some',
    'tell', 'give', 'show', 'need', 'want', 'like', 'just', 'also',
    'can', 'will', 'how', 'when', 'where', 'which', 'its', 'our',
}

# Words that indicate the user wants to work with / understand an assignment
_WORK_REQUEST_WORDS = {
    'help', 'assist', 'explain', 'understand', 'summarize', 'summary',
    'outline', 'write', 'draft', 'structure', 'format', 'detail', 'details',
    'requirement', 'requirements', 'instruction', 'instructions',
    'topic', 'topics', 'penalty', 'penalties', 'source', 'sources',
    'citation', 'citations', 'word', 'count', 'submit', 'submission',
    'marks', 'grade', 'grades', 'criteria', 'rubric', 'document',
    'essay', 'report', 'project', 'paper', 'coursework', 'task',
    'deadline', 'content', 'review', 'analyse', 'analyze', 'read',
    'start', 'begin', 'approach', 'plan', 'prepare', 'study',
}


def _match_assignment_id(message: str, manifest: str) -> str | None:
    """
    Tiered assignment resolution against the dashboard manifest.
      Tier 1 — explicit UUID found in message
      Tier 2 — module code match (e.g. "COMP301", "ENG101")
      Tier 3a — strong title overlap (≥2 words, long distinctive word, or all title words)
      Tier 3b — weak title overlap (1 title word + work-request context signal)
      Tier 4  — single-assignment fallback (only 1 assignment + work-request context)
    Returns the matched assignment_id string, or None.
    """
    lower = message.lower()
    entries: list[dict] = []

    for m in _MANIFEST_ENTRY_RE.finditer(manifest):
        aid  = m.group(1)
        rest = m.group(2)
        parts  = [p.strip() for p in rest.split('|')]
        title  = parts[0].lower() if parts else ''
        module = parts[1].lower() if len(parts) > 1 else ''
        entries.append({'id': aid, 'title': title, 'module': module})

    if not entries:
        return None

    msg_words   = set(re.split(r'\W+', lower)) - {''}
    has_context = bool(msg_words & _WORK_REQUEST_WORDS)

    # Tier 1 — explicit assignment ID in message
    for e in entries:
        if e['id'] in message:
            return e['id']

    # Tier 2 — module code (min 3 chars, e.g. "MKT101")
    for e in entries:
        mod = e['module']
        if mod and len(mod) >= 3 and mod in lower:
            return e['id']

    # Tier 3 — title keyword overlap
    scored: list[tuple[int, str]] = []
    for e in entries:
        words = [
            w for w in re.split(r'\W+', e['title'])
            if len(w) >= 4 and w not in _STOP_WORDS
        ]
        if not words:
            continue
        hits     = sum(1 for w in words if w in lower)
        long_hit = any(len(w) >= 8 and w in lower for w in words)
        all_hit  = hits == len(words) and len(words) >= 1

        # Tier 3a — strong match: high confidence, no context required
        if hits >= 2 or long_hit or all_hit:
            scored.append((hits + 10, e['id']))
        # Tier 3b — weak match: 1 title word visible + message implies working on assignment
        elif hits == 1 and has_context:
            scored.append((hits, e['id']))

    if len(scored) == 1:
        return scored[0][1]
    if len(scored) > 1:
        scored.sort(key=lambda x: x[0], reverse=True)
        if scored[0][0] > scored[1][0]:   # unambiguous winner
            return scored[0][1]

    # Tier 4 — single-assignment fallback: only 1 assignment and message implies working on it
    if len(entries) == 1 and has_context:
        return entries[0]['id']

    return None


async def resolve_assignment_context(
    message: str,
    manifest: str | None,
    workspace_id: str | None,
    already_has_files: bool,
) -> str:
    """
    On-demand context resolver (Approach C — smart intent detection + injection).

    If the user's message references a specific assignment and no file context is
    already loaded, fetches that assignment's full metadata and document text and
    returns it as a formatted context block ready for injection.

    Returns empty string when: no manifest, no workspace, file context already
    set (Ask AI flow), or no clear assignment match found.
    """
    if already_has_files or not workspace_id or not manifest:
        return ""

    matched_id = _match_assignment_id(message, manifest)
    if not matched_id:
        return ""

    try:
        a_resp = await (
            db.table("assignments")
            .select(
                "title, filename, module, due_date, weightage, assignment_type, "
                "deliverable_type, summary, checklist, constraints, file_ids, file_id"
            )
            .eq("id", matched_id)
            .eq("session_id", workspace_id)
            .execute()
        )
        if not a_resp.data:
            return ""

        a = a_resp.data[0]
        parts = [
            f"[RETRIEVED ASSIGNMENT: {a.get('title') or a.get('filename') or 'Untitled'}]",
            f"Module: {a.get('module') or 'Not stated'}",
            f"Due: {a.get('due_date') or 'Not stated'}",
            f"Weightage: {a.get('weightage') or 'Not stated'}",
            f"Type: {a.get('assignment_type') or 'Not stated'}",
            f"Deliverable: {a.get('deliverable_type') or 'Not stated'}",
        ]
        if a.get('summary'):
            parts.append("Summary:\n" + '\n'.join(f"  • {s}" for s in a['summary']))
        if a.get('checklist'):
            parts.append("Checklist:\n" + '\n'.join(f"  • {c}" for c in a['checklist']))
        if a.get('constraints'):
            parts.append(f"Requirements & Constraints:\n{a['constraints']}")

        # Fetch extracted document text
        file_ids = a.get('file_ids') or ([a['file_id']] if a.get('file_id') else [])
        if isinstance(file_ids, str):
            try:
                file_ids = json.loads(file_ids)
            except Exception:
                file_ids = []
        if file_ids:
            files_resp = await (
                db.table("files")
                .select("name, content")
                .in_("id", file_ids)
                .execute()
            )
            for f in (files_resp.data or []):
                if f.get('content'):
                    parts.append(
                        f"[Full Document: {f['name']}]\n{f['content'][:RESOLVED_DOC_LIMIT]}"
                    )

        return '\n\n'.join(parts)

    except Exception:
        return ""


# ── POST /message ──────────────────────────────────────────────────────────────

@router.post("/message")
async def post_message(request: ChatRequest):
    """Stream an AI response via SSE. Resolves assignment context on-demand,
    fetches history, prepends file context, saves messages, streams response."""

    # 1. Fetch conversation history
    history_resp = await (
        db.table("chat_messages")
        .select("role, content")
        .eq("session_id", request.session_id)
        .order("created_at", desc=False)
        .limit(20)
        .execute()
    )
    history: list[dict] = history_resp.data or []

    # 2. Fetch explicit file context (files attached via upload / Ask AI flow)
    file_context = ""
    if request.file_ids:
        files_resp = await (
            db.table("files")
            .select("name, content")
            .in_("id", request.file_ids)
            .execute()
        )
        active_files = [f for f in (files_resp.data or []) if f.get("content")]
        if active_files:
            per_file_limit = CHAT_FILE_CONTEXT_LIMIT // len(active_files)
            for file in active_files:
                file_context += f"\n\n[File: {file['name']}]\n{file['content'][:per_file_limit]}"

    # 3. Build system content
    system_content = STUDENT_SYSTEM_PROMPT
    if request.assignments_manifest:
        system_content += f"\n\n---\n{request.assignments_manifest}"

    # 4. Build base messages (history only — user message added inside stream after resolution)
    base_messages: list[dict] = [{"role": "system", "content": system_content}]
    base_messages += [
        {"role": row["role"], "content": row["content"]}
        for row in history
    ]

    # 5. Persist clean user message before streaming
    await (
        db.table("chat_messages")
        .insert({
            "id":         str(uuid.uuid4()),
            "session_id": request.session_id,
            "role":       "user",
            "content":    request.message,
            "model":      None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        .execute()
    )

    # 6. SSE generator
    async def event_stream() -> AsyncGenerator[str, None]:
        chunks: list[str] = []
        try:
            yield "data: " + json.dumps({"type": "start"}) + "\n\n"

            # ── On-demand context resolution ──────────────────────────────────
            # Detects if message references a specific assignment → fetches its
            # full details + doc text → injects into context before model call.
            # Skipped if: file context already set, no workspace_id, no manifest.
            resolved = await resolve_assignment_context(
                message=request.message,
                manifest=request.assignments_manifest,
                workspace_id=request.workspace_id,
                already_has_files=bool(request.file_ids),
            )

            extra        = ('\n\n' + resolved) if resolved else ''
            user_content = request.message + extra + file_context
            messages     = base_messages + [{"role": "user", "content": user_content}]

            # ── Model dispatch ────────────────────────────────────────────────
            if request.model == ModelTier.ROUTED:
                # Show routing progress to the client before any model is called
                yield "data: " + json.dumps({"type": "routing_status", "step": "classifying"}) + "\n\n"
                task_type = await classify_task(request.message)

                if task_type == "conversational":
                    usage_out_conv: dict = {}
                    async for chunk in stream_chat_response(messages, ModelTier.FAST, usage_out_conv):
                        chunks.append(chunk)
                        yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                    content_conv = "".join(chunks)
                    if not content_conv:
                        logger.warning("chat: conversational stream produced no content; skipping DB insert")
                        yield "data: " + json.dumps({"type": "error", "message": "AI returned an empty response. Please try again."}) + "\n\n"
                    else:
                        await (
                            db.table("chat_messages")
                            .insert({
                                "id":         str(uuid.uuid4()),
                                "session_id": request.session_id,
                                "role":       "assistant",
                                "content":    content_conv,
                                "model":      request.model.value,
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                            .execute()
                        )
                        yield "data: " + json.dumps({
                            "type":           "done",
                            "routed":         True,
                            "routed_simple":  True,
                            "total_tokens":   usage_out_conv.get("total_tokens", 0),
                        }) + "\n\n"

                else:
                    selected = TASK_ROUTING.get(task_type, TASK_ROUTING["general"])[:MAX_ROUTED_MODELS]
                    display_names = [MODEL_DISPLAY_NAMES.get(m, m) for m in selected]
                    yield "data: " + json.dumps({
                        "type": "routing_status", "step": "gathering",
                        "models": display_names, "task": task_type,
                    }) + "\n\n"

                    model_results = await gather_model_responses(messages, task_type)

                    yield "data: " + json.dumps({"type": "routing_status", "step": "synthesising"}) + "\n\n"

                    synthesis_usage: dict = {}
                    async for chunk in stream_synthesis(model_results, task_type, messages, synthesis_usage):
                        chunks.append(chunk)
                        yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                    attribution = build_attribution(model_results)
                    proposer_tokens = attribution["total_tokens"]
                    synthesis_tokens = synthesis_usage.get("total_tokens", 0)
                    content_routed = "".join(chunks)
                    if not content_routed:
                        logger.warning("chat: routed synthesis stream produced no content; skipping DB insert")
                        yield "data: " + json.dumps({"type": "error", "message": "AI returned an empty response. Please try again."}) + "\n\n"
                    else:
                        await (
                            db.table("chat_messages")
                            .insert({
                                "id":         str(uuid.uuid4()),
                                "session_id": request.session_id,
                                "role":       "assistant",
                                "content":    content_routed,
                                "model":      request.model.value,
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                            .execute()
                        )
                        yield "data: " + json.dumps({
                            "type":         "done",
                            "routed":       True,
                            "models_used":  attribution["models_used"],
                            "total_tokens": proposer_tokens + synthesis_tokens,
                        }) + "\n\n"

            elif request.model == ModelTier.DEEP_THINK and should_escalate_deep_think(request.message, user_content):
                # ── Deep Think escalated: parallel DeepSeek + Gemini ──────────
                dt_models = [settings.MODEL_DEEP_THINK, settings.MODEL_DEEP_THINK_SECONDARY]
                display_names = [MODEL_DISPLAY_NAMES.get(m, m) for m in dt_models]
                yield "data: " + json.dumps({
                    "type": "routing_status", "step": "gathering", "models": display_names
                }) + "\n\n"

                dt_results = await gather_deep_think_responses(messages)

                yield "data: " + json.dumps({"type": "routing_status", "step": "synthesising"}) + "\n\n"

                dt_synthesis_usage: dict = {}
                async for chunk in stream_synthesis(dt_results, "analysis", messages, dt_synthesis_usage):
                    chunks.append(chunk)
                    yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                attribution = build_attribution(dt_results)
                dt_proposer_tokens = attribution["total_tokens"]
                dt_synthesis_tokens = dt_synthesis_usage.get("total_tokens", 0)
                content_dt = "".join(chunks)
                if not content_dt:
                    logger.warning("chat: Deep Think stream produced no content; skipping DB insert")
                    yield "data: " + json.dumps({"type": "error", "message": "AI returned an empty response. Please try again."}) + "\n\n"
                else:
                    await (
                        db.table("chat_messages")
                        .insert({
                            "id":         str(uuid.uuid4()),
                            "session_id": request.session_id,
                            "role":       "assistant",
                            "content":    content_dt,
                            "model":      request.model.value,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        .execute()
                    )
                    yield "data: " + json.dumps({
                        "type":              "done",
                        "routed":            True,
                        "deep_think_escalated": True,
                        "models_used":       attribution["models_used"],
                        "total_tokens":      dt_proposer_tokens + dt_synthesis_tokens,
                    }) + "\n\n"

            else:
                usage_out: dict = {}

                if request.model == ModelTier.DEEP_THINK:
                    # Default Deep Think: DeepSeek V3.2 alone with thinking panel
                    async for item in stream_chat_response_with_thinking(messages, usage_out):
                        if item["type"] == "thinking":
                            yield "data: " + json.dumps({"type": "thinking_chunk", "content": item["text"]}) + "\n\n"
                        else:
                            chunks.append(item["text"])
                            yield "data: " + json.dumps({"type": "chunk", "content": item["text"]}) + "\n\n"
                else:
                    async for chunk in stream_chat_response(messages, request.model, usage_out):
                        chunks.append(chunk)
                        yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                content_single = "".join(chunks)
                if not content_single:
                    logger.warning("chat: single-model stream produced no content; skipping DB insert")
                    yield "data: " + json.dumps({"type": "error", "message": "AI returned an empty response. Please try again."}) + "\n\n"
                else:
                    await (
                        db.table("chat_messages")
                        .insert({
                            "id":         str(uuid.uuid4()),
                            "session_id": request.session_id,
                            "role":       "assistant",
                            "content":    content_single,
                            "model":      request.model.value,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        .execute()
                    )
                    done_payload: dict = {"type": "done"}
                    if usage_out.get("total_tokens"):
                        done_payload["total_tokens"] = usage_out["total_tokens"]
                    yield "data: " + json.dumps(done_payload) + "\n\n"

        except Exception as e:
            logger.error("chat: stream error: %s", e, exc_info=True)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── GET /history ───────────────────────────────────────────────────────────────

@router.get("/history")
async def get_history(session_id: str = Query(...)):
    resp = await (
        db.table("chat_messages")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=False)
        .execute()
    )
    return {"messages": resp.data or []}


# ── DELETE /history ────────────────────────────────────────────────────────────

@router.delete("/history")
async def delete_history(session_id: str = Query(...)):
    await db.table("chat_messages").delete().eq("session_id", session_id).execute()
    return {"success": True, "message": "Chat history cleared"}

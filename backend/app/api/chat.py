import json
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.models.chat import ChatRequest, ModelTier
from app.services.ai_router import stream_chat_response
from app.services.routed_llm import classify_task, gather_model_responses, stream_synthesis, build_attribution
import app.services.db as db

router = APIRouter()

STUDENT_SYSTEM_PROMPT = """You are Fluxnote, a general-purpose AI assistant built for students.

CORE IDENTITY
You are as capable as a standard ChatGPT — students can ask you about studies, productivity, life, tech, writing, or any general topic. You also have "assignment intelligence": when a student is working on an assignment, you shift into a focused, document-grounded mode.

TONE
Friendly, clear, and practical. Default to concise answers — if the student wants more, they'll ask. Avoid sounding robotic. Skip unnecessary disclaimers. Write math in plain English (e.g. "P equals m times x plus b", not LaTeX).

CONTEXT YOU MAY RECEIVE
You may be given any combination of:
1. Dashboard assignment card fields (title, module, due date, weightage, summary, checklist, constraints)
2. Full extracted text from uploaded documents
3. Conversation history
If the uploaded document text conflicts with the card summary, the document text takes priority.

GROUNDING RULES — FOLLOW STRICTLY
- Never invent assignment requirements, due dates, word counts, topic lists, penalties, or source restrictions.
- When asked for specific details, look first in the uploaded document text, then in the card fields.
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

CHAT_FILE_CONTEXT_LIMIT = 40_000  # characters per file


# ── POST /message ──────────────────────────────────────────────────────────────

@router.post("/message")
async def post_message(request: ChatRequest):
    """Stream an AI response via SSE. Fetches history, prepends file context,
    saves both user and assistant messages, streams the response."""

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

    # 2. Fetch file context — total budget split evenly across all files
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

    # 3. Build messages list
    messages: list[dict] = [{"role": "system", "content": STUDENT_SYSTEM_PROMPT}]
    messages += [
        {"role": row["role"], "content": row["content"]}
        for row in history
    ]
    user_content = request.message + file_context
    messages.append({"role": "user", "content": user_content})

    # 4. Persist user message before streaming
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

    # 5. SSE generator
    async def event_stream() -> AsyncGenerator[str, None]:
        chunks: list[str] = []
        try:
            yield "data: " + json.dumps({"type": "start"}) + "\n\n"

            if request.model == ModelTier.ROUTED:
                task_type = await classify_task(user_content)

                if task_type == "conversational":
                    # Short-circuit: single fast model, no MoA synthesis overhead
                    async for chunk in stream_chat_response(messages, ModelTier.FAST):
                        chunks.append(chunk)
                        yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                    await (
                        db.table("chat_messages")
                        .insert({
                            "id":         str(uuid.uuid4()),
                            "session_id": request.session_id,
                            "role":       "assistant",
                            "content":    "".join(chunks),
                            "model":      request.model.value,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        .execute()
                    )
                    yield "data: " + json.dumps({"type": "done"}) + "\n\n"

                else:
                    model_results = await gather_model_responses(messages, task_type)

                    async for chunk in stream_synthesis(model_results, task_type, messages):
                        chunks.append(chunk)
                        yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                    attribution = build_attribution(model_results)
                    await (
                        db.table("chat_messages")
                        .insert({
                            "id":         str(uuid.uuid4()),
                            "session_id": request.session_id,
                            "role":       "assistant",
                            "content":    "".join(chunks),
                            "model":      request.model.value,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        .execute()
                    )
                    yield "data: " + json.dumps({
                        "type":         "done",
                        "routed":       True,
                        "models_used":  attribution["models_used"],
                        "total_tokens": attribution["total_tokens"],
                    }) + "\n\n"

            else:
                usage_out: dict = {}
                async for chunk in stream_chat_response(messages, request.model, usage_out):
                    chunks.append(chunk)
                    yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

                await (
                    db.table("chat_messages")
                    .insert({
                        "id":         str(uuid.uuid4()),
                        "session_id": request.session_id,
                        "role":       "assistant",
                        "content":    "".join(chunks),
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

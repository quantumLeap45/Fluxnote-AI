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

STUDENT_SYSTEM_PROMPT = (
    "You are a helpful tutor assistant for university students. "
    "Write in clear, friendly, plain English. "
    "Never use LaTeX notation — write math in plain readable form "
    "(e.g. write 'P = m times x plus b', not '$P = mx + b$'). "
    "Keep responses concise. Use short paragraphs. "
    "Avoid unnecessary jargon or academic formality. "
    "When the student asks about an uploaded document, answer directly from the document content provided. "
    "If the information is not in the document, say: 'That information is not stated in your uploaded document.' "
    "Never tell the student to check Brightspace, Canvas, Moodle, or any external platform "
    "for information that may exist in the uploaded file."
)

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
                task_type     = await classify_task(user_content)
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
                async for chunk in stream_chat_response(messages, request.model):
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

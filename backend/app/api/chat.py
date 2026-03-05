import json
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.models.chat import ChatRequest, ModelTier
from app.services.ai_router import stream_chat_response
from app.services.supabase_client import get_supabase

router = APIRouter()


# ── POST /message ──────────────────────────────────────────────────────────────

@router.post("/message")
async def post_message(request: ChatRequest):
    """
    Stream an AI response for the given message.

    - Fetches the last 20 messages from the session as conversation history.
    - Optionally prepends file context from uploaded files.
    - Saves the user message before streaming, then saves the assistant
      response once the stream completes.
    - Returns a text/event-stream SSE response.
    """
    supabase = get_supabase()

    # ── 1. Fetch conversation history ──────────────────────────────────────────
    history_resp = (
        supabase.table("chat_messages")
        .select("role, content")
        .eq("session_id", request.session_id)
        .order("created_at", desc=False)
        .limit(20)
        .execute()
    )
    history: list[dict] = history_resp.data or []

    # ── 2. Fetch file context (if any file IDs provided) ───────────────────────
    file_context = ""
    if request.file_ids:
        files_resp = (
            supabase.table("files")
            .select("name, content")
            .in_("id", request.file_ids)
            .execute()
        )
        for file in (files_resp.data or []):
            if file.get("content"):
                file_context += f"\n\n[File: {file['name']}]\n{file['content']}"

    # ── 3. Build messages list for the AI ─────────────────────────────────────
    messages: list[dict] = [
        {"role": row["role"], "content": row["content"]}
        for row in history
    ]

    user_content = request.message
    if file_context:
        user_content += file_context

    messages.append({"role": "user", "content": user_content})

    # ── 4. Persist user message BEFORE streaming ───────────────────────────────
    supabase.table("chat_messages").insert({
        "id": str(uuid.uuid4()),
        "session_id": request.session_id,
        "role": "user",
        "content": request.message,  # store original message, without file context
        "model": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    # ── 5. Define SSE generator ────────────────────────────────────────────────
    async def event_stream() -> AsyncGenerator[str, None]:
        chunks: list[str] = []
        try:
            yield "data: " + json.dumps({"type": "start"}) + "\n\n"

            async for chunk in stream_chat_response(messages, request.model):
                chunks.append(chunk)
                yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

            # Persist the complete assistant response
            full_response = "".join(chunks)
            supabase.table("chat_messages").insert({
                "id": str(uuid.uuid4()),
                "session_id": request.session_id,
                "role": "assistant",
                "content": full_response,
                "model": request.model.value,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }).execute()

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
    """Return all chat messages for a session, ordered oldest-first."""
    supabase = get_supabase()

    resp = (
        supabase.table("chat_messages")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=False)
        .execute()
    )

    return {"messages": resp.data or []}


# ── DELETE /history ────────────────────────────────────────────────────────────

@router.delete("/history")
async def delete_history(session_id: str = Query(...)):
    """Delete all chat messages for a session."""
    supabase = get_supabase()

    supabase.table("chat_messages").delete().eq("session_id", session_id).execute()

    return {"success": True, "message": "Chat history cleared"}

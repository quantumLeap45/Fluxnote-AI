"""
Tests for chat stream reliability guard.

Covers the empty-message guard added in the foundation stabilization sprint:
- When stream produces no content, the error SSE event is yielded
- When stream produces no content, no assistant message is inserted in DB
- When stream produces content, the done event is yielded (success path)
"""
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _collect_sse_events(generator):
    """Collect all SSE events from an async generator as a list of dicts."""
    events = []
    async for line in generator:
        line = line.strip()
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return events


# ── Empty stream produces error event, not done ───────────────────────────────

@pytest.mark.anyio
async def test_empty_stream_emits_error_not_done():
    """
    When the AI stream yields zero content chunks, the SSE stream should emit
    an error event (not a done event) and must NOT insert to the database.

    This tests the guard: if not content_single: ... yield error else: insert + yield done
    """
    from app.services.ai_router import stream_chat_response

    # Stream that yields nothing
    async def empty_stream(*args, **kwargs):
        return
        yield  # makes it an async generator

    db_insert_called = []

    async def fake_db_execute(self):
        db_insert_called.append(True)
        return MagicMock(data=[])

    with patch("app.api.chat.stream_chat_response", new=empty_stream):
        with patch("app.services.db.DBQuery.execute", new=fake_db_execute):
            from app.models.chat import ChatRequest, ModelTier
            from app.api.chat import post_message

            request = ChatRequest(
                message="Hello",
                model=ModelTier.FAST,
                session_id="test-session-001",
                workspace_id="test-workspace-001",
            )

            # Collect the streaming response
            response = await post_message(request)
            events = await _collect_sse_events(response.body_iterator)

    event_types = [e.get("type") for e in events]
    assert "error" in event_types, f"Expected error event, got: {event_types}"
    assert "done" not in event_types, f"Expected no done event on empty stream, got: {event_types}"


@pytest.mark.anyio
async def test_empty_stream_does_not_insert_to_db():
    """Empty stream must not insert a blank assistant message into chat_messages."""
    from app.services.ai_router import stream_chat_response

    async def empty_stream(*args, **kwargs):
        return
        yield

    inserted_data = []

    class FakeQuery:
        def __init__(self, *args, **kwargs):
            self._op = "select"
            self._data = None
            self._filters = {}

        def select(self, *a, **kw): return self
        def insert(self, data): self._op = "insert"; self._data = data; inserted_data.append(data); return self
        def update(self, *a, **kw): return self
        def delete(self): return self
        def eq(self, *a, **kw): return self
        def order(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def in_(self, *a, **kw): return self

        async def execute(self):
            return MagicMock(data=[], count=0)

    with patch("app.api.chat.stream_chat_response", new=empty_stream):
        with patch("app.services.db.DBQuery", FakeQuery):
            from app.models.chat import ChatRequest, ModelTier
            from app.api.chat import post_message

            request = ChatRequest(
                message="Hello",
                model=ModelTier.FAST,
                session_id="test-session-002",
                workspace_id="test-workspace-002",
            )
            response = await post_message(request)
            await _collect_sse_events(response.body_iterator)

    # No assistant messages should have been inserted (only user message insert allowed)
    assistant_inserts = [d for d in inserted_data if d.get("role") == "assistant"]
    assert len(assistant_inserts) == 0, f"Empty stream should not insert assistant message, got: {assistant_inserts}"


# ── Non-empty stream produces done event ────────────────────────────────────

@pytest.mark.anyio
async def test_content_stream_emits_done_not_error():
    """When stream yields content, done event is emitted and error event is not."""
    from app.services.ai_router import stream_chat_response

    async def content_stream(*args, **kwargs):
        yield "Hello, student!"

    with patch("app.api.chat.stream_chat_response", new=content_stream):
        with patch("app.services.db.DBQuery.execute", new=AsyncMock(return_value=MagicMock(data=[]))):
            from app.models.chat import ChatRequest, ModelTier
            from app.api.chat import post_message

            request = ChatRequest(
                message="Hello",
                model=ModelTier.FAST,
                session_id="test-session-003",
                workspace_id="test-workspace-003",
            )
            response = await post_message(request)
            events = await _collect_sse_events(response.body_iterator)

    event_types = [e.get("type") for e in events]
    assert "done" in event_types, f"Expected done event on successful stream, got: {event_types}"
    assert "error" not in event_types, f"Expected no error event on successful stream, got: {event_types}"

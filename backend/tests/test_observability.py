"""
Tests for streaming observability in ai_router.py.

Covers the logging instrumentation added in the reliability sprint:
- Completion INFO log includes chunk_count, ttft_ms, total_ms, completion_outcome
- Malformed SSE frames are logged at DEBUG level
- skipped_frames count is tracked and reported accurately
"""
import json
import logging
import pytest
from contextlib import asynccontextmanager
from unittest.mock import MagicMock


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_fake_httpx_client(sse_lines: list[str]):
    """
    Return a drop-in replacement for httpx.AsyncClient that yields the given
    SSE lines via response.aiter_lines().

    Usage: patch("httpx.AsyncClient", make_fake_httpx_client(lines))
    """
    async def _aiter_lines():
        for line in sse_lines:
            yield line

    mock_response = MagicMock()
    mock_response.aiter_lines = _aiter_lines

    @asynccontextmanager
    async def _fake_stream(*args, **kwargs):
        yield mock_response

    class FakeClient:
        def __init__(self, **kwargs):
            pass  # accepts timeout=90 etc.

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        def stream(self, *args, **kwargs):
            return _fake_stream()

    return FakeClient


def _sse(payload: dict) -> str:
    return "data: " + json.dumps(payload)


# ── Test 1: INFO log on stream completion ─────────────────────────────────────

@pytest.mark.anyio
async def test_stream_logs_info_on_completion(caplog):
    """
    stream_chat_response logs an INFO record on completion that includes
    chunk_count, ttft_ms, total_ms, and completion_outcome.
    """
    from app.services.ai_router import stream_chat_response
    from app.models.chat import ModelTier
    from unittest.mock import patch

    lines = [
        _sse({"choices": [{"delta": {"content": "Hello"}}]}),
        _sse({"choices": [{"delta": {"content": " world"}}]}),
        "data: [DONE]",
    ]

    with caplog.at_level(logging.INFO, logger="app.ai_router"):
        with patch("httpx.AsyncClient", make_fake_httpx_client(lines)):
            chunks = [c async for c in stream_chat_response([], ModelTier.FAST)]

    assert chunks == ["Hello", " world"], f"Unexpected chunks: {chunks}"

    info_records = [r for r in caplog.records if r.levelno == logging.INFO]
    assert info_records, "Expected at least one INFO log record from ai_router"

    msg = info_records[-1].message
    assert "chunk_count" in msg, f"Expected 'chunk_count' in INFO log: {msg}"
    assert "ttft_ms" in msg,     f"Expected 'ttft_ms' in INFO log: {msg}"
    assert "total_ms" in msg,    f"Expected 'total_ms' in INFO log: {msg}"


# ── Test 2: DEBUG log on malformed frame ─────────────────────────────────────

@pytest.mark.anyio
async def test_stream_logs_debug_on_malformed_frame(caplog):
    """
    stream_chat_response logs a DEBUG record for each malformed SSE frame,
    and still yields any valid chunks that follow.
    """
    from app.services.ai_router import stream_chat_response
    from app.models.chat import ModelTier
    from unittest.mock import patch

    lines = [
        "data: {not valid json!!!",
        _sse({"choices": [{"delta": {"content": "OK"}}]}),
        "data: [DONE]",
    ]

    with caplog.at_level(logging.DEBUG, logger="app.ai_router"):
        with patch("httpx.AsyncClient", make_fake_httpx_client(lines)):
            chunks = [c async for c in stream_chat_response([], ModelTier.FAST)]

    assert chunks == ["OK"], f"Expected ['OK'], got: {chunks}"

    debug_records = [
        r for r in caplog.records
        if r.levelno == logging.DEBUG and "malformed" in r.message.lower()
    ]
    assert debug_records, "Expected at least one DEBUG log for malformed SSE frame"


# ── Test 3: skipped_frames count in INFO log ──────────────────────────────────

@pytest.mark.anyio
async def test_stream_info_includes_skipped_frames_count(caplog):
    """
    The completion INFO log accurately reports skipped_frames count.
    Two malformed frames → skipped_frames=2 in the log message.
    """
    from app.services.ai_router import stream_chat_response
    from app.models.chat import ModelTier
    from unittest.mock import patch

    lines = [
        "data: bad_json_1",
        "data: bad_json_2",
        _sse({"choices": [{"delta": {"content": "chunk"}}]}),
        "data: [DONE]",
    ]

    with caplog.at_level(logging.INFO, logger="app.ai_router"):
        with patch("httpx.AsyncClient", make_fake_httpx_client(lines)):
            _ = [c async for c in stream_chat_response([], ModelTier.FAST)]

    info_records = [r for r in caplog.records if r.levelno == logging.INFO]
    assert info_records, "Expected INFO log after stream"

    msg = info_records[-1].message
    assert "skipped_frames" in msg, f"Expected 'skipped_frames' in log: {msg}"
    # The value reported must be 2 (both malformed lines counted)
    assert "skipped_frames=2" in msg, f"Expected skipped_frames=2 in log: {msg}"

"""
Tests for assignment extraction error classification.

Covers the critical paths added in the foundation stabilization sprint:
- Timeout raises asyncio.TimeoutError (not swallowed)
- Malformed JSON raises ValueError (not generic Exception)
- HTTP 429 raises RuntimeError with clear message
- HTTP 5xx raises RuntimeError

Pre-launch reliability sprint:
- max_tokens must be 2048 to avoid JSON truncation
"""
import asyncio
import json
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.assignment_extractor import _call_openrouter, extract_assignment_data


# ── max_tokens regression ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_extract_uses_max_tokens_2048():
    """Extraction request must use max_tokens=2048 to avoid truncating large JSON."""
    good_payload = {
        "title": "T", "module": None, "due_date": "Not stated in document",
        "weightage": None, "assignment_type": None, "deliverable_type": None,
        "marks": None, "summary": ["s"], "checklist": ["c"], "constraints": None,
    }
    captured = {}

    async def fake_post(self, url, *, headers, json, **kwargs):
        captured["max_tokens"] = json.get("max_tokens")
        mock = MagicMock()
        mock.status_code = 200
        mock.json.return_value = {
            "choices": [{"message": {"content": __import__("json").dumps(good_payload)}}]
        }
        mock.raise_for_status = MagicMock()
        return mock

    with patch("httpx.AsyncClient.post", new=fake_post):
        await _call_openrouter("Sample assignment text")

    assert captured["max_tokens"] == 2048, (
        f"max_tokens must be 2048 to avoid JSON truncation, got {captured['max_tokens']}"
    )


# ── Happy path ──────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_extract_returns_parsed_dict():
    """extract_assignment_data returns a dict on clean response."""
    good_payload = {
        "title": "Test Assignment", "module": "CS101", "due_date": "2026-05-01",
        "weightage": "30%", "assignment_type": "Individual",
        "deliverable_type": "report", "marks": "30/100",
        "summary": ["Write a report"], "checklist": ["Step 1"], "constraints": None,
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": json.dumps(good_payload)}}]
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=mock_resp)):
        result = await extract_assignment_data("Sample assignment text")

    assert result["title"] == "Test Assignment"
    assert result["module"] == "CS101"


# ── Timeout path ─────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_extract_raises_timeout_on_slow_api():
    """extract_assignment_data propagates asyncio.TimeoutError on slow response."""
    async def slow_post(*args, **kwargs):
        await asyncio.sleep(100)  # simulate hung API

    with patch("httpx.AsyncClient.post", new=slow_post):
        with pytest.raises(asyncio.TimeoutError):
            await extract_assignment_data("Some text")


# ── JSON parse failure ────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_extract_raises_value_error_on_malformed_json():
    """_call_openrouter raises ValueError when AI returns non-JSON content."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "Here is your assignment: not json at all"}}]
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=mock_resp)):
        with pytest.raises(ValueError, match="malformed JSON"):
            await _call_openrouter("Sample text")


# ── HTTP 429 rate limit ───────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_extract_raises_runtime_error_on_429():
    """_call_openrouter raises RuntimeError with rate-limit message on HTTP 429."""
    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
        "429", request=MagicMock(), response=mock_resp
    )

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=mock_resp)):
        with pytest.raises(RuntimeError, match="rate limit"):
            await _call_openrouter("Sample text")


# ── HTTP 500 server error ─────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_extract_raises_runtime_error_on_500():
    """_call_openrouter raises RuntimeError on HTTP 5xx errors."""
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
        "500", request=MagicMock(), response=mock_resp
    )

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=mock_resp)):
        with pytest.raises(RuntimeError, match="HTTP 500"):
            await _call_openrouter("Sample text")


# ── httpx timeout converts to asyncio.TimeoutError ───────────────────────────

@pytest.mark.anyio
async def test_extract_converts_httpx_timeout_to_asyncio_timeout():
    """_call_openrouter raises asyncio.TimeoutError when httpx times out."""
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=httpx.TimeoutException("timed out"))):
        with pytest.raises(asyncio.TimeoutError):
            await _call_openrouter("Sample text")

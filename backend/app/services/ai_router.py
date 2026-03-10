import json
import logging
import time
from typing import AsyncGenerator, Union

import httpx

from app.config import settings
from app.models.chat import ModelTier

logger = logging.getLogger("app.ai_router")

# Maps ModelTier enum values to real OpenRouter model IDs
MODEL_ID_MAP: dict[ModelTier, str] = {
    ModelTier.FAST: settings.MODEL_FAST,
    ModelTier.BALANCED: settings.MODEL_BALANCED,
    ModelTier.DEEP_THINK: settings.MODEL_DEEP_THINK,
}


async def stream_chat_response(
    messages: list[dict],
    model_tier: ModelTier,
    usage_out: dict | None = None,
) -> AsyncGenerator[str, None]:
    """
    Async generator that streams chat completion chunks from OpenRouter.

    Calls the /chat/completions endpoint with stream=True, parses SSE lines,
    and yields each content chunk as a plain string.
    If usage_out dict is provided, it will be populated with token usage on completion.
    """
    model_id = MODEL_ID_MAP[model_tier]

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://fluxnote.ai",
        "X-Title": "Fluxnote AI",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model_id,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": 2048,
    }

    start_time: float = time.time()
    first_chunk_time: float | None = None
    chunk_count: int = 0
    skipped_frames: int = 0
    completion_outcome: str = "no_content"

    async with httpx.AsyncClient(timeout=90) as client:
        async with client.stream(
            "POST",
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            async for line in response.aiter_lines():
                # Only process SSE data lines
                if not line.startswith("data: "):
                    continue

                data = line[len("data: "):]

                # Stream termination sentinel
                if data.strip() == "[DONE]":
                    break

                try:
                    parsed = json.loads(data)
                    # Capture token usage from the final usage chunk
                    if usage_out is not None and parsed.get("usage"):
                        usage_out.update(parsed["usage"])
                    chunk = parsed["choices"][0]["delta"].get("content") or ""
                    if chunk:
                        if first_chunk_time is None:
                            first_chunk_time = time.time()
                        chunk_count += 1
                        completion_outcome = "success"
                        yield chunk
                except (json.JSONDecodeError, KeyError, IndexError) as exc:
                    skipped_frames += 1
                    logger.debug(
                        "ai_router: malformed SSE frame skipped (%s): %.80r",
                        type(exc).__name__, data,
                    )
                    continue

    total_ms = int((time.time() - start_time) * 1000)
    ttft_ms = int((first_chunk_time - start_time) * 1000) if first_chunk_time else None
    logger.info(
        "ai_router: stream complete | outcome=%s chunk_count=%d ttft_ms=%s "
        "total_ms=%d skipped_frames=%d model=%s",
        completion_outcome, chunk_count, ttft_ms, total_ms, skipped_frames, model_id,
    )


async def stream_chat_response_with_thinking(
    messages: list[dict],
    usage_out: dict | None = None,
) -> AsyncGenerator[dict, None]:
    """
    Async generator for Deep Think mode with extended thinking enabled.

    Yields dicts with two possible shapes:
      {"type": "thinking", "text": "..."}  — reasoning/thinking token chunk
      {"type": "content",  "text": "..."}  — final answer token chunk

    Falls back gracefully: if the API returns no reasoning_details, the
    generator still yields content chunks as normal.
    """
    model_id = settings.MODEL_DEEP_THINK

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://fluxnote.ai",
        "X-Title": "Fluxnote AI",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model_id,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": 3000,
        "reasoning": {"max_tokens": 2000},  # extended thinking budget
    }

    async with httpx.AsyncClient(timeout=90) as client:
        async with client.stream(
            "POST",
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue

                data = line[len("data: "):]

                if data.strip() == "[DONE]":
                    break

                try:
                    parsed = json.loads(data)

                    if usage_out is not None and parsed.get("usage"):
                        usage_out.update(parsed["usage"])

                    delta = parsed["choices"][0]["delta"]

                    # ── Reasoning / thinking tokens ─────────────────────────
                    # OpenRouter exposes extended thinking in
                    # delta.reasoning_details (array) or delta.reasoning (str).
                    raw_reasoning = (
                        delta.get("reasoning_details")
                        or delta.get("reasoning")
                        or delta.get("thinking")
                        or delta.get("reasoning_content")   # DeepSeek V3.2
                    )
                    if raw_reasoning:
                        if isinstance(raw_reasoning, list):
                            for r in raw_reasoning:
                                if isinstance(r, dict):
                                    text = r.get("thinking") or r.get("text") or ""
                                else:
                                    text = str(r)
                                if text:
                                    yield {"type": "thinking", "text": text}
                        elif isinstance(raw_reasoning, str) and raw_reasoning:
                            yield {"type": "thinking", "text": raw_reasoning}

                    # ── Regular content tokens ───────────────────────────────
                    content = delta.get("content") or ""
                    if content:
                        yield {"type": "content", "text": content}

                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

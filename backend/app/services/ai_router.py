import json
from typing import AsyncGenerator, Union

import httpx

from app.config import settings
from app.models.chat import ModelTier

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
                        yield chunk
                except (json.JSONDecodeError, KeyError, IndexError):
                    # Malformed or incomplete SSE frame — skip gracefully
                    continue


async def stream_chat_response_with_thinking(
    messages: list[dict],
    usage_out: dict | None = None,
) -> AsyncGenerator[dict, None]:
    """
    Async generator for Deep Think mode with extended thinking enabled.

    Yields dicts with two possible shapes:
      {"type": "thinking", "text": "..."}  — reasoning/thinking token chunk
      {"type": "content",  "text": "..."}  — final answer token chunk

    Uses Claude Haiku 4.5 with reasoning enabled (budget: 2000 tokens).
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
                    # OpenRouter exposes Claude extended thinking in
                    # delta.reasoning_details (array) or delta.reasoning (str).
                    raw_reasoning = (
                        delta.get("reasoning_details")
                        or delta.get("reasoning")
                        or delta.get("thinking")
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

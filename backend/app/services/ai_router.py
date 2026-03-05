import json
from typing import AsyncGenerator

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
) -> AsyncGenerator[str, None]:
    """
    Async generator that streams chat completion chunks from OpenRouter.

    Calls the /chat/completions endpoint with stream=True, parses SSE lines,
    and yields each content chunk as a plain string.
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
        "max_tokens": 2048,
    }

    async with httpx.AsyncClient(timeout=60) as client:
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
                    chunk = parsed["choices"][0]["delta"]["content"]
                    if chunk:
                        yield chunk
                except (json.JSONDecodeError, KeyError, IndexError):
                    # Malformed or incomplete SSE frame — skip gracefully
                    continue

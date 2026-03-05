"""
Routed LLM Service — Mixture of Agents (MoA) implementation.

Flow:
  1. Classify task type (keyword matching → LLM fallback)
  2. Select up to MAX_ROUTED_MODELS models based on task strengths
  3. Call all selected models in parallel (asyncio.gather)
  4. Synthesize using the strongest model (Claude Haiku) — streamed
  5. Return attribution metadata (which models, total tokens)
"""

import asyncio
import json
import httpx

from app.config import settings

# ── Constants ────────────────────────────────────────────────────────────────

MAX_ROUTED_MODELS = 3  # Hard cap — never call more than 3 models at once

# Display names for attribution footer
MODEL_DISPLAY_NAMES: dict[str, str] = {
    "anthropic/claude-haiku-4.5":           "Claude",
    "openai/gpt-5-nano":                    "GPT-5",
    "google/gemini-3.1-flash-lite-preview": "Gemini",
}

# ── Task routing rules ───────────────────────────────────────────────────────
# Ordered by contribution weight — first model is the primary contributor.
# Adding new models to the pool in the future only requires updating this dict
# and MODEL_DISPLAY_NAMES above; nothing else changes.
TASK_ROUTING: dict[str, list[str]] = {
    "code":     [
        "anthropic/claude-haiku-4.5",           # strong at logic/debugging
        "openai/gpt-5-nano",                    # strong at code generation
    ],
    "math":     [
        "anthropic/claude-haiku-4.5",           # strong at step-by-step reasoning
        "openai/gpt-5-nano",                    # strong at numeric accuracy
    ],
    "creative": [
        "openai/gpt-5-nano",                    # strong at narrative
        "google/gemini-3.1-flash-lite-preview", # strong at ideas/variety
    ],
    "writing":  [
        "openai/gpt-5-nano",                    # strong at professional tone
        "anthropic/claude-haiku-4.5",           # strong at polish/clarity
    ],
    "factual":  [
        "google/gemini-3.1-flash-lite-preview", # strong at grounded facts
        "openai/gpt-5-nano",                    # cross-check verification
    ],
    "analysis": [
        "anthropic/claude-haiku-4.5",           # strong at deep reasoning
        "openai/gpt-5-nano",                    # strong at structured output
        "google/gemini-3.1-flash-lite-preview", # strong at breadth
    ],
    "general":  [
        "anthropic/claude-haiku-4.5",
        "openai/gpt-5-nano",
        "google/gemini-3.1-flash-lite-preview",
    ],
}

# ── Task classification ──────────────────────────────────────────────────────

_KEYWORD_MAP: dict[str, list[str]] = {
    "code":     ["code", "function", "implement", "bug", "debug", "error",
                 "python", "javascript", "typescript", "html", "css", "sql",
                 "api", "class", "method", "script", "algorithm", "program",
                 "syntax", "compile", "runtime", "exception", "loop", "array"],
    "math":     ["calculate", "solve", "equation", "integral", "derivative",
                 "proof", "formula", "statistics", "probability", "geometry",
                 "algebra", "arithmetic", "matrix", "vector"],
    "creative": ["story", "poem", "creative", "fiction", "imagine", "invent",
                 "narrative", "character", "plot", "fantasy", "sci-fi"],
    "writing":  ["write", "draft", "essay", "email", "letter", "report",
                 "summarize", "paraphrase", "rewrite", "improve my writing",
                 "cover letter", "proposal", "blog post"],
    "factual":  ["what is", "who is", "when did", "where is", "define",
                 "how does", "explain what", "tell me about", "history of",
                 "difference between"],
    "analysis": ["analyze", "compare", "evaluate", "assess", "critique",
                 "pros and cons", "advantages", "disadvantages", "strategy",
                 "decision", "trade-off", "recommend", "should i"],
}

_CLASSIFY_SYSTEM = """Classify the user message into ONE task type. Reply with ONLY the type word.

Valid types: code, math, creative, writing, factual, analysis, general

User message: {message}
Task type:"""


def _quick_classify(message: str) -> str | None:
    """Keyword-based classification — avoids an extra API call for common cases."""
    lower = message.lower()
    scores = {task: sum(1 for kw in kws if kw in lower) for task, kws in _KEYWORD_MAP.items()}
    best_task = max(scores, key=lambda t: scores[t])
    return best_task if scores[best_task] > 0 else None


async def classify_task(message: str) -> str:
    """
    Classify task type using keyword matching first.
    Falls back to a fast LLM call only when keywords give no signal.
    """
    quick = _quick_classify(message)
    if quick:
        return quick

    headers = _openrouter_headers()
    payload = {
        "model": settings.MODEL_FAST,   # cheapest model for classification
        "messages": [
            {"role": "user", "content": _CLASSIFY_SYSTEM.format(message=message[:500])},
        ],
        "max_tokens": 10,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            result = resp.json()["choices"][0]["message"]["content"].strip().lower()
            return result if result in TASK_ROUTING else "general"
    except Exception:
        return "general"


# ── Parallel model calls ─────────────────────────────────────────────────────

async def _call_model_complete(
    messages: list[dict],
    model_id: str,
    headers: dict,
) -> dict:
    """
    Call a single model (non-streaming) and return its full response.
    Used for the proposer stage of MoA — we collect all responses before synthesis.
    """
    payload = {
        "model": model_id,
        "messages": messages,
        "max_tokens": 1024,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"] or ""
        usage = data.get("usage", {})
        return {
            "model_id":     model_id,
            "display_name": MODEL_DISPLAY_NAMES.get(model_id, model_id),
            "content":      content,
            "tokens":       usage.get("total_tokens", 0),
        }


async def gather_model_responses(
    messages: list[dict],
    task_type: str,
) -> list[dict]:
    """
    Call selected models in parallel (asyncio.gather).
    Returns list of valid results — failures are silently dropped with a minimum of 1.
    """
    selected = TASK_ROUTING.get(task_type, TASK_ROUTING["general"])[:MAX_ROUTED_MODELS]
    headers = _openrouter_headers()

    tasks = [_call_model_complete(messages, model_id, headers) for model_id in selected]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid = [r for r in results if isinstance(r, dict)]
    if not valid:
        raise RuntimeError("All parallel model calls failed during routing")
    return valid


# ── Synthesis ────────────────────────────────────────────────────────────────

_SYNTHESIS_SYSTEM = (
    "You are synthesizing multiple AI perspectives into one superior answer for a {task_type} task.\n"
    "Each perspective brings different strengths.\n\n"
    "Rules:\n"
    "- Give the final best unified answer directly — do NOT mention the individual models\n"
    "- Do NOT say 'based on the perspectives above' or similar meta-commentary\n"
    "- Preserve the best insights, examples, and structure from all inputs\n"
    "- Be concise and clear"
)


async def stream_synthesis(
    model_results: list[dict],
    task_type: str,
    original_messages: list[dict],
):
    """
    Async generator — streams the synthesis response chunk by chunk.
    Uses the strongest model in our pool (Deep Think / Claude Haiku) as synthesizer.
    """
    perspectives = "\n\n".join(
        f"[Perspective {i + 1} — {r['display_name']}]:\n{r['content']}"
        for i, r in enumerate(model_results)
    )

    user_content = next(
        (m["content"] for m in reversed(original_messages) if m["role"] == "user"),
        "",
    )
    synthesis_messages = [
        m for m in original_messages if m["role"] != "user"  # keep system/assistant history
    ] + [
        {
            "role": "user",
            "content": (
                f"Task: {user_content}\n\n"
                f"---\n"
                f"{_SYNTHESIS_SYSTEM.format(task_type=task_type)}\n\n"
                f"Perspectives to synthesize:\n{perspectives}"
            ),
        }
    ]

    headers = _openrouter_headers()
    payload = {
        "model": settings.MODEL_DEEP_THINK,  # best synthesizer in our pool
        "messages": synthesis_messages,
        "max_tokens": 2048,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream(
            "POST",
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    parsed = json.loads(data)
                    chunk = parsed["choices"][0]["delta"].get("content", "")
                    if chunk:
                        yield chunk
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


# ── Helpers ──────────────────────────────────────────────────────────────────

def _openrouter_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer":  "https://fluxnote.ai",
        "X-Title":       "Fluxnote AI",
        "Content-Type":  "application/json",
    }


def build_attribution(model_results: list[dict]) -> dict:
    """Build the attribution payload included in the SSE done event."""
    return {
        "models_used":   [r["display_name"] for r in model_results],
        "total_tokens":  sum(r["tokens"] for r in model_results),
    }

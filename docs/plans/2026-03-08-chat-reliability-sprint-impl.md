# Chat Reliability, Routing & Observability Sprint — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Eliminate blank-success outcomes, fix routed classification using the visible prompt only, add measurable streaming observability, fix Deep Think escalation consistency, tighten routing keyword precision, add synthesis timeout safety, and fix documentation drift.

**Architecture:** Observability layer injected into `ai_router.py` first (to enable before/after measurement), then the Routed classification input fixed in `chat.py` (one-line bug, high impact), then targeted fixes to `routed_llm.py` (escalation trigger, keyword classifier, synthesis timeout), then frontend blank-bubble guard in `ChatView.jsx`, then attribution UI and docs cleanup. Each task is independent and commits cleanly. TDD throughout.

**Tech Stack:** FastAPI + Python asyncio (backend), React 19 + Vitest (frontend), pytest + anyio (backend tests), OpenRouter SSE streaming

**Pre-requisites:** None. No database migrations, no new environment variables, no CEO actions required.

**Branch:** `feat/chat-reliability-sprint` — create from `main` before starting Task 1.

```bash
git checkout main
git pull origin main
git checkout -b feat/chat-reliability-sprint
```

---

## Revision Note (2026-03-08)

This is the corrected version of the plan. The following errors in the original draft have been fixed:

| Error | Correction |
|-------|-----------|
| Classification input listed as "already fixed" | It is NOT fixed. `chat.py:337` still calls `classify_task(user_content)`. Added as Task 5. |
| Test code called `classify_task()` synchronously | `classify_task` is `async def` — all calls must `await` it under `@pytest.mark.anyio` |
| Test imports used `from backend.app.*` | Repo style is `from app.*` (see existing tests for reference) |
| Sync test functions for `classify_task` | Fixed — `_quick_classify` and `should_escalate_deep_think` are sync and tested as sync; `classify_task` tests are async |

---

## Confirmed Findings from Codebase Audit

Record these as confirmed baselines before starting any task:

| ID | Finding | Location | Severity | Sprint Action |
|----|---------|----------|----------|---------------|
| C1 | Frontend renders blank assistant bubble if `onDone` fires with `content=''` | `ChatView.jsx:322-332` | HIGH | Fix in Task 3 |
| C2 | `ai_router.py` has zero diagnostic logging; malformed frames silently dropped | `ai_router.py:53-74` | HIGH | Fix in Task 1 |
| C3 | Synthesis stream missing `include_usage`; routed token counts incomplete | `routed_llm.py:302-307` | MEDIUM | Fix in Task 2 |
| C4 | DT escalation fires on `len(user_content) > len(message) + 3000` — any doc upload triggers it | `routed_llm.py:228` | MEDIUM | Fix in Task 4 |
| C5 | Escalated DT shows generic Routed attribution; no signal that DT used synthesis | `chat.py:432-443`, `ChatView.jsx:334-345` | MEDIUM | Fix in Task 6 |
| C6 | Keyword classifier uses raw `in` substring — "code" matches "code of conduct" | `routed_llm.py:75-107` | MEDIUM | Fix in Task 4 |
| C7 | No `asyncio.wait_for` on synthesis stream; hung model holds connection for full Vercel 60s | `routed_llm.py:285-330` | MEDIUM | Fix in Task 7 |
| C8 | `backend/README.md` model table lists Mistral/Gemma/DeepSeek R1 (old free models) | `README.md:129-137` | LOW | Fix in Task 9 |
| C9 | `ai_router.py` comment references "Claude Haiku 4.5" — code uses `settings.MODEL_DEEP_THINK` | `ai_router.py:~88` | LOW | Fix in Task 9 |
| C10 | **Routed classification called with `user_content` (includes injected docs), not `request.message`** | `chat.py:337` | HIGH | Fix in Task 5 |

**Impact of C10 in detail:**
- `user_content = request.message + injected_assignment_text + file_context` (can be thousands of words)
- `classify_task(user_content)` means the 10-word conversational short-circuit **never fires** — `user_content` is always longer than 10 words even for "hi"
- Keyword matching (`_quick_classify`) runs over the full document content — if the assignment doc mentions "code", "analysis", or "write", those keywords can match
- The LLM fallback truncates to 500 chars of `user_content`, which may be assignment text rather than the student's question
- **Fix is one line:** `chat.py:337` change `classify_task(user_content)` → `classify_task(request.message)`

**Already fixed (do NOT re-implement):**
- Backend empty guard on all 4 streaming paths → `chat.py:346,387,428,468`
- SSE flush-on-end implemented in frontend → `api.js:174`
- Partial proposer failures logged with count → `routed_llm.py:199-205`

---

## Test Code Conventions (follow these throughout)

The existing test suite uses these patterns. Do not deviate.

```python
# Correct import style (relative to tests/ working dir / PYTHONPATH)
from app.services.ai_router import stream_chat_response
from app.services.routed_llm import should_escalate_deep_think, _quick_classify
from app.models.chat import ChatRequest, ModelTier
from app.api.chat import post_message

# Correct async test decorator
@pytest.mark.anyio
async def test_something():
    ...

# Correct mock imports
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

# sync functions (_quick_classify, should_escalate_deep_think) — NO decorator needed
def test_sync_function():
    result = _quick_classify("some input")
    assert result == "expected"

# async functions (classify_task) — ALWAYS await, ALWAYS @pytest.mark.anyio
@pytest.mark.anyio
async def test_async_function():
    result = await classify_task("some input")
    assert result == "expected"
```

---

## Task 1: Add Streaming Observability to ai_router.py

**Purpose:** Create the measurement baseline. All other tasks depend on this being in place first so improvements can be measured before/after.

**Files:**
- Modify: `backend/app/services/ai_router.py`
- Create: `backend/tests/test_observability.py`

---

**Step 1: Write the failing tests**

```python
# backend/tests/test_observability.py
"""
Tests for streaming observability added to ai_router.stream_chat_response.

Verifies that:
- Successful streams log completion_outcome=content and chunk_count
- Empty streams log completion_outcome=empty
- Malformed SSE frames are logged at DEBUG level (not silently discarded)
"""
import logging
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_mock_client(mock_lines):
    """Build a mock httpx async client that yields the given SSE lines."""
    async def fake_aiter_lines():
        for line in mock_lines:
            yield line

    mock_response = MagicMock()
    mock_response.aiter_lines = fake_aiter_lines
    mock_response.raise_for_status = MagicMock()

    mock_stream_cm = MagicMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_response)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.stream = MagicMock(return_value=mock_stream_cm)

    return mock_client


@pytest.mark.anyio
async def test_successful_stream_logs_outcome_content(caplog):
    """Successful stream must log completion_outcome=content and chunk_count > 0."""
    from app.services.ai_router import stream_chat_response
    from app.models.chat import ModelTier

    mock_lines = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]',
    ]
    mock_client = _make_mock_client(mock_lines)

    with patch("app.services.ai_router.httpx.AsyncClient", return_value=mock_client):
        with caplog.at_level(logging.INFO, logger="app.ai_router"):
            chunks = [c async for c in stream_chat_response(
                [{"role": "user", "content": "hi"}], ModelTier.FAST
            )]

    assert "".join(chunks) == "Hello world"
    log_text = " ".join(r.message for r in caplog.records)
    assert "completion_outcome" in log_text
    assert "content" in log_text
    assert "chunk_count" in log_text


@pytest.mark.anyio
async def test_empty_stream_logs_outcome_empty(caplog):
    """Stream that yields no content must log completion_outcome=empty."""
    from app.services.ai_router import stream_chat_response
    from app.models.chat import ModelTier

    mock_lines = [
        'data: {"choices":[{"delta":{}}]}',
        'data: [DONE]',
    ]
    mock_client = _make_mock_client(mock_lines)

    with patch("app.services.ai_router.httpx.AsyncClient", return_value=mock_client):
        with caplog.at_level(logging.INFO, logger="app.ai_router"):
            chunks = [c async for c in stream_chat_response(
                [{"role": "user", "content": "hi"}], ModelTier.FAST
            )]

    assert chunks == []
    log_text = " ".join(r.message for r in caplog.records)
    assert "completion_outcome" in log_text
    assert "empty" in log_text


@pytest.mark.anyio
async def test_malformed_frame_logged_at_debug(caplog):
    """Malformed SSE frame must produce a DEBUG log entry, not silent discard."""
    from app.services.ai_router import stream_chat_response
    from app.models.chat import ModelTier

    mock_lines = [
        'data: NOT VALID JSON AT ALL',
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]',
    ]
    mock_client = _make_mock_client(mock_lines)

    with patch("app.services.ai_router.httpx.AsyncClient", return_value=mock_client):
        with caplog.at_level(logging.DEBUG, logger="app.ai_router"):
            _ = [c async for c in stream_chat_response(
                [{"role": "user", "content": "hi"}], ModelTier.FAST
            )]

    debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]
    assert any("skipped_frame" in m or "malformed" in m.lower() for m in debug_messages), \
        f"Expected a DEBUG log for malformed frame. Got debug messages: {debug_messages}"
```

**Step 2: Run to verify they fail**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI
python -m pytest backend/tests/test_observability.py -v
```

Expected: 3 FAILED — logging assertions not yet satisfied.

---

**Step 3: Implement observability in `backend/app/services/ai_router.py`**

Add at the top of the file, after existing imports:

```python
import logging
import time

logger = logging.getLogger("app.ai_router")
```

Replace the body of `stream_chat_response()` with the following (the signature is unchanged):

```python
async def stream_chat_response(
    messages: list[dict],
    model_tier: "ModelTier",
    usage_out: dict | None = None,
) -> AsyncGenerator[str, None]:
    model_id = MODEL_ID_MAP.get(model_tier, MODEL_ID_MAP[ModelTier.FAST])
    start_time = time.monotonic()
    first_chunk_time: float | None = None
    chunk_count: int = 0
    skipped_frames: int = 0

    async with httpx.AsyncClient(timeout=90) as client:
        payload = {
            "model": model_id,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": 2048,
        }
        async with client.stream(
            "POST",
            settings.OPENROUTER_BASE_URL + "/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    parsed = json.loads(data)
                    if "usage" in parsed and usage_out is not None:
                        usage_out.update(parsed["usage"])
                        continue
                    chunk = parsed["choices"][0]["delta"].get("content") or ""
                    if chunk:
                        if first_chunk_time is None:
                            first_chunk_time = time.monotonic()
                        chunk_count += 1
                        yield chunk
                except (json.JSONDecodeError, KeyError, IndexError) as e:
                    skipped_frames += 1
                    logger.debug(
                        "skipped_frame model=%s reason=%s frame=%r",
                        model_id, type(e).__name__, data[:80],
                    )
                    continue

    total_ms = round((time.monotonic() - start_time) * 1000)
    ttft_ms = round((first_chunk_time - start_time) * 1000) if first_chunk_time else None
    outcome = "content" if chunk_count > 0 else "empty"
    logger.info(
        "stream_complete model=%s completion_outcome=%s chunk_count=%d "
        "ttft_ms=%s total_ms=%d skipped_frames=%d",
        model_id, outcome, chunk_count, ttft_ms, total_ms, skipped_frames,
    )
```

**Step 4: Run observability tests**

```bash
python -m pytest backend/tests/test_observability.py -v
```

Expected: 3 PASSED

**Step 5: Run full backend suite to confirm no regressions**

```bash
python -m pytest backend/tests/ -v
```

Expected: All previously passing tests still PASS.

**Step 6: Commit**

```bash
git add backend/app/services/ai_router.py backend/tests/test_observability.py
git commit -m "feat: add streaming observability to ai_router — chunk count, ttft, outcome, skipped frames"
```

---

## Task 2: Add Synthesis Token Tracking to routed_llm.py

**Purpose:** Fix missing `include_usage` in the synthesis stream so routed token counts are complete.

**Files:**
- Modify: `backend/app/services/routed_llm.py`
- Modify: `backend/app/api/chat.py`

---

**Step 1: Locate the synthesis payload in `stream_synthesis()` (around line 302)**

The payload dict currently has `"model"`, `"messages"`, `"stream": True` — but no `"stream_options"`.

**Step 2: Update `stream_synthesis()` signature to accept `usage_out`**

Current signature:
```python
async def stream_synthesis(
    model_results: list[dict],
    task_type: str,
    original_messages: list[dict],
) -> AsyncGenerator[str, None]:
```

New signature (add `usage_out` parameter):
```python
async def stream_synthesis(
    model_results: list[dict],
    task_type: str,
    original_messages: list[dict],
    usage_out: dict | None = None,
) -> AsyncGenerator[str, None]:
```

**Step 3: Add `include_usage` to the synthesis payload dict**

Find the payload dict inside `stream_synthesis()` and add:
```python
"stream_options": {"include_usage": True},
```

**Step 4: Add usage capture inside the synthesis SSE parse loop**

Inside the parse loop in `stream_synthesis()`, in the `try` block, add usage capture before the content extraction (same pattern as `ai_router.py`):

```python
try:
    parsed = json.loads(data)
    if "usage" in parsed:
        if usage_out is not None:
            usage_out.update(parsed["usage"])
        continue
    chunk = parsed["choices"][0]["delta"].get("content") or ""
    if chunk:
        yield chunk
except (json.JSONDecodeError, KeyError, IndexError):
    continue
```

**Step 5: Update callers in `chat.py`**

There are two calls to `stream_synthesis` in `chat.py`: the Routed MoA path and the DT escalation path. Update both to pass a `usage_out` dict, then include synthesis tokens in the `done` event total.

For the Routed MoA path (around line 377):
```python
synthesis_usage: dict = {}
async for chunk in stream_synthesis(model_results, task_type, messages, usage_out=synthesis_usage):
    chunks.append(chunk)
    yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"

# In the done event, combine proposer + synthesis tokens:
proposer_tokens = sum(r.get("tokens", 0) for r in model_results)
total_tokens = proposer_tokens + synthesis_usage.get("total_tokens", 0)
```

Apply the same pattern to the DT escalation path.

**Step 6: Run full backend suite**

```bash
python -m pytest backend/tests/ -v
```

Expected: All PASSED.

**Step 7: Commit**

```bash
git add backend/app/services/routed_llm.py backend/app/api/chat.py
git commit -m "feat: add include_usage to synthesis stream — routed token counts now complete"
```

---

## Task 3: Fix Frontend Blank Bubble Guard

**Purpose:** Eliminate the visually blank assistant bubble when streaming ends with no content.

**Files:**
- Modify: `frontend/src/components/ChatView.jsx`
- Create: `frontend/src/__tests__/chatRendering.test.jsx`

---

**Step 1: Write the failing test**

```javascript
// frontend/src/__tests__/chatRendering.test.jsx
import { describe, it, expect } from 'vitest';

/**
 * Unit-tests the message-content rendering guard logic extracted from ChatView.
 *
 * The guard determines what to render inside the message bubble for an AI message:
 * - streaming + no content yet → typing indicator
 * - content present → markdown
 * - streaming done + no content → inline error (the fix)
 * - (old broken behaviour) streaming done + no content → null (blank bubble)
 */
function resolveMessageDisplay({ content, streaming, hasThinking, hasRoutingStep }) {
    if (content === '' && streaming && !hasThinking && !hasRoutingStep) {
        return 'typing-indicator';
    }
    if (content) {
        return 'markdown-content';
    }
    if (!streaming && content === '') {
        return 'no-response-error';   // ← this is what the fix adds
    }
    return 'null-render';             // ← old broken state
}

describe('ChatView blank bubble guard', () => {
    it('renders error state when streaming ends with no content', () => {
        const result = resolveMessageDisplay({
            content: '',
            streaming: false,
            hasThinking: false,
            hasRoutingStep: false,
        });
        expect(result).toBe('no-response-error');
        expect(result).not.toBe('null-render');
    });

    it('renders typing indicator while streaming with no content yet', () => {
        const result = resolveMessageDisplay({
            content: '',
            streaming: true,
            hasThinking: false,
            hasRoutingStep: false,
        });
        expect(result).toBe('typing-indicator');
    });

    it('renders markdown when content is present', () => {
        const result = resolveMessageDisplay({
            content: 'Hello world',
            streaming: false,
            hasThinking: false,
            hasRoutingStep: false,
        });
        expect(result).toBe('markdown-content');
    });

    it('does not show error state while routing status is active and content is empty', () => {
        // During routing, content is empty but routing panel fills the space — do not show error
        const result = resolveMessageDisplay({
            content: '',
            streaming: true,
            hasThinking: false,
            hasRoutingStep: true,
        });
        expect(result).not.toBe('no-response-error');
    });
});
```

**Step 2: Run to verify it fails**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/frontend
npm test -- --run src/__tests__/chatRendering.test.jsx
```

Expected: `renders error state when streaming ends with no content` → FAIL

---

**Step 3: Implement the guard in `ChatView.jsx`**

Locate the message-text rendering block (around lines 322–332). The current innermost `null`:

```javascript
: msg.content
    ? <ReactMarkdown ...>{msg.content}</ReactMarkdown>
    : null
```

Replace `null` with a conditional:

```javascript
: msg.content
    ? <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >{msg.content}</ReactMarkdown>
    : !streaming
        ? <span className="no-response-error">No response received — please try again.</span>
        : null
```

The `!streaming` condition ensures this only shows after streaming is fully complete. During streaming with no content (routing panel or thinking panel active), `null` is still returned — those panels fill the space.

Add the CSS class alongside existing error-related classes in `ChatView.css`:

```css
.no-response-error {
    color: var(--text-secondary, #888);
    font-style: italic;
    font-size: 0.9em;
}
```

**Step 4: Run tests**

```bash
npm test -- --run src/__tests__/chatRendering.test.jsx
```

Expected: 4 PASSED

**Step 5: Run full frontend suite**

```bash
npm test -- --run
```

Expected: All previously passing tests still PASS.

**Step 6: Commit**

```bash
git add frontend/src/components/ChatView.jsx frontend/src/__tests__/chatRendering.test.jsx
git commit -m "fix: show inline error state instead of blank bubble when stream ends with no content"
```

---

## Task 4: Fix Deep Think Escalation Trigger and Keyword Word-Boundary Matching

**Purpose:** Stop doc-size from silently forcing Deep Think into synthesis mode. Stop keywords from matching inside longer phrases.

**Files:**
- Modify: `backend/app/services/routed_llm.py`
- Create: `backend/tests/test_routing_classification.py`

---

**Step 1: Write the failing tests**

Note: `should_escalate_deep_think` and `_quick_classify` are both **synchronous** functions. Tests for them do not need `@pytest.mark.anyio`.

```python
# backend/tests/test_routing_classification.py
"""
Tests for routing classification logic in routed_llm.

Covers:
- should_escalate_deep_think: escalation must be driven by prompt signals only
- _quick_classify: keyword matching must be word-boundary-aware
"""
import pytest
from app.services.routed_llm import should_escalate_deep_think, _quick_classify


# ── Deep Think escalation ────────────────────────────────────────────────────

def test_heavy_context_alone_does_not_escalate():
    """Uploading a large document must NOT trigger DT escalation by itself.
    Only explicit prompt-complexity signals should escalate."""
    short_message = "help me understand this assignment"
    large_context = short_message + "\n\n" + ("A" * 6000)  # typical doc upload size
    assert should_escalate_deep_think(short_message, large_context) is False


def test_reasoning_trigger_escalates():
    """'step by step' in the prompt SHOULD trigger escalation."""
    message = "step by step how do I calculate NPV for this project"
    assert should_escalate_deep_think(message, message) is True


def test_verify_trigger_escalates():
    """'verify' keywords in prompt SHOULD trigger escalation."""
    message = "verify all the requirements I need to meet"
    assert should_escalate_deep_think(message, message) is True


def test_list_all_trigger_escalates():
    """'list all' in prompt SHOULD trigger escalation."""
    message = "list all the constraints for this assignment"
    assert should_escalate_deep_think(message, message) is True


def test_simple_message_does_not_escalate():
    """A simple factual question should never escalate."""
    message = "what is the due date"
    assert should_escalate_deep_think(message, message) is False


def test_large_doc_plus_simple_question_does_not_escalate():
    """A simple question with a huge injected document should not escalate."""
    message = "when is this due"
    large_context = message + "\n\n" + ("B" * 20000)
    assert should_escalate_deep_think(message, large_context) is False


# ── Keyword word-boundary matching ───────────────────────────────────────────

def test_code_of_conduct_not_classified_as_code():
    """'code of conduct' must not be classified as a coding task.
    'code' should only match as a standalone keyword."""
    result = _quick_classify("what is the code of conduct for this module")
    assert result != "code", (
        f"'code of conduct' should not match the code task keyword. Got: '{result}'"
    )


def test_access_code_not_classified_as_code():
    """'access code' should not classify as a coding task."""
    result = _quick_classify("the access code for the student portal is wrong")
    assert result != "code"


def test_explicit_debug_classified_as_code():
    """An actual coding question must still be classified as code."""
    result = _quick_classify("debug this python function for me")
    assert result == "code"


def test_write_code_classified_as_code():
    """'write code' with 'code' as a standalone word must classify as code."""
    result = _quick_classify("write me a code snippet to sort a list")
    assert result == "code"


def test_write_poem_classified_as_creative_or_writing():
    """Creative writing should not be classified as code."""
    result = _quick_classify("write me a short poem about the ocean")
    assert result in ("creative", "writing", None), f"Got unexpected: '{result}'"
```

**Step 2: Run to verify they fail**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI
python -m pytest backend/tests/test_routing_classification.py -v
```

Expected:
- `test_heavy_context_alone_does_not_escalate` → FAIL (heavy_context trigger currently fires)
- `test_code_of_conduct_not_classified_as_code` → likely FAIL (raw substring match)
- Others may pass or fail depending on current state — note the results

---

**Step 3: Remove `heavy_context` from `should_escalate_deep_think()` in `routed_llm.py`**

Locate `should_escalate_deep_think()` (around line 227). Current:

```python
def should_escalate_deep_think(message: str, user_content: str) -> bool:
    lower_msg = message.lower()
    heavy_context = len(user_content) > len(message) + 3000
    list_hit = any(t in lower_msg for t in _DT_LIST_TRIGGERS)
    verify_hit = any(t in lower_msg for t in _DT_VERIFY_TRIGGERS)
    reasoning_hit = any(t in lower_msg for t in _DT_REASONING_TRIGGERS)
    return heavy_context or list_hit or verify_hit or reasoning_hit
```

Replace with (keep `user_content` in signature to avoid changing callers):

```python
def should_escalate_deep_think(message: str, user_content: str) -> bool:
    """Escalate Deep Think to multi-model synthesis only when the visible prompt
    signals complexity. Document size is irrelevant — a large attached file must
    not change how a simple question is answered.

    Triggers (any one is sufficient):
    - List-all requests: 'list all', 'every ', 'all topics', etc.
    - Verification requests: 'verify', 'double check', 'confirm all', etc.
    - Step-by-step reasoning: 'step by step', 'prove', 'derive', etc.
    """
    lower_msg = message.lower()
    list_hit = any(t in lower_msg for t in _DT_LIST_TRIGGERS)
    verify_hit = any(t in lower_msg for t in _DT_VERIFY_TRIGGERS)
    reasoning_hit = any(t in lower_msg for t in _DT_REASONING_TRIGGERS)
    return list_hit or verify_hit or reasoning_hit
```

---

**Step 4: Add word-boundary matching helper and apply it in `_quick_classify()`**

Add `import re` at the top of `routed_llm.py` if not already present. Add this helper function immediately before `_quick_classify()`:

```python
def _word_match(keywords: list[str], text: str) -> bool:
    """Match keywords against text with word-boundary protection.

    Single-word keywords use regex \\b boundaries so 'code' does not match
    inside 'code of conduct'. Multi-word phrases use exact substring match
    (already specific enough to avoid false positives).
    """
    for kw in keywords:
        if " " in kw:
            if kw in text:
                return True
        else:
            if re.search(r"\b" + re.escape(kw) + r"\b", text):
                return True
    return False
```

Then in `_quick_classify()`, replace every occurrence of:
```python
any(kw in lower_msg for kw in XYZ_KEYWORDS)
```
with:
```python
_word_match(XYZ_KEYWORDS, lower_msg)
```

Apply this substitution to every keyword group in the function.

---

**Step 5: Run tests**

```bash
python -m pytest backend/tests/test_routing_classification.py -v
```

Expected: All PASSED.

**Step 6: Run full backend suite**

```bash
python -m pytest backend/tests/ -v
```

Expected: All previously passing tests still PASS.

**Step 7: Commit**

```bash
git add backend/app/services/routed_llm.py backend/tests/test_routing_classification.py
git commit -m "fix: remove heavy_context DT escalation trigger; add word-boundary keyword matching"
```

---

## Task 5: Fix Routed Classification Input (chat.py:337)

**Purpose:** Change the classification call from `user_content` (includes injected docs) to `request.message` (the student's visible question only). This is the highest-impact single-line fix in the sprint.

**Current broken state:** `chat.py:337` reads:
```python
task_type = await classify_task(user_content)
```
`user_content = request.message + injected_assignment_text + file_context`

**After fix:** `chat.py:337` reads:
```python
task_type = await classify_task(request.message)
```

**Files:**
- Modify: `backend/app/api/chat.py`
- Modify: `backend/tests/test_routing_classification.py`

---

**Step 1: Write the failing test**

Append to `backend/tests/test_routing_classification.py`:

```python
# ── Classification input: must use request.message, not user_content ─────────

async def _collect_sse_events(generator):
    """Collect SSE events from an async generator as a list of dicts."""
    import json
    events = []
    async for line in generator:
        line = line.strip()
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return events


@pytest.mark.anyio
async def test_classify_receives_request_message_not_user_content():
    """classify_task must be called with request.message only.

    If called with user_content (which includes injected doc text), the
    10-word conversational short-circuit never fires and keyword matching
    runs on document content instead of the student's question.
    """
    from unittest.mock import AsyncMock, MagicMock, patch

    classify_calls = []

    async def fake_classify(message: str) -> str:
        classify_calls.append(message)
        return "conversational"

    async def fake_stream(*args, **kwargs):
        yield "ok"

    with patch("app.api.chat.classify_task", new=fake_classify):
        with patch("app.api.chat.stream_chat_response", new=fake_stream):
            with patch("app.services.db.DBQuery.execute",
                       new=AsyncMock(return_value=MagicMock(data=[]))):
                from app.models.chat import ChatRequest, ModelTier
                from app.api.chat import post_message

                request = ChatRequest(
                    message="hi",
                    model=ModelTier.ROUTED,
                    session_id="test-classify-input-001",
                    workspace_id="test-workspace-001",
                )
                response = await post_message(request)
                await _collect_sse_events(response.body_iterator)

    assert len(classify_calls) == 1, \
        f"classify_task should be called exactly once, got {len(classify_calls)}"
    assert classify_calls[0] == "hi", (
        f"classify_task must receive request.message ('hi'), "
        f"not user_content. Got: '{classify_calls[0][:80]}'"
    )


@pytest.mark.anyio
async def test_short_message_routes_as_conversational_despite_large_context():
    """A ≤10-word message must route as conversational even when a large
    document is injected into user_content. This was broken when classify_task
    received user_content instead of request.message."""
    from unittest.mock import AsyncMock, MagicMock, patch

    classify_calls = []

    # Real classify_task is async — we let it run for short messages
    # (no LLM call needed; the 10-word check returns immediately)
    with patch("app.api.chat.stream_chat_response", new=AsyncMock()) as fake_stream:
        fake_stream.return_value.__aiter__ = lambda self: iter(["ok"])

        async def fake_stream_gen(*args, **kwargs):
            yield "ok"

        with patch("app.api.chat.stream_chat_response", new=fake_stream_gen):
            with patch("app.services.db.DBQuery.execute",
                       new=AsyncMock(return_value=MagicMock(data=[]))):
                # Also patch resolve_assignment_context to return large doc text
                with patch("app.api.chat.resolve_assignment_context",
                           new=AsyncMock(return_value="A" * 10000)):
                    with patch("app.api.chat.classify_task") as mock_classify:
                        mock_classify.return_value = "conversational"

                        from app.models.chat import ChatRequest, ModelTier
                        from app.api.chat import post_message

                        request = ChatRequest(
                            message="what is due",  # ≤10 words
                            model=ModelTier.ROUTED,
                            session_id="test-classify-input-002",
                            workspace_id="test-workspace-002",
                        )
                        response = await post_message(request)
                        await _collect_sse_events(response.body_iterator)

                        # Verify classify was called with the short message, not the 10KB context
                        call_arg = mock_classify.call_args[0][0]
                        assert call_arg == "what is due", (
                            f"classify_task should receive 'what is due', "
                            f"not '{call_arg[:80]}'"
                        )
```

**Step 2: Run to verify the first test fails**

```bash
python -m pytest backend/tests/test_routing_classification.py::test_classify_receives_request_message_not_user_content -v
```

Expected: FAIL — `classify_calls[0]` will contain `user_content` (the injected doc text), not just `"hi"`.

---

**Step 3: Apply the one-line fix in `chat.py`**

Locate line 337 in `backend/app/api/chat.py`:

```python
task_type = await classify_task(user_content)
```

Change to:

```python
task_type = await classify_task(request.message)
```

That is the complete change. `user_content` is still used for model calls (answer generation). Only classification uses `request.message`.

---

**Step 4: Run tests**

```bash
python -m pytest backend/tests/test_routing_classification.py -v
```

Expected: All PASSED.

**Step 5: Run full backend suite**

```bash
python -m pytest backend/tests/ -v
```

Expected: All previously passing tests still PASS.

**Step 6: Commit**

```bash
git add backend/app/api/chat.py backend/tests/test_routing_classification.py
git commit -m "fix: classify_task now uses request.message not user_content — routing no longer contaminated by injected doc text"
```

---

## Task 6: Add Truthful Attribution for Escalated Deep Think

**Purpose:** When Deep Think escalates to multi-model synthesis, show distinct attribution that makes clear the student received a synthesised answer (not the single-model reasoning experience).

**Files:**
- Modify: `backend/app/api/chat.py`
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/components/ChatView.jsx`

---

**Step 1: Add `deep_think_escalated: true` to the done event in `chat.py`**

Locate the escalated DT done event (around lines 432–443). It currently emits:
```python
yield f'data: {json.dumps({"type": "done", "routed": True, "models_used": [...], "total_tokens": N})}\n\n'
```

Add `"deep_think_escalated": True` to this event only:
```python
yield f'data: {json.dumps({"type": "done", "routed": True, "deep_think_escalated": True, "models_used": [...], "total_tokens": N})}\n\n'
```

The standard Routed path and single-model DT path do **not** get this flag.

---

**Step 2: Pass the flag through in `api.js`**

Locate the `onDone` handler where the done event is parsed (around line 169). Find the block that builds the attribution object when `data.routed` is true. Add `deep_think_escalated`:

```javascript
if (data.type === 'done') onDone(data.routed ? {
    models_used: data.models_used,
    simple: data.routed_simple,
    deep_think_escalated: data.deep_think_escalated ?? false,
    total_tokens: data.total_tokens,
} : { total_tokens: data.total_tokens });
```

---

**Step 3: Update attribution rendering in `ChatView.jsx`**

Locate the attribution footer rendering (around lines 334–345):

```javascript
{msg.attribution.simple
    ? <>⚡ Routed — fast response</>
    : msg.attribution.models_used
        ? <>⚡ Synthesised from {msg.attribution.models_used.join(' · ')}</>
        : null}
```

Replace with:

```javascript
{msg.attribution.simple
    ? <>⚡ Routed — fast response</>
    : msg.attribution.deep_think_escalated && msg.attribution.models_used
        ? <>🧠 Deep analysis — synthesised from {msg.attribution.models_used.join(' · ')}</>
        : msg.attribution.models_used
            ? <>⚡ Synthesised from {msg.attribution.models_used.join(' · ')}</>
            : null}
```

---

**Step 4: Manual verification**

Run the frontend dev server and trigger a Deep Think response with a "step by step" or "verify all" prompt on an uploaded document. Confirm the attribution footer reads "🧠 Deep analysis — synthesised from DeepSeek · Gemini" instead of the generic Synthesised attribution.

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/frontend && npm run dev
```

**Step 5: Commit**

```bash
git add backend/app/api/chat.py frontend/src/api.js frontend/src/components/ChatView.jsx
git commit -m "feat: add deep_think_escalated flag — truthful attribution when DT uses multi-model synthesis"
```

---

## Task 7: Build Routing Classification Evaluation Set

**Purpose:** Create a canonical set of prompts with expected routing outcomes to make future regressions detectable.

**Files:**
- Create: `backend/tests/fixtures/__init__.py`
- Create: `backend/tests/fixtures/routing_eval.py`
- Modify: `backend/tests/test_routing_classification.py`

---

**Step 1: Create the fixtures package**

```bash
touch /Users/javensoh/Documents/Fluxnote-AI/backend/tests/fixtures/__init__.py
```

**Step 2: Create the evaluation fixture**

```python
# backend/tests/fixtures/routing_eval.py
"""
Canonical routing evaluation set for Fluxnote.

Each tuple is: (prompt, expected_result_from__quick_classify)
None means the keyword classifier should return None (no keyword match),
which means classify_task will proceed to the 10-word check or LLM fallback.

Update this set when keyword configuration changes.
"""

# Prompts that _quick_classify should match to a specific task type
QUICK_CLASSIFY_KNOWN_MATCHES = [
    # Code — standalone 'code', 'debug', 'function' etc.
    ("debug this python function", "code"),
    ("write a javascript function to sort an array", "code"),
    ("fix the bug in my code", "code"),

    # Math
    ("solve for x in 2x + 5 = 11", "math"),
    ("calculate the derivative of x squared", "math"),

    # Creative
    ("write me a poem about spring", "creative"),
    ("brainstorm 5 creative ideas for my project", "creative"),

    # Writing
    ("help me improve the tone of this paragraph", "writing"),
    ("proofread my introduction", "writing"),

    # Analysis
    ("analyse the marketing strategy in this document", "analysis"),
    ("compare and contrast these two economic theories", "analysis"),
]

# Prompts that _quick_classify should NOT match as "code" (false positive protection)
QUICK_CLASSIFY_NOT_CODE = [
    "what is the code of conduct for this assignment",
    "the access code for the portal is wrong",
    "the QR code is not scanning",
    "postal code lookup for my address",
]

# Deep Think: prompts that should NOT escalate (no complexity signals)
DT_NO_ESCALATION = [
    "what is the due date",
    "help me understand this",
    "summarise the assignment for me",
    "hi",
    "when is the submission deadline",
]

# Deep Think: prompts that SHOULD escalate (explicit complexity signals in prompt)
DT_SHOULD_ESCALATE = [
    "step by step how do I approach this assignment",
    "verify all the requirements I need to meet",
    "list all the constraints and penalties",
    "prove that this derivation is correct step by step",
    "double check that I have not missed any submission rules",
]
```

**Step 3: Add parametrized tests using the eval set**

Append to `backend/tests/test_routing_classification.py`:

```python
from app.services.routed_llm import should_escalate_deep_think, _quick_classify
from tests.fixtures.routing_eval import (
    QUICK_CLASSIFY_KNOWN_MATCHES,
    QUICK_CLASSIFY_NOT_CODE,
    DT_NO_ESCALATION,
    DT_SHOULD_ESCALATE,
)


@pytest.mark.parametrize("prompt,expected", QUICK_CLASSIFY_KNOWN_MATCHES)
def test_quick_classify_known_matches(prompt, expected):
    """Verify known keyword classification outcomes from the eval set."""
    result = _quick_classify(prompt.lower())
    assert result == expected, (
        f"Prompt '{prompt}': expected '{expected}', got '{result}'"
    )


@pytest.mark.parametrize("prompt", QUICK_CLASSIFY_NOT_CODE)
def test_quick_classify_not_code_false_positives(prompt):
    """Prompts containing 'code' as part of a phrase must not be classified as code."""
    result = _quick_classify(prompt.lower())
    assert result != "code", (
        f"False positive: '{prompt}' should not classify as 'code', got '{result}'"
    )


@pytest.mark.parametrize("message", DT_NO_ESCALATION)
def test_dt_no_escalation_eval_set(message):
    # Large context attached — should still not escalate
    large_context = message + "\n\n" + ("X" * 8000)
    assert should_escalate_deep_think(message, large_context) is False, (
        f"'{message}' should NOT escalate DT"
    )


@pytest.mark.parametrize("message", DT_SHOULD_ESCALATE)
def test_dt_should_escalate_eval_set(message):
    assert should_escalate_deep_think(message, message) is True, (
        f"'{message}' SHOULD escalate DT"
    )
```

**Step 4: Run all routing classification tests**

```bash
python -m pytest backend/tests/test_routing_classification.py -v
```

Expected: All PASSED. If any eval case fails, fix the keyword lists in `routed_llm.py` before committing.

**Step 5: Commit**

```bash
git add backend/tests/fixtures/ backend/tests/test_routing_classification.py
git commit -m "test: add routing evaluation set — canonical prompts for keyword and DT escalation coverage"
```

---

## Task 8: Add asyncio.timeout to Synthesis Stream

**Purpose:** Prevent a hung synthesis model from holding the student's connection for the full Vercel 60s limit.

**Files:**
- Modify: `backend/app/api/chat.py`
- Modify: `backend/tests/test_chat_reliability.py`

---

**Step 1: Write the failing test**

Append to `backend/tests/test_chat_reliability.py`:

```python
@pytest.mark.anyio
async def test_synthesis_timeout_emits_error_not_silence():
    """When synthesis stream hangs beyond SYNTHESIS_TIMEOUT_S, an error SSE event
    is emitted. The client must never receive silence for the full 60s Vercel limit."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch

    async def hanging_synthesis(*args, **kwargs):
        await asyncio.sleep(9999)
        yield "never"

    with patch("app.api.chat.stream_synthesis", new=hanging_synthesis):
        with patch("app.api.chat.gather_model_responses",
                   new=AsyncMock(return_value=[{"model_id": "test", "display_name": "Test",
                                                "content": "ok", "tokens": 10}])):
            with patch("app.services.db.DBQuery.execute",
                       new=AsyncMock(return_value=MagicMock(data=[]))):
                # Temporarily shorten the timeout so the test runs fast
                with patch("app.api.chat.SYNTHESIS_TIMEOUT_S", 0.1):
                    from app.models.chat import ChatRequest, ModelTier
                    from app.api.chat import post_message

                    request = ChatRequest(
                        message="analyse this document for me",
                        model=ModelTier.ROUTED,
                        session_id="test-synthesis-timeout-001",
                        workspace_id="test-workspace-001",
                    )
                    response = await post_message(request)
                    events = await _collect_sse_events(response.body_iterator)

    event_types = [e.get("type") for e in events]
    assert "error" in event_types, (
        f"Synthesis timeout should emit error event. Got: {event_types}"
    )
    assert "done" not in event_types, (
        f"Synthesis timeout must not emit done event. Got: {event_types}"
    )
```

**Step 2: Run to verify it fails**

```bash
python -m pytest backend/tests/test_chat_reliability.py::test_synthesis_timeout_emits_error_not_silence -v
```

Expected: FAIL (no `SYNTHESIS_TIMEOUT_S` constant; no timeout applied)

---

**Step 3: Add `SYNTHESIS_TIMEOUT_S` constant and wrap synthesis loops in `chat.py`**

Near the top of `chat.py`, alongside the other limit constants (`CHAT_FILE_CONTEXT_LIMIT`, etc.), add:

```python
SYNTHESIS_TIMEOUT_S = 45.0
```

Add `import asyncio` at the top of `chat.py` if not already present.

Locate the synthesis consumption loop in the Routed MoA path (around line 377–408). Wrap it:

```python
try:
    async with asyncio.timeout(SYNTHESIS_TIMEOUT_S):
        synthesis_usage: dict = {}
        async for chunk in stream_synthesis(model_results, task_type, messages, usage_out=synthesis_usage):
            chunks.append(chunk)
            yield "data: " + json.dumps({"type": "chunk", "content": chunk}) + "\n\n"
except asyncio.TimeoutError:
    logger.warning(
        "chat: synthesis timeout after %.0fs for task=%s", SYNTHESIS_TIMEOUT_S, task_type
    )
    yield "data: " + json.dumps({
        "type": "error",
        "message": "Response took too long — please try again.",
    }) + "\n\n"
    return
```

Apply the same `asyncio.timeout` wrap to the DT escalation synthesis path.

---

**Step 4: Run tests**

```bash
python -m pytest backend/tests/test_chat_reliability.py -v
```

Expected: All 4 tests PASSED (3 original + 1 new).

**Step 5: Run full backend suite**

```bash
python -m pytest backend/tests/ -v
```

Expected: All PASSED.

**Step 6: Commit**

```bash
git add backend/app/api/chat.py backend/tests/test_chat_reliability.py
git commit -m "fix: add 45s asyncio.timeout to synthesis — prevents hung model from exhausting Vercel connection"
```

---

## Task 9: Fix Documentation Drift

**Purpose:** Make README and code comments accurate.

**Files:**
- Modify: `backend/README.md`
- Modify: `backend/app/services/ai_router.py`

---

**Step 1: Update the AI Model Tiers section in `backend/README.md`**

Locate the "AI Model Tiers" section (lines ~129–137). It currently lists Mistral, Gemma, and DeepSeek R1 distill. Replace the entire section with:

```markdown
## AI Model Tiers

All model IDs are set in `backend/app/config.py` via environment variables.

| UI Label | OpenRouter Model ID (default) | Role in pipeline |
|---|---|---|
| Fast | `inception/mercury-2` | Quick responses; assignment extraction; conversational Routed short-circuit; task classification |
| Balanced | `openai/gpt-5-nano` | Balanced reasoning and speed; used as a MoA proposer in Routed |
| Deep Think | `deepseek/deepseek-v3.2` | Extended reasoning; single-model Deep Think; MoA synthesis |
| Deep Think Secondary | `google/gemini-3.1-flash-lite-preview` | Deep Think escalation backup; MoA breadth proposer |
| Vision | `google/gemini-3.1-flash-lite-preview` | Image OCR for document extraction |

Streaming uses OpenRouter's SSE format with `include_usage: true` for token tracking.
Single-model paths use `stream_chat_response()` in `ai_router.py`.
Multi-model paths (Routed, DT escalation) use `routed_llm.py` (Mixture of Agents).
```

---

**Step 2: Fix the stale comment in `ai_router.py`**

Locate the comment near line 88 inside `stream_chat_response_with_thinking()` that references "Claude Haiku 4.5". Replace it with:

```python
# Uses settings.MODEL_DEEP_THINK (deepseek/deepseek-v3.2 by default) with extended
# reasoning enabled via the 'reasoning' payload key. OpenRouter exposes reasoning
# tokens under different field names depending on the provider; all known variants
# are checked below.
```

---

**Step 3: Commit**

```bash
git add backend/README.md backend/app/services/ai_router.py
git commit -m "docs: update README model table to match config.py; fix stale comment in ai_router"
```

---

## Task 10: Final Verification and Branch Readiness

**Step 1: Run full backend suite**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI
python -m pytest backend/tests/ -v --tb=short
```

Expected: All PASSED. Record total test count.

**Step 2: Run full frontend suite**

```bash
cd frontend && npm test -- --run
```

Expected: All PASSED.

**Step 3: Verify only expected files changed**

```bash
git diff main..feat/chat-reliability-sprint --name-only
```

Expected file list (only these — verify no extras):
```
backend/app/services/ai_router.py
backend/app/services/routed_llm.py
backend/app/api/chat.py
backend/README.md
frontend/src/components/ChatView.jsx
frontend/src/api.js
backend/tests/test_observability.py
backend/tests/test_routing_classification.py
backend/tests/test_chat_reliability.py
backend/tests/fixtures/__init__.py
backend/tests/fixtures/routing_eval.py
frontend/src/__tests__/chatRendering.test.jsx
docs/plans/2026-03-08-chat-reliability-sprint-design.md
docs/plans/2026-03-08-chat-reliability-sprint-impl.md
```

**Step 4: Manual smoke test checklist**

Before presenting to CEO, manually verify using the dev server:

- [ ] **Fast:** Send a message, receive a response, see attribution with token count
- [ ] **Balanced:** Send a message — receive either a clear answer or a clear error; never a blank bubble
- [ ] **Deep Think (simple question + uploaded doc):** Upload a doc, ask "what is the due date" → ThinkingPanel shows single-model reasoning (NOT routed)
- [ ] **Deep Think (escalation trigger):** Ask "step by step how do I approach this" with a doc → attribution shows "🧠 Deep analysis — synthesised from DeepSeek · Gemini"
- [ ] **Routed — conversational short-circuit:** Send "hi" → fast path, no routing status shown
- [ ] **Routed — code of conduct:** Send "what is the code of conduct" → NOT classified as code task
- [ ] **Routed — actual code question:** Send "debug this python function" → classified as code task
- [ ] **Blank bubble test:** Simulate empty stream (can disconnect network mid-stream) → "No response received — please try again." shown inline

**Step 5: Push branch**

```bash
git push -u origin feat/chat-reliability-sprint
```

Do NOT open a PR until CEO approves.

---

## Recommended Execution Order

```
Task 1 → Observability          (measure baseline first)
Task 2 → Synthesis tokens       (completes observability picture)
Task 3 → Frontend blank bubble  (user-visible; no backend deps; can run parallel with Task 2)
Task 4 → DT escalation + keywords
Task 5 → Classification input   (the one-line bug; depends on Task 4 tests being in place)
Task 6 → Truthful DT attribution
Task 7 → Evaluation set         (depends on Tasks 4+5 being correct)
Task 8 → Synthesis timeout
Task 9 → Docs
Task 10 → Final verification
```

Tasks 2 and 3 are independent of each other and can run in parallel if using sub-agents.

---

## What Does NOT Change

- Assignment extraction, kanban board, re-extract flow — untouched
- Model UI labels: Fast / Balanced / Deep Think / Routed — unchanged, no renames
- Database schema — no migrations required
- Single-model Deep Think `ThinkingPanel` — preserved exactly as-is
- Balanced model no-silent-fallback policy — preserved (already enforced in Foundation Stabilization)
- Chat history, workspace notes, file upload, OCR pipeline — untouched
- `STUDENT_SYSTEM_PROMPT` in `chat.py` — untouched
- Vercel deployment configuration — untouched

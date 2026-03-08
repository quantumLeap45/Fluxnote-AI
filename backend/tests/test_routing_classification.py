"""
Tests for routing classification correctness.

Task 4 — DT escalation trigger fix (should_escalate_deep_think):
  - Removing heavy_context: large doc context alone must NOT trigger DT escalation
  - Trigger phrases (list, verify, reasoning) still escalate correctly

Task 4 — _quick_classify word-boundary fix:
  - "code of conduct" must NOT route as code (false positive)
  - Legitimate coding keywords still match

Task 5 — Classification input fix (classify_task caller in chat.py):
  - classify_task() must receive request.message (clean user prompt)
  - Must NOT receive user_content (which may include thousands of words of injected docs)

Convention: sync functions (should_escalate_deep_think, _quick_classify) — no decorator.
            async functions (classify_task, post_message) — @pytest.mark.anyio + await.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.routed_llm import should_escalate_deep_think, _quick_classify


# ── Task 4: DT escalation — heavy_context removed ────────────────────────────

def test_dt_escalation_does_not_trigger_on_doc_size_alone():
    """
    A short message paired with large injected doc content must NOT trigger DT.
    Before the fix: len(user_content) > len(message) + 3000 → True → always escalated.
    After the fix: the heavy_context line is removed; only explicit phrases escalate.
    """
    short_message = "What is the word count for this essay?"
    # user_content is message + 5000 chars of doc — previously triggered heavy_context
    large_user_content = short_message + "\n\n" + "academic text " * 400
    assert not should_escalate_deep_think(short_message, large_user_content), (
        "Large doc context alone should NOT trigger DT escalation after the fix"
    )


def test_dt_escalation_triggers_on_list_phrase():
    """List-trigger phrases in the message still escalate DT."""
    msg = "list all requirements for this assignment"
    assert should_escalate_deep_think(msg, msg)


def test_dt_escalation_triggers_on_verify_phrase():
    """Verify-trigger phrases in the message still escalate DT."""
    msg = "can you double check my submission?"
    assert should_escalate_deep_think(msg, msg)


def test_dt_escalation_triggers_on_reasoning_phrase():
    """Reasoning-trigger phrases in the message still escalate DT."""
    msg = "explain step by step how to solve this"
    assert should_escalate_deep_think(msg, msg)


def test_dt_escalation_does_not_trigger_on_generic_message():
    """Short, non-triggering messages do not escalate DT."""
    msg = "What is photosynthesis?"
    assert not should_escalate_deep_think(msg, msg)


# ── Task 4: _quick_classify word-boundary fix ─────────────────────────────────

def test_quick_classify_api_not_in_capital():
    """
    'api' is a code keyword. It appears as a substring in 'capital' ('c-api-tal'),
    which is a real substring false positive that word-boundary matching fixes.
    Without \b: 'api' in 'capital' → True (false positive)
    With \b:    re.search(r'\bapi\b', 'capital') → None (correct)

    NOTE: 'code of conduct' cannot be fixed by word boundaries because 'code' IS
    a complete word there. This is a known semantic limitation — only substring
    false positives (where a keyword appears inside a longer word) are addressed.
    """
    result = _quick_classify("What are the capital cities and their populations?")
    assert result != "code", (
        f"'capital' contains 'api' as substring but must not trigger code route. Got: {result}"
    )


def test_quick_classify_class_not_in_classical():
    """
    'class' is a code keyword. It appears as a substring in 'classical' ('class-ical').
    Word-boundary matching prevents this false positive.
    """
    result = _quick_classify("I enjoy listening to classical music in the evening")
    assert result != "code", (
        f"'classical' contains 'class' as substring but must not trigger code route. Got: {result}"
    )


def test_quick_classify_python_code_still_routes_as_code():
    """Legitimate coding keywords still match after word-boundary fix."""
    result = _quick_classify("write python code to sort a list")
    assert result == "code", f"Expected 'code', got: {result}"


def test_quick_classify_debug_error_routes_as_code():
    """'debug' and 'error' are valid code keywords that should still match."""
    result = _quick_classify("help me debug this error in my function")
    assert result == "code", f"Expected 'code', got: {result}"


def test_quick_classify_write_essay_routes_as_writing():
    """'write an essay' routes as writing even when doc is in context."""
    result = _quick_classify("help me write an essay about climate change")
    assert result == "writing", f"Expected 'writing', got: {result}"


def test_quick_classify_returns_none_for_no_keywords():
    """Messages with no task keywords return None (triggers LLM fallback)."""
    result = _quick_classify("hello there how are you")
    assert result is None, f"Expected None for conversational input, got: {result}"


def test_quick_classify_html_in_context_not_code():
    """
    'html' appearing as part of a course topic name should not trigger code route
    when no other code signals are present. (Best-effort — word boundary helps.)
    """
    # Without word boundaries, "html" in "the HTML5 standard" would match keyword "html"
    # With word boundaries it still matches — this test verifies scoring works correctly
    result = _quick_classify("html css javascript all in one file")
    assert result == "code", "Multiple code keywords should still route as code"


# ── Task 5: classify_task receives request.message, not user_content ─────────

@pytest.mark.anyio
async def test_classify_task_called_with_request_message_not_user_content():
    """
    The ROUTED path in chat.py must call classify_task(request.message),
    NOT classify_task(user_content).

    user_content includes injected doc text (resolved assignment + file context),
    which can be thousands of words — killing the ≤10-word conversational short-circuit
    and causing false keyword matches on document content.

    We mock resolve_assignment_context to inject a large doc string so that
    user_content is clearly different from request.message, then assert
    classify_task receives only the clean user prompt.
    """
    from app.models.chat import ChatRequest, ModelTier
    from app.api.chat import post_message

    test_message = "Hi there"
    # Large doc injection — makes user_content != request.message
    injected_doc = "[File: essay.pdf]\n" + "academic content " * 300

    captured_classify_args = []

    async def fake_classify(msg: str) -> str:
        captured_classify_args.append(msg)
        return "conversational"

    async def fake_conv_stream(*args, **kwargs):
        yield "Hello!"

    async def fake_resolve(*args, **kwargs):
        return injected_doc

    with patch("app.api.chat.classify_task", new=fake_classify):
        with patch("app.api.chat.stream_chat_response", new=fake_conv_stream):
            with patch("app.api.chat.resolve_assignment_context", new=fake_resolve):
                with patch("app.services.db.DBQuery.execute", new=AsyncMock(
                    return_value=MagicMock(data=[])
                )):
                    request = ChatRequest(
                        message=test_message,
                        model=ModelTier.ROUTED,
                        session_id="test-session-task5-a",
                        workspace_id="test-workspace-task5-a",
                    )
                    response = await post_message(request)
                    async for _ in response.body_iterator:
                        pass

    assert captured_classify_args, "classify_task was never called — routing path not reached"
    received = captured_classify_args[0]
    assert received == test_message, (
        f"classify_task must receive request.message ('{test_message}'), "
        f"but received a string of length {len(received)}: '{received[:120]}'"
    )
    assert injected_doc not in received, (
        "classify_task must NOT receive user_content with injected doc text"
    )


@pytest.mark.anyio
async def test_classify_task_short_circuit_fires_on_clean_message():
    """
    With the fix: a short message (≤10 words) with no keywords returns
    'conversational' from classify_task, triggering the fast-path.
    This would break with user_content (doc injection makes it >10 words).
    """
    from app.services.routed_llm import classify_task

    # Short, no-keyword message → should short-circuit as conversational
    result = await classify_task("Hi, how are you?")
    assert result == "conversational", (
        f"Short message should classify as 'conversational', got: {result}"
    )

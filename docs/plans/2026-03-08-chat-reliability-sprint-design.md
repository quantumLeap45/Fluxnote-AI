# Fluxnote — AI Chat Reliability, Routing & Observability Sprint

**Date:** 2026-03-08
**Status:** Draft — awaiting CEO approval
**Branch:** `feat/chat-reliability-sprint` (to be created from `main`)

---

## What This Solves

Students occasionally see a blank AI response — the bubble appears but contains nothing — with no explanation of what went wrong. Separately, the "Deep Think" mode sometimes silently switches its internal behaviour based on how large an attached document is, rather than on what the student actually asked, producing inconsistent results. There is also no visibility into what the AI pipeline is actually doing internally, making it impossible to measure whether fixes are working.

This sprint locks down these gaps: make every AI response either produce a visible answer or show a clear failure message, make Deep Think behave consistently based on the question (not the document size), tighten how Fluxnote decides which models to use, and add the measurement tools to prove improvements are real.

---

## What Gets Built

### Change 1: Blank Response Guard (Frontend)

Right now, if the AI stream ends without producing any text content, the chat bubble shows nothing — no answer, no error, no indication of failure. After this change, if streaming completes with no visible content, the bubble shows an inline message: **"No response received — please try again."** The user always sees a clear outcome; the silent blank state is eliminated.

### Change 2: AI Pipeline Observability

Every AI response now writes a structured log entry recording: which model responded, how many content chunks arrived, whether any visible content was produced, how long the first token took to appear, total response duration, and token count. Malformed frames from the AI provider are also logged (at debug level) instead of silently discarded. This creates a before/after measurement baseline for all other fixes.

Token usage for Routed mode responses (which use a synthesis step) is also now tracked fully and included in the response metadata.

### Change 3: Deep Think Escalation Fix

Deep Think currently switches from its single-model reasoning mode (which shows the student the step-by-step thinking) to a multi-model synthesis mode (which hides reasoning) whenever an attached document is larger than 3KB. A one-page assignment brief is enough to trigger this — meaning students who upload documents almost never get the real Deep Think experience.

After this fix, Deep Think only escalates to multi-model synthesis when the student's question itself signals complexity: asking to "verify all requirements", "list all constraints", "prove step by step", etc. Uploading a document no longer forces escalation by itself.

When Deep Think does escalate to synthesis (because the question warrants it), the attribution footer clearly says **"Deep analysis — synthesised from DeepSeek · Gemini"** rather than the generic Routed attribution. The student can see what happened and why the answer looks different.

### Change 4: Routing Keyword Precision

The system that decides which AI models to use for a Routed question currently uses simple text matching. This means a question like "what is the code of conduct for this assignment?" could incorrectly be classified as a coding question. After this fix, keyword matching is word-boundary-aware — "code" only matches as an isolated word, not as part of a longer phrase.

A small evaluation set of representative student prompts (15–20 examples) is created to verify classification is correct and to prevent future regressions.

### Change 5: Synthesis Timeout Safety

When Routed mode uses multiple models and synthesises their answers, the synthesis step currently has no hard cutoff — if the synthesis model hangs, it can hold the student's connection open for the full 60-second server limit before failing. After this change, a 45-second timeout is applied to synthesis. If it expires, the student sees a clear error rather than an indefinite wait.

### Change 6: Documentation Cleanup

The backend README currently lists entirely wrong AI models (Mistral, Gemma, and an old DeepSeek version) — models that have not been used since early development. This is updated to accurately reflect the five models currently running in production. A stale internal code comment is also removed.

---

## What Does NOT Change

- Assignment extraction, kanban board, document upload — untouched
- Model labels shown in the UI: Fast, Balanced, Deep Think, Routed — unchanged
- The single-model Deep Think reasoning panel — preserved exactly as-is
- The Balanced model's strict no-fallback policy (already in place from Foundation Stabilization)
- Chat history, workspace notes, file management — untouched
- Database schema — no migrations required

---

## CEO Actions Required

None. No database migrations, no new environment variables, no deployment configuration changes required for this sprint.

---

## Decision Log

| Decision | Options considered | Choice | Reason |
|----------|--------------------|--------|--------|
| Remove heavy-context DT escalation trigger vs. raise the threshold | Remove entirely / Raise to 10KB / Keep but add prompt signal requirement | Remove entirely | A 3KB threshold is too low — a single uploaded brief exceeds it. Explicit prompt signals (verify, list all, step by step) are sufficient and more honest to what the student actually asked. |
| Blank bubble handling: error banner vs. inline error | Global error banner at top of chat / Inline error in the message bubble | Inline in bubble | The student can see exactly which message failed. Banner is less specific. |
| Token tracking for synthesis: add to backend log vs. include in frontend count | Both | Both | The log gives diagnostic data; the frontend count gives the student visibility. |
| Synthesis timeout: 30s / 45s / 60s | 30s / 45s / 60s | 45s | Vercel limit is 60s; 45s leaves buffer for teardown. 30s is too aggressive for a legitimate 3-model synthesis. |
| Keyword word-boundary matching: regex \b vs. split-and-compare | Regex \b / Split message into tokens | Regex \b | Simpler, same result for English text, lower complexity. |
| Model count for analysis/general routing: reduce to 2 vs. keep 3 | Reduce to 2 / Keep 3 / Make dynamic | Keep 3 for now | Founder priority: quality over speed. No evidence yet that 3 models causes unacceptable latency. Observability work will provide data for a future decision. |

# Fluxnote — Pre-Launch Reliability Fixes

**Date:** 2026-03-12
**Status:** Approved by CEO
**Branch:** fix/pre-launch-reliability

---

## What This Solves

Six issues were discovered during a full end-to-end product test ("food test") before the soft rollout to trusted friends. Left unfixed, these would give early users a rough first impression: cards failing to extract, Deep Think cutting off mid-answer, accidental chat deletions, and maths not rendering. This sprint fixes all six before any user sees the product.

---

## What Gets Built

### Change 1: Assignment Extraction No Longer Truncates

**Problem:** Cards were failing with "malformed JSON" because the AI's response was being cut off mid-output. The extraction call was set to only allow 1,024 tokens of response — not enough for a full card with summary, checklist, and constraints.

**Fix:** Increase the response token budget from 1,024 to 2,048. No schema changes, no new tables, no new API calls.

---

### Change 2: Deep Think No Longer Times Out

**Problem:** Deep Think (DeepSeek with reasoning) often takes 70–90 seconds to produce a response. Vercel was killing the server function after exactly 60 seconds, causing the response to cut off or disappear.

**Fix:** Update the Vercel backend configuration to allow functions to run for up to 300 seconds (5 minutes). This requires the Vercel Pro plan.

> **CEO Action Required:** Confirm that the backend project on Vercel is on the Pro plan (or upgrade it). The configuration change is ready; it only takes effect on Pro. The free/hobby plan has a hard 60-second cap that cannot be raised.

---

### Change 3: Card Creation — No More Duplicate Failed Cards

**Problem:** When a card failed to extract, the "Create Card" button stayed active. Each retry uploaded the file again and created a new failed record in the database — so one failed attempt became three identical failed cards on the dashboard.

**Fix:** After a failure, lock the Create Card button permanently and show a message directing the user to the Dashboard (where they can use the existing "Re-extract" button to retry cleanly from there).

---

### Change 4: Chat Delete Now Asks for Confirmation

**Problem:** Clicking the trash icon in the sidebar deleted a chat immediately with no warning — easy to trigger by accident.

**Fix:** A confirmation dialog ("Delete this chat?") appears before any chat is deleted. If the user clicks Cancel, nothing happens.

---

### Change 5: Maths Renders Correctly in All Modes

**Problem:** When using Routed mode (Mixture of Agents), the synthesis step sometimes wrote maths using `\[...\]` notation instead of the `$...$` dollar-sign notation that our renderer understands. Maths appeared as raw text instead of formatted equations.

**Fix (two-part):**
- The synthesis prompt is updated to explicitly require `$...$` notation.
- As a safety net, the frontend pre-processes any `\[...\]` or `\(...\)` in AI responses and converts them to the correct dollar-sign form before rendering. This ensures correct display even if the AI ever deviates from the instruction.

---

### Change 6: Dashboard Explains the No-Login Model

**Problem:** Users unfamiliar with Fluxnote may not realise that their dashboard data is browser-specific (no account, no login). If they open Fluxnote on a different device or clear their browser, their cards are gone. Discovering this by accident is a jarring experience.

**Fix:** A subtle informational banner at the top of the Dashboard explains this in plain language ("Your dashboard is saved in this browser — not synced across devices."). The banner can be permanently dismissed with a single click, and the dismissal is remembered.

---

## What Does NOT Change

- All chat functionality (Fast, Balanced, Deep Think, Routed modes)
- File upload flow (Supabase Storage path and direct upload path)
- Assignment cards that already exist — no migration needed
- The Kanban board and card detail views
- The "Ask AI" feature
- Any backend database schema
- Any API routes or response formats
- The existing Re-extract flow on the Dashboard
- Any CSS or visual design outside the storage banner

---

## CEO Actions Required

**Before deployment:** Confirm that the Vercel backend project is on the **Pro plan** (or upgrade it at vercel.com). The `maxDuration: 300` config in Change 2 only takes effect on Pro — on Hobby it is silently ignored and the 60-second cap remains.

---

## Decision Log

| Decision | Options considered | Choice | Reason |
|----------|--------------------|--------|--------|
| Deep Think timeout | (a) Keep 60s + surface timeout error; (b) Raise Vercel maxDuration to 300s | Raise maxDuration | CEO preference: fix capability, not limit it |
| Card retry | (a) Allow retry in panel; (b) Lock panel, redirect to Dashboard | Lock + redirect | Prevents duplicate records; Dashboard Re-extract already exists |
| LaTeX fix | (a) Prompt-only fix; (b) Frontend normalizer only; (c) Both | Both | Belt-and-suspenders: prompt reduces frequency, normalizer guarantees correctness |
| Storage banner | (a) Show once at app load; (b) Dashboard-only dismissible banner | Dashboard banner | Least intrusive; visible when users first encounter their cards |

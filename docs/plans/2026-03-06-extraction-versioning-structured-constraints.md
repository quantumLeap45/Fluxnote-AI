# Fluxnote — Extraction Versioning + Structured Constraints Display

**Date:** 2026-03-06
**Status:** Approved by CEO — ready for implementation
**Branch:** feature/v0.5 (continuing on same branch)

---

## What This Solves

Two problems:

1. **Constraints is a wall of text.** The AI currently writes the "Requirements & Constraints" section as one long paragraph. Students can't scan it quickly.

2. **No safe upgrade path for existing cards.** When we improve the AI extraction prompt, existing cards are stuck on the old version. We need a way to offer students an upgrade without surprising them mid-task.

---

## What Gets Built

### Change 1: Structured Constraints Display
- The AI writes `constraints` as markdown with labelled bullet sections (e.g. `**Word count:** Max 2,000 words`)
- The card modal renders `constraints` using ReactMarkdown instead of a plain paragraph
- Works immediately for all new cards; old cards degrade gracefully (plain text still renders fine in ReactMarkdown)

### Change 2: Extraction Versioning
- Every card is stamped with `extraction_version` (integer) when extraction runs
- Current prompt = version 1 (existing cards, DB default)
- New structured prompt = version 2 (all new cards after this deployment)
- CEO SQL migration: `ALTER TABLE assignments ADD COLUMN IF NOT EXISTS extraction_version int DEFAULT 1;`

### Change 3: Opt-In Update Banner
- When a student opens a card with `extraction_version < 2`, a one-time banner appears:
  > "We've improved how Fluxnote analyses this type of assignment. Refresh for a more accurate breakdown — or keep things exactly as they are. Note: refreshing will reset your checklist ticks."
- Two buttons: **Keep current** · **Refresh analysis**
- "Keep current" — dismisses the banner permanently for that card (stored in localStorage)
- "Refresh analysis" — calls the backend re-extract endpoint, updates the card in place, clears the banner

### Change 4: Re-extract API Endpoint
- New backend endpoint: `POST /api/v1/assignments/{id}/re-extract`
- Fetches the assignment's original file content, re-runs extraction with the latest prompt, updates the card with new data + sets `extraction_version = 2`
- Returns the updated card to the frontend

---

## What Does NOT Change
- Kanban column position — untouched by re-extraction
- Card creation flow — no change
- File upload — no change
- Checklist tick state — explicitly warned in the banner that ticks will reset
- AI-assisted checklist migration — deferred to v0.7

---

## Files Changed

| File | Change |
|------|--------|
| `backend/app/api/assignments.py` | Add `extraction_version: 2` to extraction update dict; add re-extract endpoint |
| `backend/app/services/assignment_extractor.py` | Update prompt — constraints as markdown bullet groups |
| `frontend/src/components/AssignmentDetail.jsx` | ReactMarkdown for constraints; update banner logic |
| `frontend/src/components/AssignmentDetail.css` | Banner styles; markdown constraints styles |
| `frontend/src/api.js` | Add `reExtractAssignment()` function |

---

## CEO Action Required Before Deploy

Run in Supabase SQL Editor:
```sql
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS extraction_version int DEFAULT 1;
```

---

## Versioning Convention Going Forward

| extraction_version | Prompt used | When |
|--------------------|-------------|------|
| 1 | Original prompt (plain text constraints) | All cards before this update |
| 2 | Structured markdown constraints prompt | All cards after this update |

When we improve the prompt again in future: bump backend constant to 3, bump frontend `CURRENT_EXTRACTION_VERSION` constant to 3. Old cards show the banner again. Same pattern, forever.

---

## Out of Scope
- AI-assisted checklist migration (deferred to v0.7)
- Persistent banner dismissal in DB (localStorage is sufficient for now)
- Automatic background re-extraction (never — always opt-in)

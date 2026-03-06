# Extraction Versioning + Structured Constraints — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stamp every new assignment card with `extraction_version: 2`, render `constraints` as structured markdown, and show an opt-in upgrade banner on old cards (version 1).

**Architecture:** Backend writes `extraction_version: 2` on all new extractions. A new `/re-extract` endpoint re-runs extraction on demand. Frontend reads the version field: cards with version < 2 show a one-time upgrade banner; dismissals are recorded in localStorage. `constraints` is rendered via ReactMarkdown in the detail modal.

**Tech Stack:** FastAPI (Python), React 19, ReactMarkdown (already installed), Supabase PostgreSQL

**Pre-requisite (CEO action — must be done before Task 1):**
```sql
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS extraction_version int DEFAULT 1;
```

---

### Task 1: Update extraction prompt — structured markdown constraints

**Files:**
- Modify: `backend/app/services/assignment_extractor.py`

**Step 1: Update the `constraints` field description in `EXTRACTION_SYSTEM_PROMPT`**

Replace the current `"constraints"` field description with one that outputs grouped markdown bullets.

Open `backend/app/services/assignment_extractor.py` and replace the `constraints` line inside the schema section (currently: `"A plain-English paragraph (or bullet list)..."`):

```python
  \"constraints\":     \"Structured markdown with labeled bullet groups. Use this exact format — only include groups that are present in the document:\\n## What NOT To Do\\n- ...\\n## Format & Length Limits\\n- ...\\n## Tools & Methods\\n- ...\\n## Data & Resources\\n- ...\\n## Objective & Goal\\n- ...\\n## Quality Expectations\\n- ...\\n## Submission & Late Policy\\n- ...\\nIf none found, output null.\",
```

**Step 2: Verify JSON is still valid — start the dev server**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/backend
python -c "from app.services.assignment_extractor import EXTRACTION_SYSTEM_PROMPT; print('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/assignment_extractor.py
git commit -m "feat: structured markdown constraints in extraction prompt (v2)"
```

---

### Task 2: Backend — stamp extraction_version + add re-extract endpoint

**Files:**
- Modify: `backend/app/api/assignments.py`
- Modify: `backend/app/models/assignment.py`

**Step 1: Add `extraction_version` to the Supabase update dict in `create_assignment`**

In `backend/app/api/assignments.py`, in the `update()` call inside the `try` block (around line 76), add this field:

```python
"extraction_version": 2,
```

Full updated dict section:
```python
await (
    db.table("assignments")
    .update({
        "processing_state": ProcessingState.READY.value,
        "title":            extracted.get("title"),
        "module":           extracted.get("module"),
        "due_date":         safe_due_date,
        "weightage":        extracted.get("weightage"),
        "assignment_type":  extracted.get("assignment_type"),
        "deliverable_type": extracted.get("deliverable_type"),
        "marks":            extracted.get("marks"),
        "summary":          extracted.get("summary", []),
        "checklist":        extracted.get("checklist", []),
        "constraints":      extracted.get("constraints"),
        "extraction_version": 2,
        "updated_at":       datetime.now(timezone.utc).isoformat(),
    })
    .eq("id", assignment_id)
    .execute()
)
```

**Step 2: Add `re_extract` endpoint at the bottom of `assignments.py`**

Append after the `delete_assignment` route:

```python
@router.post("/{assignment_id}/re-extract")
async def re_extract_assignment(assignment_id: str, session_id: str = Query(...)):
    """Re-run AI extraction on an existing assignment using the latest prompt."""
    # Fetch the assignment to get its file content
    row = await (
        db.table("assignments")
        .select("*")
        .eq("id", assignment_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment = row.data[0]
    all_file_ids = assignment.get("file_ids") or ([assignment["file_id"]] if assignment.get("file_id") else [])
    if not all_file_ids:
        raise HTTPException(status_code=400, detail="No files attached to this assignment")

    file_resp = await (
        db.table("files")
        .select("id, name, content")
        .in_("id", all_file_ids)
        .eq("session_id", session_id)
        .execute()
    )
    if not file_resp.data:
        raise HTTPException(status_code=404, detail="Source files not found")

    char_budget = 8000
    per_file = char_budget // len(file_resp.data)
    combined_content = "\n\n---\n\n".join(
        f"[File: {f['name']}]\n{(f.get('content') or '')[:per_file]}"
        for f in file_resp.data
    )

    # Mark as processing
    await (
        db.table("assignments")
        .update({
            "processing_state": ProcessingState.PROCESSING.value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", assignment_id)
        .execute()
    )

    try:
        extracted = await extract_assignment_data(combined_content)

        import re as _re
        raw_due = extracted.get("due_date")
        safe_due_date = raw_due if raw_due and _re.match(r'^\d{4}-\d{2}-\d{2}$', str(raw_due)) else None

        await (
            db.table("assignments")
            .update({
                "processing_state": ProcessingState.READY.value,
                "title":            extracted.get("title"),
                "module":           extracted.get("module"),
                "due_date":         safe_due_date,
                "weightage":        extracted.get("weightage"),
                "assignment_type":  extracted.get("assignment_type"),
                "deliverable_type": extracted.get("deliverable_type"),
                "marks":            extracted.get("marks"),
                "summary":          extracted.get("summary", []),
                "checklist":        extracted.get("checklist", []),
                "constraints":      extracted.get("constraints"),
                "extraction_version": 2,
                "updated_at":       datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", assignment_id)
            .execute()
        )

        updated = await db.table("assignments").select("*").eq("id", assignment_id).execute()
        return updated.data[0]

    except asyncio.TimeoutError:
        await (
            db.table("assignments")
            .update({
                "processing_state": ProcessingState.FAILED.value,
                "error_message": "Re-extraction timed out — please retry",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", assignment_id)
            .execute()
        )
        raise HTTPException(status_code=504, detail="AI re-extraction timed out — please retry")

    except Exception as exc:
        await (
            db.table("assignments")
            .update({
                "processing_state": ProcessingState.FAILED.value,
                "error_message": str(exc)[:500],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", assignment_id)
            .execute()
        )
        raise HTTPException(status_code=500, detail=f"Re-extraction failed: {exc}")
```

**Step 3: Add `extraction_version` to the Assignment Pydantic model**

In `backend/app/models/assignment.py`, add to the `Assignment` class:
```python
extraction_version: Optional[int] = None
```

**Step 4: Verify the backend imports cleanly**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/backend
python -c "from app.api.assignments import router; print('OK')"
```
Expected: `OK`

**Step 5: Commit**

```bash
git add backend/app/api/assignments.py backend/app/models/assignment.py
git commit -m "feat: stamp extraction_version=2 on new cards + re-extract endpoint"
```

---

### Task 3: Frontend api.js — add reExtractAssignment()

**Files:**
- Modify: `frontend/src/api.js`

**Step 1: Add the function after `retryAssignment` (around line 229)**

```js
export const reExtractAssignment = async (assignmentId, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/${assignmentId}/re-extract?session_id=${sessionId}`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Re-extraction failed');
    return res.json();
};
```

**Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat: add reExtractAssignment() API helper"
```

---

### Task 4: AssignmentDetail.jsx — ReactMarkdown constraints + upgrade banner

**Files:**
- Modify: `frontend/src/components/AssignmentDetail.jsx`

**Step 1: Update imports**

Add `ReactMarkdown` and `reExtractAssignment` import. New import block at top:

```jsx
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, MessageSquare, CheckSquare, Square, Sparkles, RefreshCw } from 'lucide-react';
import './AssignmentDetail.css';
import { reExtractAssignment } from '../api';
```

**Step 2: Add banner state and logic**

The upgrade banner is shown once per card. Dismissal is stored in localStorage.

Key: `fluxnote_dismissed_upgrade_{assignmentId}`

After the existing `const [checkedItems, setCheckedItems] = useState(new Set());` line, add:

```jsx
const CURRENT_VERSION = 2;
const dismissKey = `fluxnote_dismissed_upgrade_${card.id}`;
const isOldCard = (card.extraction_version || 1) < CURRENT_VERSION;
const alreadyDismissed = localStorage.getItem(dismissKey) === 'true';
const [showBanner, setShowBanner] = useState(isOldCard && !alreadyDismissed);
const [reExtracting, setReExtracting] = useState(false);
const [localCard, setLocalCard] = useState(card);
```

Note: Replace all `card.` references in JSX with `localCard.` after this change, since the card data updates after re-extraction.

**Step 3: Add handler functions**

After the `toggleCheck` function, add:

```jsx
const handleKeepCurrent = () => {
    localStorage.setItem(dismissKey, 'true');
    setShowBanner(false);
};

const handleReExtract = async () => {
    setReExtracting(true);
    try {
        const updated = await reExtractAssignment(card.id, card.session_id);
        setLocalCard(updated);
        localStorage.setItem(dismissKey, 'true');
        setShowBanner(false);
    } catch (err) {
        console.error('Re-extraction failed:', err);
    } finally {
        setReExtracting(false);
    }
};
```

**Step 4: Add banner JSX and update constraints rendering**

Replace the entire return block. The key changes:
- All `card.` → `localCard.` (keeps existing fields working)
- Add banner after `<div className="detail-modal">` open tag
- Replace `<p>{card.constraints}</p>` with `<ReactMarkdown className="constraints-md">{localCard.constraints}</ReactMarkdown>`

Full updated return:

```jsx
return (
    <div className="detail-overlay" onClick={onClose}>
        <div className="detail-modal" onClick={e => e.stopPropagation()}>
            <button className="detail-close" onClick={onClose}>
                <X size={20} />
            </button>

            {/* Upgrade Banner */}
            {showBanner && (
                <div className="upgrade-banner">
                    <Sparkles size={15} className="upgrade-icon" />
                    <span>We've improved the analysis for this assignment.</span>
                    <div className="upgrade-actions">
                        <button
                            className="upgrade-btn-refresh"
                            onClick={handleReExtract}
                            disabled={reExtracting}
                        >
                            <RefreshCw size={13} />
                            {reExtracting ? 'Updating…' : 'Refresh analysis'}
                        </button>
                        <button className="upgrade-btn-keep" onClick={handleKeepCurrent}>
                            Keep current
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="detail-header">
                <span className="state-badge ready">Ready</span>
                {localCard.due_date && <span className="due-date">Due {localCard.due_date}</span>}
                {localCard.weightage && <span className="weightage">{localCard.weightage}</span>}
                {localCard.assignment_type && <span className="atype">{localCard.assignment_type}</span>}
            </div>

            <h2 className="detail-title">{localCard.title || localCard.filename}</h2>
            {localCard.module && <p className="detail-module">{localCard.module}</p>}

            {/* Summary */}
            {localCard.summary?.length > 0 && (
                <section className="detail-section">
                    <h4>Summary</h4>
                    <ul>
                        {localCard.summary.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                </section>
            )}

            {/* Checklist */}
            {localCard.checklist?.length > 0 && (
                <section className="detail-section">
                    <h4>Checklist</h4>
                    {localCard.checklist.map((item, i) => (
                        <div key={i} className="checklist-item" onClick={() => toggleCheck(item)}>
                            {checkedItems.has(item)
                                ? <CheckSquare size={16} className="checked" />
                                : <Square size={16} />
                            }
                            <span className={checkedItems.has(item) ? 'item-done' : ''}>{item}</span>
                        </div>
                    ))}
                </section>
            )}

            {/* Constraints */}
            {localCard.constraints && (
                <section className="detail-section">
                    <h4>Requirements & Constraints</h4>
                    <ReactMarkdown className="constraints-md">{localCard.constraints}</ReactMarkdown>
                </section>
            )}

            {/* Source file(s) */}
            <section className="detail-section">
                <h4>Source {localCard.file_ids?.length > 1 ? 'Files' : 'File'}</h4>
                <p className="source-file">{localCard.filename}</p>
                {localCard.file_ids?.length > 1 && (
                    <p className="source-file-extra">
                        +{localCard.file_ids.length - 1} additional file{localCard.file_ids.length > 2 ? 's' : ''} included
                    </p>
                )}
            </section>

            {/* Ask AI */}
            <button className="ask-ai-btn" onClick={() => onAskAI(localCard)}>
                <MessageSquare size={16} />
                Ask AI about this assignment
            </button>
        </div>
    </div>
);
```

**Step 5: Verify the component renders**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/frontend
npm run build 2>&1 | tail -20
```
Expected: no errors, `dist/` built successfully.

**Step 6: Commit**

```bash
git add frontend/src/components/AssignmentDetail.jsx
git commit -m "feat: ReactMarkdown constraints + opt-in upgrade banner in AssignmentDetail"
```

---

### Task 5: AssignmentDetail.css — banner styles + constraints markdown styles

**Files:**
- Modify: `frontend/src/components/AssignmentDetail.css`

**Step 1: Append new styles at the end of the file**

```css
/* ── Upgrade Banner ──────────────────────────────────────────────────────── */

.upgrade-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 18px;
    font-size: 13px;
    color: var(--text-primary, #f1f5f9);
    flex-wrap: wrap;
}

.upgrade-icon {
    flex-shrink: 0;
    color: #60a5fa;
    margin-top: 1px;
}

.upgrade-banner span {
    flex: 1;
    min-width: 160px;
    line-height: 1.4;
}

.upgrade-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    align-items: center;
}

.upgrade-btn-refresh {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
}

.upgrade-btn-refresh:hover:not(:disabled) {
    background: #2563eb;
}

.upgrade-btn-refresh:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.upgrade-btn-keep {
    font-size: 12px;
    color: var(--text-secondary, #9ca3af);
    background: none;
    border: none;
    cursor: pointer;
    padding: 5px 6px;
    border-radius: 6px;
    transition: color 0.15s;
}

.upgrade-btn-keep:hover {
    color: var(--text-primary, #f1f5f9);
}

/* ── Constraints Markdown ─────────────────────────────────────────────────── */

.constraints-md {
    font-size: 14px;
    color: var(--text-secondary, #9ca3af);
    line-height: 1.6;
}

.constraints-md h2 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #6b7280);
    margin: 14px 0 6px;
}

.constraints-md h2:first-child {
    margin-top: 0;
}

.constraints-md ul {
    margin: 0 0 8px;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.constraints-md ul li {
    font-size: 14px;
    color: var(--text-secondary, #9ca3af);
    line-height: 1.5;
}

.constraints-md p {
    margin: 0 0 8px;
}
```

**Step 2: Verify build is clean**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/frontend
npm run build 2>&1 | tail -10
```
Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/components/AssignmentDetail.css
git commit -m "feat: upgrade banner + constraints markdown styles"
```

---

### Task 6: Deploy and smoke test

**Step 1: Deploy backend**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/backend
vercel --prod
```

**Step 2: Deploy frontend preview**

```bash
cd /Users/javensoh/Documents/Fluxnote-AI/frontend
vercel
```

**Step 3: Smoke test checklist**

Send preview URL to CEO with these 5 manual checks:

1. **New card upload** — upload an assignment PDF → card appears → open card → constraints section shows structured headings like `## What NOT To Do` rendered as markdown headers, NOT raw `##` symbols
2. **No banner on new card** — new card (extraction_version=2) should NOT show the upgrade banner
3. **Old card banner** — any card created before this deploy (version=1) opens and shows the blue upgrade banner with "Refresh analysis" + "Keep current" buttons
4. **Keep current** — click "Keep current" → banner disappears → reopen the same card → banner is gone (localStorage dismissed)
5. **Refresh analysis** — click "Refresh analysis" → button shows "Updating…" → after ~30s → card content updates → banner disappears → constraints now rendered as structured markdown

---

## What Does NOT Change

- Sidebar, KanbanBoard, KanbanColumn, AssignmentCard — zero changes
- Chat, SSE streaming, CORS — untouched
- Checklist interactivity (check/uncheck per session) — untouched
- Old cards that dismiss "Keep current" — content preserved exactly as-is forever
- `extraction_version=1` cards where student clicked "Keep current" — never show banner again

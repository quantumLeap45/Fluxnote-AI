# Pre-Launch Reliability Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Fix 6 pre-launch issues identified in E2E testing — extraction truncation, Deep Think timeout, duplicate failed cards, accidental chat delete, broken LaTeX in Routed mode, and missing storage-model explanation.

**Architecture:** All fixes are surgical — single-file changes or two-file changes. No new API endpoints, no schema migrations, no new npm packages. Each task is independent and can be verified in isolation.

**Tech Stack:** Python 3.11 + FastAPI (backend fixes), React 19 + Vite (frontend fixes). No new dependencies.

**Pre-requisites:**
- CEO must confirm Vercel backend is on **Pro plan** before Task 2 is deployed (maxDuration 300 requires Pro).
- Branch: `fix/pre-launch-reliability` (already created from `origin/main`).

---

### Task 1: Extraction max_tokens — Fix Truncated JSON Output

**What:** `assignment_extractor.py` calls OpenRouter with `"max_tokens": 1024`. Full extraction JSON (title + module + summary[] + checklist[] + constraints sections) regularly exceeds this, causing truncated output → `JSONDecodeError` → "malformed JSON" card failure.

**Files:**
- Modify: `backend/app/services/assignment_extractor.py` (line 47)
- Test: `backend/tests/test_extraction.py`

---

**Step 1: Write the failing test (regression guard)**

Add this test to `backend/tests/test_extraction.py`:

```python
@pytest.mark.anyio
async def test_extract_sends_max_tokens_2048():
    """Extraction request must use max_tokens=2048 to avoid truncation."""
    import json as _json
    good_payload = {
        "title": "T", "module": None, "due_date": "Not stated in document",
        "weightage": None, "assignment_type": None, "deliverable_type": None,
        "marks": None, "summary": ["s"], "checklist": ["c"], "constraints": None,
    }
    captured = {}
    async def fake_post(self, url, *, headers, json, **kwargs):
        captured["max_tokens"] = json.get("max_tokens")
        mock = MagicMock()
        mock.status_code = 200
        mock.json.return_value = {"choices": [{"message": {"content": _json.dumps(good_payload)}}]}
        mock.raise_for_status = MagicMock()
        return mock

    with patch("httpx.AsyncClient.post", new=fake_post):
        await _call_openrouter("Sample assignment text")

    assert captured["max_tokens"] == 2048, f"Expected 2048, got {captured['max_tokens']}"
```

**Step 2: Run it — verify it FAILS**

```bash
cd backend && python -m pytest tests/test_extraction.py::test_extract_sends_max_tokens_2048 -v
```
Expected: `FAILED — AssertionError: Expected 2048, got 1024`

**Step 3: Apply the fix**

In `backend/app/services/assignment_extractor.py`, change line 47:

```python
# Before
        "max_tokens": 1024,
# After
        "max_tokens": 2048,
```

**Step 4: Run tests — verify ALL pass**

```bash
cd backend && python -m pytest tests/test_extraction.py -v
```
Expected: all 6 tests PASSED

**Step 5: Commit**

```bash
git add backend/app/services/assignment_extractor.py backend/tests/test_extraction.py
git commit -m "fix(extraction): raise max_tokens 1024→2048 to prevent JSON truncation"
```

---

### Task 2: Vercel maxDuration — Deep Think Timeout Fix

**What:** `backend/vercel.json` caps all serverless functions at 60 seconds. DeepSeek Deep Think with reasoning takes 70–120 seconds. Vercel kills the function mid-stream, causing the response to disappear or cut off. Fix: raise to 300 seconds (requires Vercel Pro plan).

**Files:**
- Modify: `backend/vercel.json` (line 7)

> **STOP CHECK before proceeding:** Confirm with CEO that Vercel backend project is on Pro plan. If not confirmed, skip this task.

---

**Step 1: Apply the fix**

In `backend/vercel.json`, change `maxDuration`:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ],
  "functions": {
    "api/index.py": {
      "maxDuration": 300
    }
  }
}
```

**Step 2: Verify the file is valid JSON**

```bash
python3 -c "import json; json.load(open('backend/vercel.json')); print('valid JSON')"
```
Expected: `valid JSON`

**Step 3: Commit**

```bash
git add backend/vercel.json
git commit -m "fix(config): raise Vercel maxDuration 60→300 for Deep Think streaming (Pro plan)"
```

---

### Task 3: CardCreationPanel — Prevent Duplicate Failed Cards on Retry

**What:** After extraction fails, the "Create Card" button re-enables. Each click re-uploads the file and creates a new failed record in the database. Fix: after a failure, lock the panel permanently and show a redirect message pointing to Dashboard where Re-extract already exists.

**Files:**
- Modify: `frontend/src/components/CardCreationPanel.jsx`
- Test: `frontend/src/__tests__/CardCreationPanel.test.jsx` (new file)

---

**Step 1: Write the failing test**

Create `frontend/src/__tests__/CardCreationPanel.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import CardCreationPanel from '../components/CardCreationPanel';

// Mock the api module
vi.mock('../api', () => ({
    uploadToStorage: vi.fn(),
    processStorageFile: vi.fn(),
    uploadFile: vi.fn().mockRejectedValue(new Error('Extraction failed')),
    createAssignment: vi.fn(),
    createAssignmentMulti: vi.fn(),
}));

// Mock VITE env vars (no Supabase → uses uploadFile path)
vi.stubGlobal('import.meta', { env: {} });

describe('CardCreationPanel', () => {
    it('disables Create Card button permanently after first failure', async () => {
        const onCardCreated = vi.fn();
        const onCancel = vi.fn();

        render(<CardCreationPanel sessionId="test-session" onCardCreated={onCardCreated} onCancel={onCancel} />);

        // Add a file
        const input = document.querySelector('input[type="file"]');
        const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
        fireEvent.change(input, { target: { files: [file] } });

        // Click Create Card
        const btn = screen.getByText('Create Card');
        fireEvent.click(btn);

        // Wait for error state
        await waitFor(() => {
            expect(screen.getByText(/Card creation failed/i)).toBeInTheDocument();
        });

        // Button must now be disabled
        const retryBtn = screen.queryByText('Create Card');
        expect(retryBtn).toBeNull(); // button should be replaced or disabled

        // onCardCreated must NOT have been called
        expect(onCardCreated).not.toHaveBeenCalled();
    });
});
```

**Step 2: Run the test — verify it FAILS**

```bash
cd frontend && npx vitest run src/__tests__/CardCreationPanel.test.jsx
```
Expected: FAIL (button still present / enabled after error)

**Step 3: Apply the fix**

In `frontend/src/components/CardCreationPanel.jsx`:

a) Add `failed` state after the existing `error` state (around line 21):
```jsx
    const [failed, setFailed]         = useState(false);
```

b) In `handleCreate`, in the `catch` block (around line 69-71), add `setFailed(true)`:
```jsx
        } catch (err) {
            setError(err.message);
            setFailed(true);
            setCreating(false);
        }
```

c) Replace the Create Card button JSX (around line 125-133) to disable when `failed`:
```jsx
                <button
                    className="creation-create-btn"
                    onClick={handleCreate}
                    disabled={!files.length || creating || failed}
                >
                    {creating
                        ? <><Loader2 size={12} className="spin" /> Creating…</>
                        : failed
                            ? 'Failed'
                            : 'Create Card'}
                </button>
```

d) Update the error display (around line 119) to add Dashboard guidance when failed:
```jsx
            {error && (
                <p className="creation-error">
                    {error}
                    {failed && <> — Go to <strong>Dashboard</strong> to retry using Re-extract.</>}
                </p>
            )}
```

**Step 4: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/__tests__/CardCreationPanel.test.jsx
```
Expected: PASSED

**Step 5: Run all frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests PASSED (no regressions)

**Step 6: Commit**

```bash
git add frontend/src/components/CardCreationPanel.jsx frontend/src/__tests__/CardCreationPanel.test.jsx
git commit -m "fix(cards): lock Create Card after extraction failure to prevent duplicate records"
```

---

### Task 4: Sidebar — Add Delete Confirmation Dialog

**What:** The trash icon deletes a chat immediately with no warning. Add `window.confirm` so the user gets one chance to cancel.

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx` (line 95)
- Test: `frontend/src/__tests__/deleteFlow.test.js` (update existing)

---

**Step 1: Read the existing deleteFlow test to understand current coverage**

Read `frontend/src/__tests__/deleteFlow.test.js` to check what it tests before editing.

**Step 2: Write a new test case for the confirmation guard**

Add this test to `frontend/src/__tests__/deleteFlow.test.js`:

```js
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import Sidebar from '../components/Sidebar';

describe('Sidebar delete confirmation', () => {
    const chat = { id: 'abc', title: 'My Test Chat' };

    it('does NOT call onDeleteChat when user cancels the confirm dialog', () => {
        const onDeleteChat = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValueOnce(false);

        render(
            <Sidebar
                activeTab="chat"
                setActiveTab={() => {}}
                chats={[chat]}
                activeChatId="abc"
                onNewChat={() => {}}
                onSelectChat={() => {}}
                onDeleteChat={onDeleteChat}
                onRenameChat={() => {}}
            />
        );

        const deleteBtn = screen.getByTitle('Delete chat');
        fireEvent.click(deleteBtn);

        expect(window.confirm).toHaveBeenCalledWith('Delete this chat?');
        expect(onDeleteChat).not.toHaveBeenCalled();
    });

    it('calls onDeleteChat when user confirms the dialog', () => {
        const onDeleteChat = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValueOnce(true);

        render(
            <Sidebar
                activeTab="chat"
                setActiveTab={() => {}}
                chats={[chat]}
                activeChatId="abc"
                onNewChat={() => {}}
                onSelectChat={() => {}}
                onDeleteChat={onDeleteChat}
                onRenameChat={() => {}}
            />
        );

        const deleteBtn = screen.getByTitle('Delete chat');
        fireEvent.click(deleteBtn);

        expect(window.confirm).toHaveBeenCalledWith('Delete this chat?');
        expect(onDeleteChat).toHaveBeenCalledWith('abc');
    });
});
```

**Step 3: Run the new tests — verify they FAIL**

```bash
cd frontend && npx vitest run src/__tests__/deleteFlow.test.js
```
Expected: the two new `Sidebar delete confirmation` tests FAIL (no confirm dialog yet)

**Step 4: Apply the fix**

In `frontend/src/components/Sidebar.jsx`, line 95, change the `onClick` handler:

```jsx
// Before
onClick={e => { e.stopPropagation(); onDeleteChat(chat.id); }}

// After
onClick={e => { e.stopPropagation(); if (window.confirm('Delete this chat?')) onDeleteChat(chat.id); }}
```

**Step 5: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/__tests__/deleteFlow.test.js
```
Expected: all tests PASSED

**Step 6: Run all frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests PASSED

**Step 7: Commit**

```bash
git add frontend/src/components/Sidebar.jsx frontend/src/__tests__/deleteFlow.test.js
git commit -m "fix(sidebar): require confirmation before deleting a chat"
```

---

### Task 5: LaTeX Rendering — Fix Routed Mode Output

**What:** The Routed mode synthesis prompt does not instruct the AI to use `$...$` notation. DeepSeek sometimes produces `\[...\]` or `\(...\)` which `remark-math` does not recognise, so maths appears as raw text. Fix in two layers: (a) add LaTeX instruction to synthesis prompt; (b) add a normalizer in ChatView to pre-process any stray notation before rendering.

**Files:**
- Modify: `backend/app/services/routed_llm.py` (the `_SYNTHESIS_SYSTEM` constant, ~line 296)
- Modify: `frontend/src/components/ChatView.jsx` (add `normalizeLatex` function + apply it in the renderer)

---

**Step 1: Fix the synthesis prompt (backend)**

In `backend/app/services/routed_llm.py`, find `_SYNTHESIS_SYSTEM` (~line 296) and append the LaTeX rule:

```python
# Before
_SYNTHESIS_SYSTEM = (
    "You are synthesizing multiple AI perspectives into one superior answer for a {task_type} task.\n"
    "Each perspective brings different strengths.\n\n"
    "Rules:\n"
    "- Give the final best unified answer directly — do NOT mention the individual models\n"
    "- Do NOT say 'based on the perspectives above' or similar meta-commentary\n"
    "- Preserve the best insights, examples, and structure from all inputs\n"
    "- Be concise and clear"
)

# After
_SYNTHESIS_SYSTEM = (
    "You are synthesizing multiple AI perspectives into one superior answer for a {task_type} task.\n"
    "Each perspective brings different strengths.\n\n"
    "Rules:\n"
    "- Give the final best unified answer directly — do NOT mention the individual models\n"
    "- Do NOT say 'based on the perspectives above' or similar meta-commentary\n"
    "- Preserve the best insights, examples, and structure from all inputs\n"
    "- Be concise and clear\n"
    "- For ALL math/equations: use ONLY inline $...$ or block $$...$$ LaTeX — never \\[...\\] or \\(...\\)"
)
```

**Step 2: Add the frontend normalizer (frontend safety net)**

In `frontend/src/components/ChatView.jsx`, add this function **before** the `ChatView` function definition (around line 40, before the `function ChatView` line):

```jsx
/** Normalize AI LaTeX output to the $...$ / $$...$$ form that remark-math expects. */
function normalizeLatex(text) {
    if (!text) return text;
    // \[...\]  →  $$...$$
    let out = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`);
    // \(...\)  →  $...$
    out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`);
    return out;
}
```

Then find where AI message content is rendered (the `ReactMarkdown` call for AI messages). It will look like:

```jsx
<ReactMarkdown remarkPlugins={...} rehypePlugins={...}>
    {message.content}
</ReactMarkdown>
```

Change `{message.content}` to `{normalizeLatex(message.content)}`.

> **IMPORTANT:** Only apply `normalizeLatex` to AI messages (`message.role === 'ai'`). User messages should render verbatim. The existing code already conditionally renders the markdown block for AI messages only, so applying it inside that block is correct by default.

**Step 3: Run frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests PASSED (normalizer function has no side effects on existing tests)

**Step 4: Run backend tests**

```bash
cd backend && python -m pytest tests/ -v
```
Expected: all tests PASSED

**Step 5: Commit**

```bash
git add backend/app/services/routed_llm.py frontend/src/components/ChatView.jsx
git commit -m "fix(latex): add $...\$ rule to synthesis prompt + frontend normalizer for \\[...\\] notation"
```

---

### Task 6: DashboardView — Add Storage Awareness Banner

**What:** Users don't know their dashboard data lives in their browser (no login, no sync). Add a dismissible informational banner at the top of the Dashboard. Dismissal is persisted in `localStorage` so it shows only once.

**Files:**
- Modify: `frontend/src/components/DashboardView.jsx`
- Test: `frontend/src/__tests__/DashboardView.test.jsx` (new file)

---

**Step 1: Write the failing test**

Create `frontend/src/__tests__/DashboardView.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import DashboardView from '../components/DashboardView';

// Stub child components to keep test focused
vi.mock('../components/KanbanBoard', () => ({ default: () => <div data-testid="kanban" /> }));
vi.mock('../components/AssignmentDetail', () => ({ default: () => null }));

const defaultProps = {
    workspaceId: 'ws-1',
    assignments: [],
    fetchError: false,
    onRetryFetch: vi.fn(),
    onAskAI: vi.fn(),
    onAssignmentUpdate: vi.fn(),
    onDeleteCard: vi.fn(),
    onCardCreated: vi.fn(),
};

describe('DashboardView storage banner', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('shows the storage banner when not dismissed', () => {
        render(<DashboardView {...defaultProps} />);
        expect(screen.getByText(/saved in this browser/i)).toBeInTheDocument();
    });

    it('hides the banner after clicking dismiss', () => {
        render(<DashboardView {...defaultProps} />);
        const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
        fireEvent.click(dismissBtn);
        expect(screen.queryByText(/saved in this browser/i)).toBeNull();
    });

    it('does not show banner when localStorage flag is set', () => {
        localStorage.setItem('fluxnote_storage_banner_dismissed', '1');
        render(<DashboardView {...defaultProps} />);
        expect(screen.queryByText(/saved in this browser/i)).toBeNull();
    });
});
```

**Step 2: Run test — verify it FAILS**

```bash
cd frontend && npx vitest run src/__tests__/DashboardView.test.jsx
```
Expected: 3 tests FAIL (banner not yet implemented)

**Step 3: Apply the fix**

In `frontend/src/components/DashboardView.jsx`, add the banner state and render logic:

```jsx
import React, { useState } from 'react';
import KanbanBoard from './KanbanBoard';
import AssignmentDetail from './AssignmentDetail';
import './DashboardView.css';

const BANNER_KEY = 'fluxnote_storage_banner_dismissed';

function DashboardView({ workspaceId, assignments, fetchError, onRetryFetch, onAskAI, onAssignmentUpdate, onDeleteCard, onCardCreated }) {
    const [selectedCard, setSelectedCard] = useState(null);
    const [bannerDismissed, setBannerDismissed] = useState(
        () => !!localStorage.getItem(BANNER_KEY)
    );

    const dismissBanner = () => {
        localStorage.setItem(BANNER_KEY, '1');
        setBannerDismissed(true);
    };

    const handleDeleteCard = async (cardId) => {
        await onDeleteCard(cardId);
        if (selectedCard?.id === cardId) setSelectedCard(null);
    };

    return (
        <div className="dashboard-container animate-fade-in">
            <header className="dashboard-header">
                <div>
                    <h2 className="dashboard-title">Assignment Dashboard</h2>
                    <p className="dashboard-subtitle">Drag cards across columns to track your progress.</p>
                </div>
            </header>

            {!bannerDismissed && (
                <div style={{ padding: '10px 16px', marginBottom: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <span>Your dashboard is saved in this browser — not synced across devices. Opening Fluxnote on a different browser or device will show an empty dashboard.</span>
                    <button
                        aria-label="Dismiss"
                        onClick={dismissBanner}
                        style={{ marginLeft: 'auto', padding: '3px 10px', background: 'transparent', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}
                    >
                        Got it
                    </button>
                </div>
            )}

            {fetchError && (
                <div style={{ padding: '12px 16px', marginBottom: '12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>Failed to load assignments.</span>
                    <button onClick={onRetryFetch} style={{ marginLeft: 'auto', padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Retry</button>
                </div>
            )}

            <KanbanBoard
                assignments={assignments}
                sessionId={workspaceId}
                onCardClick={setSelectedCard}
                onAssignmentUpdate={onAssignmentUpdate}
                onDeleteCard={handleDeleteCard}
                onCardCreated={onCardCreated}
            />

            {selectedCard && (
                <AssignmentDetail
                    assignment={selectedCard}
                    sessionId={workspaceId}
                    onClose={() => setSelectedCard(null)}
                    onAskAI={(card) => {
                        setSelectedCard(null);
                        onAskAI(card);
                    }}
                    onAssignmentUpdate={onAssignmentUpdate}
                />
            )}
        </div>
    );
}

export default DashboardView;
```

**Step 4: Run tests — verify pass**

```bash
cd frontend && npx vitest run src/__tests__/DashboardView.test.jsx
```
Expected: 3 tests PASSED

**Step 5: Run all frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests PASSED

**Step 6: Commit**

```bash
git add frontend/src/components/DashboardView.jsx frontend/src/__tests__/DashboardView.test.jsx
git commit -m "feat(dashboard): add dismissible storage-model awareness banner"
```

---

### Final Task: Deploy and Smoke Test

**Step 1: Push the branch**

```bash
git push -u origin fix/pre-launch-reliability
```

**Step 2: Deploy backend to Vercel**

Use the `vercel:deploy` skill from the `backend/` directory. Watch for any build errors.

**Step 3: Deploy frontend to Vercel**

Use the `vercel:deploy` skill from the `frontend/` directory.

**Step 4: Manual smoke test checklist**

Open https://fluxnote-ai.vercel.app and verify:

- [ ] **Extraction**: Upload a PDF assignment → card extracts successfully → no "malformed JSON" error
- [ ] **Deep Think**: Select Deep Think model → ask a maths question → response streams fully without cutting off (allow 60–90 seconds)
- [ ] **Card retry**: Upload a file for card creation → if it fails, verify "Create Card" button is disabled and message says to go to Dashboard
- [ ] **Chat delete**: Hover over a chat in sidebar → click trash icon → confirm dialog appears → click Cancel → chat NOT deleted → click trash again → click OK → chat IS deleted
- [ ] **LaTeX (Routed)**: Switch to Routed mode → ask `"What is the quadratic formula?"` → verify the equation renders as formatted maths, not raw `\[...\]` text
- [ ] **Storage banner**: Open Dashboard tab → blue banner visible with "saved in this browser" text → click "Got it" → banner disappears → reload page → banner does NOT reappear

**Step 5: Create PR**

```bash
gh pr create \
  --title "fix: pre-launch reliability — 6 user-facing fixes" \
  --body "Fixes extraction truncation, Deep Think timeout, duplicate failed cards, accidental chat delete, LaTeX rendering in Routed mode, and adds storage-model awareness banner. See docs/plans/2026-03-12-pre-launch-reliability-design.md for full context." \
  --base main
```

---

## What Does NOT Change

- Chat API routes (`/api/v1/chat/message`, `/api/v1/chat/history`)
- File upload endpoints and Supabase Storage path
- Assignment CRUD endpoints
- Database schema (no migrations)
- KanbanBoard, AssignmentCard, AssignmentDetail components
- CSS files (no styling changes except the inline banner styles in DashboardView)
- The `onCardCreated` wire-up in ChatView (already fixed in a prior sprint)
- Fast, Balanced, and non-Routed Deep Think modes (only synthesis prompt touched)
- Any auth or session management logic

# Fluxnote — Plan Document Standards

This file defines the required format for all documents in `docs/plans/`. Claude must follow this whenever creating new plan documents.

---

## Two Document Types

Every feature produces two documents:

| Type | Filename pattern | Purpose |
|------|-----------------|---------|
| **Design doc** | `YYYY-MM-DD-{feature}-design.md` | What to build and why. CEO-readable. No code. |
| **Implementation plan** | `YYYY-MM-DD-{feature}-impl.md` | How to build it. Step-by-step tasks with exact code and commands. |

---

## Design Doc Format

```markdown
# Fluxnote — {Feature Name}

**Date:** YYYY-MM-DD
**Status:** Draft / Approved by CEO
**Branch:** {branch name}

---

## What This Solves

[2-4 sentences: the user problem and why it matters]

---

## What Gets Built

### Change 1: {Name}
[What it does, how it works, any CEO-visible SQL or config actions required]

### Change 2: {Name}
...

---

## What Does NOT Change

[Bullet list of untouched areas — reassures CEO that existing features are safe]

---

## CEO Actions Required

[Only include if CEO must do something before deployment — SQL, env vars, etc.]

---

## Decision Log

| Decision | Options considered | Choice | Reason |
|----------|--------------------|--------|--------|
```

---

## Implementation Plan Format

```markdown
# {Feature Name} — Implementation Plan

**Goal:** [One sentence: what this ships]

**Architecture:** [2-3 sentences: approach and key decisions]

**Tech Stack:** [Key technologies, new packages if any]

**Pre-requisites:** [SQL migrations, env vars, or CEO actions needed BEFORE starting]

---

### Task N: {Component name}

**Files:**
- Create: `exact/path/to/file.ext`
- Modify: `exact/path/to/file.ext`

**Step 1: [Action]**

[Code block if needed]

**Step 2: Verify**

```bash
[exact command]
```
Expected: [what success looks like]

**Step 3: Commit**

```bash
git add {files}
git commit -m "{type}: {description}"
```

---

### Final Task: Deploy and smoke test

[Deployment commands + manual test checklist for CEO]

---

## What Does NOT Change

[Bullet list confirming untouched areas]
```

---

## Execution Guidance (for Claude)

When implementing a plan, use the best tool for each step — not just one skill:

| Need | Tool to use |
|------|-------------|
| Run SQL migrations | `mcp__plugin_supabase_supabase__execute_sql` (load via ToolSearch first) |
| Check Supabase schema | `mcp__plugin_supabase_supabase__list_tables` |
| Browse a deployed URL | `mcp__plugin_playwright_playwright__browser_navigate` |
| Take screenshot of UI | `mcp__plugin_playwright_playwright__browser_take_screenshot` |
| Parallel independent tasks | `superpowers:dispatching-parallel-agents` |
| Executing a written plan | `superpowers:executing-plans` |
| Debugging a failure | `superpowers:systematic-debugging` |
| Vercel deployment | `vercel:deploy` skill |
| View Vercel logs | `vercel:logs` skill |
| Commit and push | `commit-commands:commit` skill |

**Do not default to superpowers skills when a more specific tool exists.** The Supabase MCP, Playwright MCP, and other tools are available and often more direct.

---

## Naming Conventions

- Use lowercase kebab-case: `2026-03-06-feature-name-impl.md`
- Always prefix with the date: `YYYY-MM-DD`
- Suffix with `-design` or `-impl` to distinguish type
- Be specific: `extraction-versioning-impl` not `backend-update`

---

## Commit Message for Plan Docs

```bash
git commit -m "docs: add {feature} design + implementation plan"
```

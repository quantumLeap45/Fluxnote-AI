-- ─────────────────────────────────────────────────────────────────────────────
-- Fluxnote AI — Supabase Database Schema
-- MVP v0.1
--
-- Run this entire file in the Supabase SQL Editor to set up your database.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Chat Messages ─────────────────────────────────────────────────────────────
-- Stores all messages (user and AI) in a chat session.
create table if not exists chat_messages (
    id          uuid        primary key,
    session_id  text        not null,
    role        text        not null check (role in ('user', 'assistant')),
    content     text        not null,
    model       text,                                   -- null for user messages
    created_at  timestamptz not null default now()
);

create index if not exists idx_chat_messages_session
    on chat_messages(session_id, created_at asc);


-- ── Files ─────────────────────────────────────────────────────────────────────
-- Stores uploaded file metadata and extracted text content.
create table if not exists files (
    id          uuid        primary key,
    session_id  text        not null,
    name        text        not null,
    type        text        not null,                   -- pdf, docx, txt, csv, pptx
    size        integer     not null,                   -- bytes
    content     text,                                   -- extracted plain text (null if parse failed)
    created_at  timestamptz not null default now()
);

create index if not exists idx_files_session
    on files(session_id, created_at asc);


-- ── Notes ─────────────────────────────────────────────────────────────────────
create table if not exists notes (
    id          uuid        primary key,
    session_id  text        not null,
    text        text        not null,
    pinned      boolean     not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists idx_notes_session
    on notes(session_id, created_at desc);


-- ── Tasks ─────────────────────────────────────────────────────────────────────
create table if not exists tasks (
    id          uuid        primary key,
    session_id  text        not null,
    text        text        not null,
    completed   boolean     not null default false,
    priority    text        not null default 'medium'
                    check (priority in ('low', 'medium', 'high')),
    due_date    date,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists idx_tasks_session
    on tasks(session_id, created_at desc);


-- ── Calendar Events ───────────────────────────────────────────────────────────
create table if not exists events (
    id          uuid        primary key,
    session_id  text        not null,
    title       text        not null,
    time        text        not null,                   -- e.g. "10:00 AM - 10:30 AM"
    date        date        not null,
    type        text        not null default 'other'
                    check (type in ('meeting', 'focus', 'task', 'other')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists idx_events_session
    on events(session_id, date asc);


-- ── Assignments ───────────────────────────────────────────────────────────────
create table if not exists assignments (
    id                uuid        primary key,
    session_id        text        not null,
    file_id           uuid        references files(id) on delete set null,
    filename          text        not null,
    processing_state  text        not null default 'queued'
                          check (processing_state in ('queued','processing','ready','reviewed','archived','failed')),
    error_message     text,
    -- AI-extracted fields (null until processing completes)
    title             text,
    module            text,
    due_date          date,
    weightage         text,
    assignment_type   text        check (assignment_type in ('Group','Individual') or assignment_type is null),
    deliverable_type  text        check (deliverable_type in ('report','slides','code','reflection') or deliverable_type is null),
    summary           jsonb,      -- string[]
    checklist         jsonb,      -- string[]
    constraints       text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists idx_assignments_session
    on assignments(session_id, created_at desc);

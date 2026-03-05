from pydantic import BaseModel
from typing import Optional
from enum import Enum
from datetime import datetime, date


# ── Enums ──────────────────────────────────────────────────────────────────

class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class EventType(str, Enum):
    MEETING = "meeting"
    FOCUS = "focus"
    TASK = "task"
    OTHER = "other"


# ── Notes ──────────────────────────────────────────────────────────────────

class NoteCreate(BaseModel):
    text: str
    pinned: bool = False


class NoteUpdate(BaseModel):
    text: Optional[str] = None
    pinned: Optional[bool] = None


class Note(BaseModel):
    id: str
    session_id: str
    text: str
    pinned: bool
    created_at: datetime
    updated_at: datetime


# ── Tasks ──────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    text: str
    priority: Priority = Priority.MEDIUM
    due_date: Optional[date] = None


class TaskUpdate(BaseModel):
    text: Optional[str] = None
    completed: Optional[bool] = None
    priority: Optional[Priority] = None
    due_date: Optional[date] = None


class Task(BaseModel):
    id: str
    session_id: str
    text: str
    completed: bool
    priority: Priority
    due_date: Optional[date]
    created_at: datetime
    updated_at: datetime


# ── Calendar Events ────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    title: str
    time: str           # e.g. "10:00 AM - 10:30 AM"
    date: date
    type: EventType = EventType.OTHER


class EventUpdate(BaseModel):
    title: Optional[str] = None
    time: Optional[str] = None
    date: Optional[date] = None
    type: Optional[EventType] = None


class CalendarEvent(BaseModel):
    id: str
    session_id: str
    title: str
    time: str
    date: date
    type: EventType
    created_at: datetime
    updated_at: datetime

from fastapi import APIRouter, HTTPException, Query
from app.models.workspace import (
    NoteCreate, NoteUpdate,
    TaskCreate, TaskUpdate,
    EventCreate, EventUpdate,
)
from app.services.supabase_client import get_supabase
import uuid
from datetime import datetime, timezone

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Notes ──────────────────────────────────────────────────────────────────────

@router.get("/notes")
def get_notes(session_id: str = Query(...)):
    supabase = get_supabase()
    result = (
        supabase.table("notes")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"notes": result.data}


@router.post("/notes")
def create_note(body: NoteCreate, session_id: str = Query(...)):
    supabase = get_supabase()
    now = _now_iso()
    record = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "text": body.text,
        "pinned": body.pinned,
        "created_at": now,
        "updated_at": now,
    }
    result = supabase.table("notes").insert(record).execute()
    return result.data[0]


@router.put("/notes/{note_id}")
def update_note(note_id: str, body: NoteUpdate, session_id: str = Query(...)):
    supabase = get_supabase()
    update_data = body.model_dump(exclude_none=True)
    update_data["updated_at"] = _now_iso()
    result = (
        supabase.table("notes")
        .update(update_data)
        .eq("id", note_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return result.data[0]


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, session_id: str = Query(...)):
    supabase = get_supabase()
    supabase.table("notes").delete().eq("id", note_id).eq("session_id", session_id).execute()
    return {"success": True}


# ── Tasks ──────────────────────────────────────────────────────────────────────

@router.get("/tasks")
def get_tasks(session_id: str = Query(...)):
    supabase = get_supabase()
    result = (
        supabase.table("tasks")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"tasks": result.data}


@router.post("/tasks")
def create_task(body: TaskCreate, session_id: str = Query(...)):
    supabase = get_supabase()
    now = _now_iso()
    record = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "text": body.text,
        "completed": False,
        "priority": body.priority.value,
        "due_date": body.due_date.isoformat() if body.due_date else None,
        "created_at": now,
        "updated_at": now,
    }
    result = supabase.table("tasks").insert(record).execute()
    return result.data[0]


@router.put("/tasks/{task_id}")
def update_task(task_id: str, body: TaskUpdate, session_id: str = Query(...)):
    supabase = get_supabase()
    update_data = body.model_dump(exclude_none=True)
    if "priority" in update_data:
        update_data["priority"] = update_data["priority"].value
    if "due_date" in update_data and update_data["due_date"] is not None:
        update_data["due_date"] = update_data["due_date"].isoformat()
    update_data["updated_at"] = _now_iso()
    result = (
        supabase.table("tasks")
        .update(update_data)
        .eq("id", task_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return result.data[0]


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, session_id: str = Query(...)):
    supabase = get_supabase()
    supabase.table("tasks").delete().eq("id", task_id).eq("session_id", session_id).execute()
    return {"success": True}


# ── Calendar Events ────────────────────────────────────────────────────────────

@router.get("/events")
def get_events(session_id: str = Query(...)):
    supabase = get_supabase()
    result = (
        supabase.table("events")
        .select("*")
        .eq("session_id", session_id)
        .order("date", desc=False)
        .execute()
    )
    return {"events": result.data}


@router.post("/events")
def create_event(body: EventCreate, session_id: str = Query(...)):
    supabase = get_supabase()
    now = _now_iso()
    record = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "title": body.title,
        "time": body.time,
        "date": body.date.isoformat(),
        "type": body.type.value,
        "created_at": now,
        "updated_at": now,
    }
    result = supabase.table("events").insert(record).execute()
    return result.data[0]


@router.put("/events/{event_id}")
def update_event(event_id: str, body: EventUpdate, session_id: str = Query(...)):
    supabase = get_supabase()
    update_data = body.model_dump(exclude_none=True)
    if "type" in update_data:
        update_data["type"] = update_data["type"].value
    if "date" in update_data and update_data["date"] is not None:
        update_data["date"] = update_data["date"].isoformat()
    update_data["updated_at"] = _now_iso()
    result = (
        supabase.table("events")
        .update(update_data)
        .eq("id", event_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Event not found")
    return result.data[0]


@router.delete("/events/{event_id}")
def delete_event(event_id: str, session_id: str = Query(...)):
    supabase = get_supabase()
    supabase.table("events").delete().eq("id", event_id).eq("session_id", session_id).execute()
    return {"success": True}

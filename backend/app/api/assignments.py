import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.models.assignment import AssignmentCreate, AssignmentUpdate, ProcessingState
from app.services.assignment_extractor import extract_assignment_data
import app.services.db as db

router = APIRouter()


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/", status_code=200)
async def create_assignment(body: AssignmentCreate):
    """Create an assignment card and process it synchronously via AI extraction."""
    file_resp = await (
        db.table("files")
        .select("name, content")
        .eq("id", body.file_id)
        .eq("session_id", body.session_id)
        .execute()
    )
    if not file_resp.data:
        raise HTTPException(status_code=404, detail="File not found in this session")

    file_record = file_resp.data[0]
    now = datetime.now(timezone.utc).isoformat()
    assignment_id = str(uuid.uuid4())

    await (
        db.table("assignments")
        .insert({
            "id":               assignment_id,
            "session_id":       body.session_id,
            "file_id":          body.file_id,
            "filename":         file_record["name"],
            "processing_state": ProcessingState.PROCESSING.value,
            "created_at":       now,
            "updated_at":       now,
        })
        .execute()
    )

    try:
        extracted = await extract_assignment_data(file_record.get("content") or "")

        await (
            db.table("assignments")
            .update({
                "processing_state": ProcessingState.READY.value,
                "title":            extracted.get("title"),
                "module":           extracted.get("module"),
                "due_date":         extracted.get("due_date"),
                "weightage":        extracted.get("weightage"),
                "assignment_type":  extracted.get("assignment_type"),
                "deliverable_type": extracted.get("deliverable_type"),
                "summary":          extracted.get("summary", []),
                "checklist":        extracted.get("checklist", []),
                "constraints":      extracted.get("constraints"),
                "updated_at":       datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", assignment_id)
            .execute()
        )

        row = await db.table("assignments").select("*").eq("id", assignment_id).execute()
        return row.data[0]

    except Exception as exc:
        await (
            db.table("assignments")
            .update({
                "processing_state": ProcessingState.FAILED.value,
                "error_message":    str(exc)[:500],
                "updated_at":       datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", assignment_id)
            .execute()
        )
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {exc}")


@router.get("/")
async def list_assignments(session_id: str = Query(...)):
    resp = await (
        db.table("assignments")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"assignments": resp.data or []}


@router.get("/{assignment_id}")
async def get_assignment(assignment_id: str, session_id: str = Query(...)):
    resp = await (
        db.table("assignments")
        .select("*")
        .eq("id", assignment_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return resp.data[0]


@router.patch("/{assignment_id}")
async def update_assignment(assignment_id: str, body: AssignmentUpdate, session_id: str = Query(...)):
    update_data = body.model_dump(exclude_none=True)
    if "due_date" in update_data and update_data["due_date"]:
        update_data["due_date"] = update_data["due_date"].isoformat()
    if "processing_state" in update_data:
        update_data["processing_state"] = update_data["processing_state"].value
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    resp = await (
        db.table("assignments")
        .update(update_data)
        .eq("id", assignment_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return resp.data[0]


@router.delete("/{assignment_id}")
async def delete_assignment(assignment_id: str, session_id: str = Query(...)):
    await (
        db.table("assignments")
        .delete()
        .eq("id", assignment_id)
        .eq("session_id", session_id)
        .execute()
    )
    return {"success": True}

import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.config import settings
from app.models.file import FileUploadResponse
from app.services.file_parser import ALLOWED_EXTENSIONS, parse_file
from app.services.image_extractor import extract_image_text
from app.services import storage
import app.services.db as db


class StorageProcessRequest(BaseModel):
    storage_path: str
    filename: str
    session_id: str

router = APIRouter()


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    session_id: str = Query(...),
    file: UploadFile = File(...),
):
    # Check session file limit
    count_resp = await (
        db.table("files")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .execute()
    )
    current_count = count_resp.count if count_resp.count is not None else len(count_resp.data)
    if current_count >= settings.MAX_FILES_PER_SESSION:
        raise HTTPException(
            status_code=400,
            detail=f"Session has reached the maximum of {settings.MAX_FILES_PER_SESSION} files.",
        )

    # Read and validate size
    content = await file.read()
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the maximum allowed size of {settings.MAX_FILE_SIZE_MB} MB.",
        )

    # Validate extension
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{ext}' is not supported. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    parsed_text = parse_file(content, file.content_type or "", filename)

    image_text = await extract_image_text(content, filename)
    if image_text:
        parsed_text = (parsed_text or "") + "\n\n[Image content]\n" + image_text

    file_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    await (
        db.table("files")
        .insert({
            "id":         file_id,
            "session_id": session_id,
            "name":       filename,
            "type":       ext,
            "size":       len(content),
            "content":    parsed_text,
            "created_at": created_at,
        })
        .execute()
    )

    return FileUploadResponse(
        id=file_id,
        name=filename,
        type=ext,
        size=len(content),
        size_mb=round(len(content) / (1024 * 1024), 2),
        parsed=parsed_text is not None,
        created_at=created_at,
    )


@router.post("/process", response_model=FileUploadResponse)
async def process_storage_file(body: StorageProcessRequest):
    """Download a file from Supabase Storage, parse it, and save to the files table."""
    content = await storage.download_from_storage(body.storage_path)

    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the maximum allowed size of {settings.MAX_FILE_SIZE_MB} MB.",
        )

    filename = body.filename
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{ext}' is not supported. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    _CONTENT_TYPES = {
        "pdf":  "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt":  "text/plain",
        "csv":  "text/csv",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
    content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")

    parsed_text = parse_file(content, content_type, filename)
    image_text = await extract_image_text(content, filename)
    if image_text:
        parsed_text = (parsed_text or "") + "\n\n[Image content]\n" + image_text

    file_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    await (
        db.table("files")
        .insert({
            "id":         file_id,
            "session_id": body.session_id,
            "name":       filename,
            "type":       ext,
            "size":       len(content),
            "content":    parsed_text,
            "created_at": created_at,
        })
        .execute()
    )

    return FileUploadResponse(
        id=file_id,
        name=filename,
        type=ext,
        size=len(content),
        size_mb=round(len(content) / (1024 * 1024), 2),
        parsed=parsed_text is not None,
        created_at=created_at,
    )


@router.get("")
async def list_files(session_id: str = Query(...)):
    resp = await (
        db.table("files")
        .select("id, name, type, size, created_at")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )
    return {"files": resp.data}


@router.delete("/{file_id}")
async def delete_file(file_id: str, session_id: str = Query(...)):
    # Cascade: remove this file_id from any assignments that reference it before deleting
    assignments_resp = await (
        db.table("assignments")
        .select("id, file_id, file_ids")
        .eq("session_id", session_id)
        .execute()
    )
    for a in (assignments_resp.data or []):
        updates: dict = {}
        if a.get("file_id") == file_id:
            updates["file_id"] = None
        existing_ids = a.get("file_ids") or []
        if isinstance(existing_ids, str):
            try:
                existing_ids = json.loads(existing_ids)
            except Exception:
                existing_ids = []
        if file_id in existing_ids:
            updates["file_ids"] = [fid for fid in existing_ids if fid != file_id]
        if updates:
            await (
                db.table("assignments")
                .update(updates)
                .eq("id", a["id"])
                .eq("session_id", session_id)
                .execute()
            )

    await db.table("files").delete().eq("id", file_id).eq("session_id", session_id).execute()
    return {"success": True}

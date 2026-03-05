import io
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.config import settings
from app.models.file import FileUploadResponse
from app.services.file_parser import ALLOWED_EXTENSIONS, parse_file
from app.services.supabase_client import get_supabase

router = APIRouter()


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    session_id: str = Query(...),
    file: UploadFile = File(...),
):
    supabase = get_supabase()

    # (a) Check how many files already exist for this session
    count_resp = (
        supabase.table("files")
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

    # (b) Read content and validate size
    content = await file.read()
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the maximum allowed size of {settings.MAX_FILE_SIZE_MB} MB.",
        )

    # (c) Validate file extension
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{ext}' is not supported. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    # Parse file content into plain text
    parsed_text = parse_file(content, file.content_type or "", filename)

    # Build record and insert into Supabase
    file_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    record = {
        "id": file_id,
        "session_id": session_id,
        "name": filename,
        "type": ext,
        "size": len(content),
        "content": parsed_text,
        "created_at": created_at,
    }
    supabase.table("files").insert(record).execute()

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
    supabase = get_supabase()

    resp = (
        supabase.table("files")
        .select("id, name, type, size, created_at")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )

    return {"files": resp.data}


@router.delete("/{file_id}")
async def delete_file(file_id: str, session_id: str = Query(...)):
    supabase = get_supabase()

    supabase.table("files").delete().eq("id", file_id).eq("session_id", session_id).execute()

    return {"success": True}

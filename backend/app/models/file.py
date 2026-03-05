from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FileMetadata(BaseModel):
    id: str
    session_id: str
    name: str
    type: str
    size: int           # bytes
    parsed: bool        # whether text extraction succeeded
    created_at: datetime


class FileUploadResponse(BaseModel):
    id: str
    name: str
    type: str
    size: int
    size_mb: float
    parsed: bool
    created_at: str

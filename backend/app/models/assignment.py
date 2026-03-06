from pydantic import BaseModel
from typing import Optional, List
from enum import Enum
from datetime import datetime, date


class ProcessingState(str, Enum):
    QUEUED     = "queued"
    PROCESSING = "processing"
    READY      = "ready"
    REVIEWED   = "reviewed"
    ARCHIVED   = "archived"
    FAILED     = "failed"


class AssignmentCreate(BaseModel):
    file_id:   Optional[str]       = None  # legacy single-file (kept for backward compat)
    file_ids:  Optional[List[str]] = None  # multi-file (v0.5+)
    session_id: str


class AssignmentUpdate(BaseModel):
    title:            Optional[str]             = None
    module:           Optional[str]             = None
    due_date:         Optional[date]            = None
    weightage:        Optional[str]             = None
    assignment_type:  Optional[str]             = None
    deliverable_type: Optional[str]             = None
    marks:            Optional[str]             = None
    processing_state: Optional[ProcessingState] = None
    kanban_column:    Optional[str]             = None


class Assignment(BaseModel):
    id:               str
    session_id:       str
    file_id:          Optional[str]
    file_ids:         Optional[List[str]] = None
    filename:         str
    processing_state: ProcessingState
    kanban_column:    Optional[str]       = None
    error_message:    Optional[str]       = None
    title:            Optional[str]       = None
    module:           Optional[str]       = None
    due_date:         Optional[date]      = None
    weightage:        Optional[str]       = None
    assignment_type:  Optional[str]       = None
    deliverable_type: Optional[str]       = None
    marks:            Optional[str]       = None
    summary:          Optional[List[str]] = None
    checklist:        Optional[List[str]] = None
    constraints:       Optional[str]       = None
    extraction_version: Optional[int]      = None
    created_at:        datetime
    updated_at:        datetime

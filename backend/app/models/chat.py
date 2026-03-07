from pydantic import BaseModel
from typing import Optional, List
from enum import Enum
from datetime import datetime


class ModelTier(str, Enum):
    FAST       = "Fast"
    BALANCED   = "Balanced"
    DEEP_THINK = "Deep Think"
    ROUTED     = "Routed"


class ChatRequest(BaseModel):
    message: str
    model: ModelTier = ModelTier.FAST
    file_ids: List[str] = []
    session_id: str
    assignments_manifest: Optional[str] = None


class Message(BaseModel):
    id: str
    session_id: str
    role: str           # "user" or "assistant"
    content: str
    model: Optional[str] = None
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    messages: List[Message]

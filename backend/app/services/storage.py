"""Supabase Storage download helper.

Downloads files from the public 'uploads' bucket so the backend can parse
them without ever receiving the raw bytes through Vercel's request body.
"""
import re
import httpx
from fastapi import HTTPException
from app.config import settings

# Allow only path segments that are safe: UUIDs, timestamps, safe filenames.
# Pattern: one or more path parts separated by '/', each containing only
# alphanumerics, dashes, underscores, and dots — no traversal (..) or authority parts.
_SAFE_PATH_RE = re.compile(r'^[\w.\-]+(\/[\w.\-]+)*$')


async def download_from_storage(storage_path: str) -> bytes:
    """Download a file from the public 'uploads' bucket and return its bytes."""
    if not _SAFE_PATH_RE.match(storage_path):
        raise HTTPException(status_code=400, detail="Invalid storage path.")
    url = f"{settings.SUPABASE_URL}/storage/v1/object/public/uploads/{storage_path}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content

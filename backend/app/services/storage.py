"""Supabase Storage download helper.

Downloads files from the public 'uploads' bucket so the backend can parse
them without ever receiving the raw bytes through Vercel's request body.
"""
import httpx
from app.config import settings


async def download_from_storage(storage_path: str) -> bytes:
    """Download a file from the public 'uploads' bucket and return its bytes."""
    url = f"{settings.SUPABASE_URL}/storage/v1/object/public/uploads/{storage_path}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content

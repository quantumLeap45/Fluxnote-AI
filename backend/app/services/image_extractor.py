import asyncio
import base64
import io
import zipfile
from typing import List

import httpx

from app.config import settings

_VISION_PROMPT = (
    "You are extracting text from an academic assignment document image. "
    "Transcribe ALL visible text exactly as written. "
    "Include table content, rubric criteria, instructions, diagrams with labels. "
    "Return plain text only — no commentary, no formatting, no markdown."
)

_MAX_IMAGES = 20
_MIN_IMAGE_BYTES = 5_000  # skip decorative images (logos, icons) — too small to contain text


def _extract_images_from_docx(content: bytes) -> List[bytes]:
    images = []
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.startswith("word/media/") and any(
                    name.lower().endswith(ext)
                    for ext in (".png", ".jpg", ".jpeg")
                ):
                    img_bytes = zf.read(name)
                    if len(img_bytes) < _MIN_IMAGE_BYTES:
                        continue  # skip decorative/icon images
                    images.append(img_bytes)
                    if len(images) >= _MAX_IMAGES:
                        break
    except Exception:
        pass
    return images


def _extract_images_from_pdf(content: bytes) -> List[bytes]:
    images = []
    try:
        import fitz
        with fitz.open(stream=content, filetype="pdf") as doc:
            for page in doc:
                for block in page.get_text("dict")["blocks"]:
                    if block.get("type") == 1:
                        img_bytes = block["image"]
                        if len(img_bytes) < _MIN_IMAGE_BYTES:
                            continue  # skip decorative/icon images
                        images.append(img_bytes)
                        if len(images) >= _MAX_IMAGES:
                            return images
    except Exception:
        pass
    return images


async def _call_vision_llm(image_bytes: bytes) -> str:
    if image_bytes[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    else:
        mime = "image/png"

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = {
        "model": settings.MODEL_VISION,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _VISION_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }
        ],
        "max_tokens": 512,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://fluxnote.ai",
        "X-Title": "Fluxnote AI",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


async def extract_image_text(content: bytes, filename: str) -> str:
    """Extract text from images embedded in DOCX or PDF. Returns '' if none found."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "docx":
        images = await asyncio.to_thread(_extract_images_from_docx, content)
    elif ext == "pdf":
        images = await asyncio.to_thread(_extract_images_from_pdf, content)
    else:
        return ""

    if not images:
        return ""

    # Parallel calls — all images at once, cap latency at single call duration (~30s)
    tasks = [_call_vision_llm(img) for img in images]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    texts = [r for r in results if isinstance(r, str) and r.strip()]
    return "\n\n".join(texts)

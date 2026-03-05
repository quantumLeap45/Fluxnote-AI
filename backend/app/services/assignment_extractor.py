import json
import httpx
from app.config import settings

EXTRACTION_SYSTEM_PROMPT = """You are an academic assignment parser. Extract structured data from student assignment documents.
Return ONLY valid JSON — no markdown, no code blocks, no explanation.

Use this exact schema (null for any field not found):
{
  "title":           "assignment name or null",
  "module":          "subject/module code or null",
  "due_date":        "ISO date YYYY-MM-DD or null",
  "weightage":       "e.g. 30% or null",
  "assignment_type": "Group or Individual or null",
  "deliverable_type":"report or slides or code or reflection or null",
  "summary":         ["3 to 6 bullet strings: what is required and expected deliverables"],
  "checklist":       ["6 to 15 ordered actionable task strings"],
  "constraints":     "word count, format, citation requirements, rubric hints or null"
}"""


async def extract_assignment_data(text: str) -> dict:
    """Send document text to OpenRouter and return structured assignment data."""
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://fluxnote.ai",
        "X-Title": "Fluxnote AI",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.MODEL_BALANCED,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user",   "content": f"Extract structured data from this assignment:\n\n{text[:8000]}"},
        ],
        "max_tokens": 1024,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if model includes them despite instructions
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        return json.loads(content)

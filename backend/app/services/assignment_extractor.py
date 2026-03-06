import asyncio
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
  "marks":           "marks breakdown exactly as written, e.g. 'Part A: 5 marks, Part B: 10 marks' or null",
  "summary":         ["3 to 6 bullet strings describing what the student must do — use the document's own words and framing, do not reinterpret"],
  "checklist":       ["6 to 15 ordered actionable task strings the student should complete"],
  "constraints":     "explicit constraints as stated in the document: word count, page limit, format, specific rules. Quote directly where possible."
}

Critical rules:
- Use the document's own terminology for all domain-specific terms (e.g. if the document says 'donated amount', use that — do not substitute 'revenue' or 'profit')
- If marks are allocated per part or question, capture the breakdown verbatim in the 'marks' field
- The 'constraints' field must include any explicit scope limits (e.g. 'you do not need to sell all units', 'maximum 2000 words')
- Never reinterpret or paraphrase domain-specific language"""


async def _call_openrouter(text: str) -> dict:
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://fluxnote.ai",
        "X-Title": "Fluxnote AI",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.MODEL_FAST,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user",   "content": f"Extract structured data from this assignment:\n\n{text[:8000]}"},
        ],
        "max_tokens": 1024,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=42) as client:
        resp = await client.post(
            f"{settings.OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        return json.loads(content)


async def extract_assignment_data(text: str) -> dict:
    """Extract structured assignment data; raises asyncio.TimeoutError if > 45s."""
    return await asyncio.wait_for(_call_openrouter(text), timeout=45.0)

import asyncio
import json
import httpx
from app.config import settings

EXTRACTION_SYSTEM_PROMPT = """You are an academic assignment parser. Extract structured data from student assignment documents.
Return ONLY valid JSON — no markdown, no code blocks, no explanation.

Use this exact schema:
{
  "title":           "assignment name or null",
  "module":          "subject/module code or null",
  "due_date":        "ISO date YYYY-MM-DD, or the string 'Not stated in document' if not found — never guess or infer",
  "weightage":       "e.g. 30% or null",
  "assignment_type": "Group or Individual or null",
  "deliverable_type":"report or slides or code or reflection or null",
  "marks":           "marks breakdown exactly as written, e.g. 'Part A: 5 marks, Part B: 10 marks' or null",
  "summary":         ["3 to 6 bullet strings describing what the student must do — use the document's own words and framing exactly"],
  "checklist":       ["6 to 15 ordered actionable task strings the student should complete"],
  "constraints":     "All explicit constraints from the document. Must include each of the following if present: (1) objective framing — e.g. maximize donated amount after deducting fees, not just revenue; (2) group-specific data requirement — e.g. each group uses their own unique dataset; (3) sell-out rule — e.g. you do not have to sell all units; (4) price precision — e.g. price can be any number accurate to a cent; (5) tools/method freedom — e.g. no restrictions on tools or methods for graphs; (6) sensibility requirement — e.g. part of assessment is the sensibility of your solution. Quote the document directly where possible."
}

Critical rules:
- NEVER hallucinate a due date. If it is not explicitly written in the document, output the string 'Not stated in document'
- Use the document's own terminology verbatim — do not substitute synonyms (e.g. if the document says 'donated amount', never replace it with 'revenue', 'profit', or 'income')
- The 'constraints' field is high-priority — it must capture all explicit rules, limits, and notes the student needs to follow
- If marks are allocated per part or question, capture the exact breakdown in the 'marks' field
- Never reinterpret, generalise, or paraphrase domain-specific language"""


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

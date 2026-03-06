import asyncio
import json
import httpx
from app.config import settings

EXTRACTION_SYSTEM_PROMPT = """You are a general-purpose academic assignment parser. You work across all subjects, schools, and assignment formats — math, report, coding, group project, reflection, lab, case study, etc.
Return ONLY valid JSON — no markdown, no code blocks, no explanation.

Use this exact schema:
{
  "title":           "assignment title or task name. If not stated, use filename or first heading found",
  "module":          "subject name, module code, or course name — or null if not found",
  "due_date":        "ISO date YYYY-MM-DD if explicitly written in the document. If not found, output the exact string: Not stated in document",
  "weightage":       "assessment weighting e.g. '30%' or '20 marks out of 100' — or null",
  "assignment_type": "Group or Individual — or null if not stated",
  "deliverable_type":"what the student submits: report / slides / code / spreadsheet / reflection / poster / other — or null",
  "marks":           "marks or score breakdown exactly as written in the document e.g. 'Part A: 5 marks, Part B: 10 marks, Total: 15 marks' — or null if not found",
  "summary":         ["3 to 6 bullet strings — the core tasks or questions the student must answer or complete. Use the document's own words and framing. Do not reinterpret or substitute terminology."],
  "checklist":       ["6 to 15 step-by-step actionable tasks the student must complete to finish this assignment, in logical order"],
  "constraints":     "Structured markdown with labelled bullet groups. Only include groups that are present in the document. Use exactly these heading names where applicable:\\n## What NOT To Do\\n- ...\\n## Format & Length Limits\\n- ...\\n## Tools & Methods\\n- ...\\n## Data & Resources\\n- ...\\n## Objective & Goal\\n- ...\\n## Quality Expectations\\n- ...\\n## Submission & Late Policy\\n- ...\\nUse the document's own words. If no constraints found, output null."
}

Rules (apply to ALL assignments regardless of subject):
- NEVER hallucinate a due date. Only output a date if it is explicitly written. Otherwise output the string: Not stated in document
- Use the document's own terminology exactly — never substitute synonyms for domain-specific terms
- The 'summary' and 'constraints' fields must reflect what is actually in this specific document — do not invent generic academic advice
- If a field is not found in the document, output null (except due_date — use the string above)
- The 'checklist' must be actionable steps for THIS specific assignment, not generic study tips"""


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

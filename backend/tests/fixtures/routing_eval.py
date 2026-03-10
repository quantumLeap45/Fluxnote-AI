"""
Canonical routing evaluation set for _quick_classify and should_escalate_deep_think.

Each entry is a tuple used by parametrized pytest tests.

QUICK_CLASSIFY_CASES: (prompt, expected_task_type | None)
  expected_task_type is the string returned by _quick_classify, or None when
  the function should return None (no keyword signal → LLM fallback path).

DT_ESCALATION_CASES: (message, should_escalate: bool, reason)
  message  — the clean user prompt (what request.message contains)
  should_escalate — expected return value of should_escalate_deep_think(message, message)
  reason   — human-readable label shown in parametrize IDs

Known limitations documented here:
  - 'code of conduct' still classifies as 'code' because 'code' IS a whole word.
    Word-boundary matching only prevents substring false positives (e.g. 'api' in
    'capital'). Whole-word polysemy is a semantic ambiguity that requires context.
"""

# ── _quick_classify evaluation set (25 prompts) ───────────────────────────────

QUICK_CLASSIFY_CASES = [
    # ── Code (positive matches) ────────────────────────────────────────────────
    ("write python code to sort a list",                "code"),
    ("help me debug this javascript function",           "code"),
    ("my for loop keeps throwing an exception",          "code"),
    ("implement a binary search algorithm",              "code"),
    ("how do I fix this sql query?",                     "code"),
    ("what is wrong with my html and css layout?",      "code"),

    # ── Math (positive matches) ────────────────────────────────────────────────
    ("solve this equation: x squared plus 3x equals 10", "math"),
    ("calculate the probability of rolling two sixes",   "math"),
    ("prove that the square root of 2 is irrational",    None),   # 'prove' ≠ 'proof' keyword → LLM fallback
    ("what is the derivative of x cubed?",               "math"),

    # ── Creative (positive matches) ────────────────────────────────────────────
    ("write a short story about a lost robot",           "creative"),
    ("help me come up with a poem for my friend",        "creative"),
    ("I need a fantasy narrative for my game",           "creative"),

    # ── Writing (positive matches) ─────────────────────────────────────────────
    ("help me write an essay about climate change",      "writing"),
    ("draft an email to my professor about an extension","writing"),
    ("can you summarize this document for me?",          "writing"),

    # ── Factual (positive matches) ─────────────────────────────────────────────
    ("what is photosynthesis?",                          "factual"),
    ("who is Albert Einstein?",                          "factual"),
    ("explain what a CPU is",                            "factual"),

    # ── Analysis (positive matches) ────────────────────────────────────────────
    ("compare the pros and cons of remote work",         "analysis"),
    ("analyze the trade-off between cost and quality",   "analysis"),
    ("should I use React or Vue for my project?",           "analysis"),  # no code keywords → analysis

    # ── Substring false positives (must NOT route as code) ────────────────────
    ("What are the capital cities of Europe?",           None),   # 'api' in 'capital'
    ("I enjoy listening to classical music",             None),   # 'class' in 'classical'

    # ── No-keyword conversational (must return None) ───────────────────────────
    ("hello, how are you doing today?",                  None),
    ("thank you for your help earlier",                  None),
]


# ── should_escalate_deep_think evaluation set (12 prompts) ────────────────────
# Each entry: (message, should_escalate, reason_label)

DT_ESCALATION_CASES = [
    # Should escalate — list triggers
    ("list all requirements for this assignment",          True,  "list_all_trigger"),
    ("give me the full list of topics covered",            True,  "full_list_trigger"),
    ("what are all the submission rules?",                 True,  "submission_rules_trigger"),
    ("show me every topic in the syllabus",                True,  "every_trigger"),

    # Should escalate — verify triggers
    ("can you double check my answer?",                    True,  "double_check_trigger"),
    ("verify that I've covered all sections",              True,  "verify_trigger"),
    ("make sure I haven't missed anything important",      True,  "make_sure_trigger"),

    # Should escalate — reasoning triggers
    ("explain how integration works step by step",         True,  "step_by_step_trigger"),
    ("solve for x in this multi-step equation",           True,  "multi_step_trigger"),

    # Should NOT escalate — generic questions without trigger phrases
    ("what is the word count limit?",                      False, "generic_question"),
    ("help me understand section 2",                       False, "understand_request"),
    ("what is the deadline for this assignment?",          False, "deadline_question"),

    # Should NOT escalate — large doc present but no trigger phrases
    # (the heavy_context check has been removed; doc size must not trigger escalation)
    ("what is this assignment about?",                     False, "no_trigger_despite_doc"),
]

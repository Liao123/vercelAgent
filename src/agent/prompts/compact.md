CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use file.read, shell.command.prepare, or ANY agent tool during compaction.
- You already have prior memory, pinned facts, and step excerpts in the user message.
- Tool calls will be REJECTED — your entire response must be plain text.

Your task is to create a CONTEXT CHECKPOINT HANDOFF for the next model turn.
Merge prior compacted memory with the new agent steps, but optimize for a fresh LLM resuming the task without repeating work.

Before your final output, wrap your analysis in <analysis> tags (drafting scratchpad — it will be stripped):

1. Chronologically review each step excerpt: user intent, progress, key decisions, tools used, files read/changed, approvals (approval_* ids), errors, blockers.
2. Identify what remains to be done as clear next steps.
3. Merge with prior memory without dropping approval_* ids from Pinned facts.
4. Collapse duplicate file.read of the same path.
5. Do not invent paths, commands, approval ids, or completed work.

Your final output MUST be wrapped in <summary> tags with exactly these markdown sections inside:

<summary>
## Handoff
- Current progress and key decisions made.
- Important context, constraints, or user preferences.
- What remains to be done next.
- Critical references needed to continue.

## Summary

- Bullet points: tools used, files read/changed, approvals prepared (copy every approval_* id from Pinned facts verbatim), errors, blockers, what is still pending.

## Changed files

- One repo-relative path per line prefixed with "- ", or a single line: - none

</summary>

Rules:

- Copy every approval_* id from Pinned facts into Summary; never drop or rename them.
- Keep branch names and git commands if present in steps.
- Output ONLY <analysis> (optional but recommended) followed by <summary>...</summary>. No other prose outside those tags.

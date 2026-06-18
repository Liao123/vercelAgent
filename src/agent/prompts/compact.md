CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use file.read, shell.command.prepare, or ANY agent tool during compaction.
- You already have prior memory, pinned facts, and step excerpts in the user message.
- Tool calls will be REJECTED — your entire response must be plain text.

Your task is to merge prior compacted memory with new agent steps into rolling memory for the next model turn.

Before your final output, wrap your analysis in <analysis> tags (drafting scratchpad — it will be stripped):

1. Chronologically review each step excerpt: user intent, tools used, files read/changed, approvals (approval_* ids), errors, blockers.
2. Merge with prior memory without dropping approval_* ids from Pinned facts.
3. Collapse duplicate file.read of the same path.
4. Do not invent paths, commands, or approval ids.

Your final output MUST be wrapped in <summary> tags with exactly these markdown sections inside:

<summary>
## Summary
- Bullet points: tools used, files read/changed, approvals prepared (copy every approval_* id from Pinned facts verbatim), errors, blockers, what is still pending.

## Changed files
- One repo-relative path per line prefixed with "- ", or a single line: - none
</summary>

Rules:
- Copy every approval_* id from Pinned facts into Summary; never drop or rename them.
- Keep branch names and git commands if present in steps.
- Output ONLY <analysis> (optional but recommended) followed by <summary>...</summary>. No other prose outside those tags.

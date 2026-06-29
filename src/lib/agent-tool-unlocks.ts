export type AgentToolUnlock = {
  name: string;
  description?: string;
  args?: Record<string, string>;
  score?: number;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function extractToolUnlocks(result: unknown): AgentToolUnlock[] {
  const record = objectRecord(result);
  if (!record) return [];

  const byName = new Map<string, AgentToolUnlock>();
  const matches = Array.isArray(record.matches) ? record.matches : [];
  for (const item of matches) {
    const match = objectRecord(item);
    if (!match || typeof match.name !== "string") continue;
    byName.set(match.name, {
      name: match.name,
      description:
        typeof match.description === "string" ? match.description : undefined,
      args: stringRecord(match.args),
      score: typeof match.score === "number" ? match.score : undefined,
    });
  }

  const unlockedTools = Array.isArray(record.unlockedTools)
    ? record.unlockedTools
    : [];
  for (const item of unlockedTools) {
    if (typeof item !== "string") continue;
    if (!byName.has(item)) byName.set(item, { name: item });
  }

  return [...byName.values()];
}

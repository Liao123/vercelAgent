export const STRICT_PREPARE_LOOP_KEY = "vec.agent.strictPrepareLoop";

export function normalizeStrictPrepareLoop(
  value: string | null | undefined,
): boolean {
  return value === "1";
}

export function readStrictPrepareLoop(): boolean {
  if (typeof window === "undefined") return false;
  return normalizeStrictPrepareLoop(
    window.localStorage.getItem(STRICT_PREPARE_LOOP_KEY),
  );
}

export function writeStrictPrepareLoop(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STRICT_PREPARE_LOOP_KEY, enabled ? "1" : "0");
}

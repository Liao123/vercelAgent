const STORAGE_KEY = "vec-agent-dev";

/** 开发者模式：URL `?dev=1` 或 localStorage `vec-agent-dev=1`。 */
export function isAgentDevMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "1" || params.get("dev") === "true") {
      return true;
    }
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function enableAgentDevModePersist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

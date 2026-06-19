/** 三栏布局列宽偏好（px），持久化到 localStorage。 */

const STORAGE_KEY = "vec-triple-layout-v1";

export const TRIPLE_LEFT_MIN = 176;
export const TRIPLE_LEFT_MAX = 360;
export const TRIPLE_LEFT_DEFAULT = 224;

export const TRIPLE_RIGHT_MIN = 280;
export const TRIPLE_RIGHT_MAX = 520;
export const TRIPLE_RIGHT_DEFAULT = 384;

export type TripleLayoutPrefs = {
  leftWidth: number;
  rightWidth: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function readTripleLayoutPrefs(): TripleLayoutPrefs {
  if (typeof window === "undefined") {
    return {
      leftWidth: TRIPLE_LEFT_DEFAULT,
      rightWidth: TRIPLE_RIGHT_DEFAULT,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTripleLayoutPrefs();
    const parsed = JSON.parse(raw) as Partial<TripleLayoutPrefs>;
    return {
      leftWidth: clamp(
        Number(parsed.leftWidth) || TRIPLE_LEFT_DEFAULT,
        TRIPLE_LEFT_MIN,
        TRIPLE_LEFT_MAX,
      ),
      rightWidth: clamp(
        Number(parsed.rightWidth) || TRIPLE_RIGHT_DEFAULT,
        TRIPLE_RIGHT_MIN,
        TRIPLE_RIGHT_MAX,
      ),
    };
  } catch {
    return defaultTripleLayoutPrefs();
  }
}

export function defaultTripleLayoutPrefs(): TripleLayoutPrefs {
  return {
    leftWidth: TRIPLE_LEFT_DEFAULT,
    rightWidth: TRIPLE_RIGHT_DEFAULT,
  };
}

export function writeTripleLayoutPrefs(prefs: TripleLayoutPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        leftWidth: clamp(
          prefs.leftWidth,
          TRIPLE_LEFT_MIN,
          TRIPLE_LEFT_MAX,
        ),
        rightWidth: clamp(
          prefs.rightWidth,
          TRIPLE_RIGHT_MIN,
          TRIPLE_RIGHT_MAX,
        ),
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

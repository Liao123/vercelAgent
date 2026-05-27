/**
 * 轻量行级 diff（无第三方依赖），供审批 UI 展示。
 */
export type DiffRow =
  | { kind: "equal"; line: string }
  | { kind: "delete"; line: string }
  | { kind: "insert"; line: string };

export type SplitDiffSide = {
  lineNum: number | null;
  text: string;
  kind: "equal" | "delete" | "insert" | "empty";
};

export type SplitAlignedRow = {
  left: SplitDiffSide;
  right: SplitDiffSide;
};

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r\n|\n|\r/);
}

/** 基于 LCS 的行级 diff。 */
export function computeLineDiff(before: string, after: string): DiffRow[] {
  const left = splitLines(before);
  const right = splitLines(after);
  const rows = left.length;
  const cols = right.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    Array(cols + 1).fill(0),
  );

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const result: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      result.push({ kind: "equal", line: left[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: "delete", line: left[i] });
      i += 1;
    } else {
      result.push({ kind: "insert", line: right[j] });
      j += 1;
    }
  }
  while (i < rows) {
    result.push({ kind: "delete", line: left[i] });
    i += 1;
  }
  while (j < cols) {
    result.push({ kind: "insert", line: right[j] });
    j += 1;
  }
  return result;
}

export function capDiffRows(
  rows: DiffRow[],
  maxRows: number,
): { rows: DiffRow[]; truncated: boolean } {
  if (rows.length <= maxRows) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, maxRows), truncated: true };
}

/** 将行级 diff 转为左右对照行，并附带变更前/后的行号。 */
export function toSplitAlignedRows(rows: DiffRow[]): SplitAlignedRow[] {
  let leftNum = 1;
  let rightNum = 1;
  const aligned: SplitAlignedRow[] = [];

  for (const row of rows) {
    if (row.kind === "equal") {
      aligned.push({
        left: { lineNum: leftNum, text: row.line, kind: "equal" },
        right: { lineNum: rightNum, text: row.line, kind: "equal" },
      });
      leftNum += 1;
      rightNum += 1;
      continue;
    }

    if (row.kind === "delete") {
      aligned.push({
        left: { lineNum: leftNum, text: row.line, kind: "delete" },
        right: { lineNum: null, text: "", kind: "empty" },
      });
      leftNum += 1;
      continue;
    }

    aligned.push({
      left: { lineNum: null, text: "", kind: "empty" },
      right: { lineNum: rightNum, text: row.line, kind: "insert" },
    });
    rightNum += 1;
  }

  return aligned;
}

export function capSplitAlignedRows(
  rows: SplitAlignedRow[],
  maxRows: number,
): { rows: SplitAlignedRow[]; truncated: boolean } {
  if (rows.length <= maxRows) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, maxRows), truncated: true };
}

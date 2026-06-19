/**
 * A134：从当前页面抽取结构化 design spec JSON（对齐 agent-architecture § design 解析层）。
 */
import { cdpEvaluate } from "@/agent/devtools/cdp-client";

export type DesignSpecNode = {
  tag: string;
  role?: string;
  text?: string;
  bounds: { x: number; y: number; w: number; h: number };
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
    fontWeight: string;
    borderRadius: string;
    padding: string;
    display: string;
  };
};

export type DesignSpec = {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  theme: {
    bodyColor: string;
    bodyBackground: string;
    fontFamily: string;
  };
  nodes: DesignSpecNode[];
  extractedAt: string;
};

/** 在 guest 页面内执行，返回可 JSON 序列化的 design spec。 */
export const DESIGN_SPEC_EXTRACT_SCRIPT = `(function() {
  var MAX_NODES = 160;
  var MAX_DEPTH = 5;
  var nodes = [];
  function walk(el, depth) {
    if (!el || nodes.length >= MAX_NODES || depth > MAX_DEPTH) return;
    if (el.nodeType !== 1) return;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) return;
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    var text = "";
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      text = (el.textContent || "").trim().slice(0, 120);
    }
    nodes.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || undefined,
      text: text || undefined,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      styles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontFamily: (cs.fontFamily || "").split(",")[0].trim(),
        fontWeight: cs.fontWeight,
        borderRadius: cs.borderRadius,
        padding: cs.padding,
        display: cs.display,
      },
    });
    var children = el.children || [];
    for (var i = 0; i < children.length; i++) walk(children[i], depth + 1);
  }
  var bodyCs = window.getComputedStyle(document.body);
  walk(document.body, 0);
  return {
    url: location.href,
    title: document.title || "",
    viewport: { width: window.innerWidth, height: window.innerHeight },
    theme: {
      bodyColor: bodyCs.color,
      bodyBackground: bodyCs.backgroundColor,
      fontFamily: (bodyCs.fontFamily || "").split(",")[0].trim(),
    },
    nodes: nodes,
    extractedAt: new Date().toISOString(),
  };
})()`;

export async function extractDesignSpecFromPage(): Promise<DesignSpec> {
  const raw = await cdpEvaluate(DESIGN_SPEC_EXTRACT_SCRIPT);
  if (!raw || typeof raw !== "object") {
    throw new Error("design spec 抽取失败：页面脚本无返回。");
  }
  return raw as DesignSpec;
}

export type DesignSpecSummary = {
  url: string;
  title: string;
  viewport: DesignSpec["viewport"];
  theme: DesignSpec["theme"];
  nodeCount: number;
  colorPalette: string[];
  typography: Array<{ fontFamily: string; fontSize: string; count: number }>;
  topNodes: Array<{
    tag: string;
    text?: string;
    bounds: DesignSpecNode["bounds"];
    styles: Pick<
      DesignSpecNode["styles"],
      "color" | "backgroundColor" | "fontSize" | "fontFamily"
    >;
  }>;
};

/** 压缩 design spec 供 Agent 读盘写码，避免 tool 结果过大。 */
export function summarizeDesignSpec(
  spec: DesignSpec,
  options?: { topNodeLimit?: number },
): DesignSpecSummary {
  const topNodeLimit = options?.topNodeLimit ?? 24;
  const colors = new Set<string>();
  const fontMap = new Map<string, number>();

  for (const node of spec.nodes) {
    if (node.styles.color) colors.add(node.styles.color);
    if (node.styles.backgroundColor) colors.add(node.styles.backgroundColor);
    const key = `${node.styles.fontFamily}|${node.styles.fontSize}`;
    fontMap.set(key, (fontMap.get(key) ?? 0) + 1);
  }

  const typography = [...fontMap.entries()]
    .map(([key, count]) => {
      const [fontFamily, fontSize] = key.split("|");
      return { fontFamily, fontSize, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topNodes = [...spec.nodes]
    .sort(
      (a, b) =>
        b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h,
    )
    .slice(0, topNodeLimit)
    .map((node) => ({
      tag: node.tag,
      text: node.text,
      bounds: node.bounds,
      styles: {
        color: node.styles.color,
        backgroundColor: node.styles.backgroundColor,
        fontSize: node.styles.fontSize,
        fontFamily: node.styles.fontFamily,
      },
    }));

  return {
    url: spec.url,
    title: spec.title,
    viewport: spec.viewport,
    theme: spec.theme,
    nodeCount: spec.nodes.length,
    colorPalette: [...colors].slice(0, 16),
    typography,
    topNodes,
  };
}

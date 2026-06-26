/**
 * 模型 API 失败后的确定性兜底（阶段 B）：诊断 + 可选截图，不依赖 LLM。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { collectAgentDiagnosePayload } from "@/agent/core/agent-diagnose";
import type { AgentLoopRunState } from "@/agent/core/agent-loop-state";
import { isDesignReplicateRequest } from "@/agent/core/task-playbooks";
import { loadLatestDesignSpecMeta } from "@/agent/browser/design-spec-store";
import { cdpScreenshotJpegBase64 } from "@/agent/devtools/cdp-client";
import { isCdpBridgeAvailable } from "@/agent/devtools/cdp-bridge-config";
import type { WorkspaceInfo } from "@/agent/workspace";
import { resolveUserSavePath } from "@/lib/user-path";

export function isEnvironmentTaskRequest(request: string): boolean {
  return /截图|screenshot|桌面|desktop[:/\\]|mcp|cdp|devtools|浏览器.*(截图|检查|打开)|agent\.diagnose|诊断/i.test(
    request,
  );
}

export function inferScreenshotFilePath(request: string): string | null {
  const desktopAlias = request.match(/desktop:[^\s"'，。、]+/i);
  if (desktopAlias) return desktopAlias[0];

  const tilde = request.match(/~\/Desktop\/[^\s"'，。、]+/i);
  if (tilde) return tilde[0];

  if (!/截图|screenshot/i.test(request)) return null;

  const named = request.match(
    /(?:名为|叫|保存为|save\s+(?:as|to)|named?)\s*[`"'「]?([^\s`"'，。、]+)/i,
  );
  if (named?.[1]) {
    const name = named[1].replace(/^desktop:/i, "");
    return `desktop:${name}`;
  }

  return `desktop:agent-screenshot-${Date.now()}.jpg`;
}

export type DeterministicRecoveryResult = {
  recovered: boolean;
  summary: string;
};

export async function attemptDeterministicModelFailureRecovery(input: {
  workspace: WorkspaceInfo;
  userRequest: string;
  runState: AgentLoopRunState;
}): Promise<DeterministicRecoveryResult | null> {
  if (
    isDesignReplicateRequest(input.userRequest) &&
    input.runState.toolsCalled.includes("devtools.extract_design_spec")
  ) {
    const meta = await loadLatestDesignSpecMeta(input.workspace.rootPath);
    if (meta) {
      return {
        recovered: false,
        summary: [
          "【确定性恢复】模型暂不可用，但 design spec 已提取到当前 workspace。",
          `标题: ${meta.title} · 节点: ${meta.nodeCount} · 路径: ${meta.filePath}`,
          "请重开或续跑：devtools.get_persisted_design_spec → file.mutation.prepare 写 index.html + CSS + JS。",
          "勿再 file.read latest.json；勿只 gather。",
        ].join("\n"),
      };
    }
  }

  if (!isEnvironmentTaskRequest(input.userRequest)) return null;

  const diagnose = await collectAgentDiagnosePayload(input.workspace);
  const lines: string[] = [
    "【确定性恢复】模型暂不可用，已自动执行环境诊断。",
    diagnose.summary,
    ...diagnose.suggestions,
  ];

  const screenshotPath = inferScreenshotFilePath(input.userRequest);
  const wantsScreenshot = /截图|screenshot/i.test(input.userRequest);

  if (wantsScreenshot && screenshotPath && (await isCdpBridgeAvailable())) {
    try {
      const shot = await cdpScreenshotJpegBase64({
        useCaptureWindow: /js\.design|figma\.com|mastergo/i.test(input.userRequest),
      });
      const jpegBase64 = shot.jpegBase64;
      if (jpegBase64) {
        const resolved = resolveUserSavePath(screenshotPath);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, Buffer.from(jpegBase64, "base64"));
        lines.push(`截图已保存：${resolved}`);
        return { recovered: true, summary: lines.join("\n") };
      }
      lines.push("CDP 在线但截图为空：请先在右栏浏览器 Tab 打开页面后重试。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`截图失败：${message}`);
    }
  } else if (wantsScreenshot && !diagnose.browser.cdpBridgeOnline) {
    lines.push("无法截图：CDP 离线。请运行 npm run dev:desktop 并在浏览器 Tab 打开页面。");
  }

  const actionable = diagnose.ok || lines.some((line) => line.includes("已保存"));
  return {
    recovered: actionable,
    summary: lines.join("\n"),
  };
}

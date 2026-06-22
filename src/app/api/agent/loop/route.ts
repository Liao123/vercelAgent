/**
 * 模型驱动 Agent Loop API。
 *
 * A028：模型按 JSON 协议选择安全工具，runtime 执行后继续把观察结果喂回模型。
 */
import { runAgentLoop } from "@/agent/core";
import { createAgentEventStream } from "@/agent/protocol/stream";
import type { AgentUiContext } from "@/agent/types";

export const dynamic = "force-dynamic";

function parseUiContextFromBody(
  raw: unknown,
): AgentUiContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as {
    layout?: string;
    activeRoute?: string;
    openEditorPaths?: unknown;
    activeEditorPath?: unknown;
    browserActiveTab?: unknown;
  };
  const layout = body.layout;
  if (layout !== "default" && layout !== "workspace" && layout !== "triple") {
    return undefined;
  }
  const ctx: AgentUiContext = {
    layout,
    activeRoute:
      typeof body.activeRoute === "string" && body.activeRoute.trim()
        ? body.activeRoute.trim()
        : "/",
  };
  if (Array.isArray(body.openEditorPaths)) {
    const openEditorPaths = body.openEditorPaths.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (openEditorPaths.length > 0) {
      ctx.openEditorPaths = openEditorPaths.map((p) => p.replaceAll("\\", "/"));
    }
  }
  if (
    typeof body.activeEditorPath === "string" &&
    body.activeEditorPath.trim()
  ) {
    ctx.activeEditorPath = body.activeEditorPath.trim().replaceAll("\\", "/");
  }
  if (body.browserActiveTab && typeof body.browserActiveTab === "object") {
    const tab = body.browserActiveTab as { url?: unknown; title?: unknown };
    if (typeof tab.url === "string" && tab.url.trim()) {
      ctx.browserActiveTab = {
        url: tab.url.trim(),
        title: typeof tab.title === "string" ? tab.title : null,
      };
    }
  }
  return ctx;
}

export async function POST(request: Request) {
  let body: {
    userRequest?: string;
    referenceImages?: string[];
    maxIterations?: number;
    model?: string;
    threadId?: string;
    uiContext?: unknown;
    attachedPaths?: string[];
    attachedSelections?: Array<{
      path: string;
      startLine: number;
      endLine: number;
      selectedText?: string;
    }>;
    strictPrepare?: boolean;
    shellResume?: {
      approvalId: string;
      result: {
        command: string;
        success: boolean;
        output: string;
        completedAt?: string;
      };
    };
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const userRequest = body.userRequest?.trim() ?? "";

  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.filter(
        (item): item is string =>
          typeof item === "string" && item.startsWith("data:image/"),
      )
    : undefined;

  if (
    !userRequest &&
    !body.shellResume &&
    (!referenceImages || referenceImages.length === 0)
  ) {
    return Response.json(
      { error: "userRequest or referenceImages is required." },
      { status: 400 },
    );
  }

  const writer = createAgentEventStream();

  const threadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : undefined;

  const uiContext = parseUiContextFromBody(body.uiContext);

  const attachedPaths = Array.isArray(body.attachedPaths)
    ? body.attachedPaths.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : undefined;

  const attachedSelections = Array.isArray(body.attachedSelections)
    ? body.attachedSelections
        .filter(
          (item): item is {
            path: string;
            startLine: number;
            endLine: number;
            selectedText?: string;
          } =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof item.path === "string" &&
                typeof item.startLine === "number" &&
                typeof item.endLine === "number",
            ),
        )
        .map((item) => ({
          path: item.path.trim(),
          startLine: item.startLine,
          endLine: item.endLine,
          selectedText:
            typeof item.selectedText === "string"
              ? item.selectedText
              : undefined,
        }))
    : undefined;

  void runAgentLoop({
    userRequest: userRequest || "请根据附图完成开发任务。",
    referenceImages:
      referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    maxIterations: body.maxIterations,
    model: body.model,
    threadId,
    uiContext,
    attachedPaths,
    attachedSelections,
    strictPrepare: body.strictPrepare === true,
    shellResume: body.shellResume,
    onEvent: (event) => writer.emit(event),
  })
    .then(() => {
      writer.close();
    })
    .catch((error) => {
      writer.emit({
        type: "task.failed",
        taskId: "task_unavailable",
        error: error instanceof Error ? error.message : String(error),
      });
      writer.close();
    });

  return writer.response;
}

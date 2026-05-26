/**
 * Agent file location API.
 *
 * 输入中文/自然语言需求，基于项目索引返回相关文件候选。
 */
import { buildProjectIndex, locateFilesForRequest } from "@/agent/indexer";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { query?: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return Response.json({ error: "query is required." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace();
  const index = await buildProjectIndex(workspace.rootPath);
  const result = locateFilesForRequest(index, query, body.limit ?? 12);

  return Response.json({ result });
}

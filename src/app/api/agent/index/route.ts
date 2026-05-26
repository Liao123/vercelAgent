/**
 * Agent project index API.
 *
 * 只读接口：扫描当前 workspace，返回轻量项目索引。
 */
import { buildProjectIndex } from "@/agent/indexer";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await getCurrentWorkspace();
  const index = await buildProjectIndex(workspace.rootPath);
  return Response.json({ index });
}

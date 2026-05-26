/**
 * Agent verification API.
 *
 * 受控运行 package.json 中存在的 npm scripts：lint/build/test/typecheck。
 */
import {
  getVerificationPlan,
  runVerificationPlan,
  type VerificationCommand,
} from "@/agent/verification";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

function parseCommands(value: unknown): VerificationCommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(["lint", "build", "test", "typecheck"]);
  const commands = value.filter(
    (item): item is VerificationCommand =>
      typeof item === "string" && allowed.has(item),
  );
  return commands.length > 0 ? commands : undefined;
}

export async function GET() {
  const workspace = await getCurrentWorkspace();
  const plan = await getVerificationPlan(workspace.rootPath);
  return Response.json({ plan });
}

export async function POST(request: Request) {
  let body: { commands?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const workspace = await getCurrentWorkspace();
  const result = await runVerificationPlan(
    workspace.rootPath,
    parseCommands(body.commands),
  );
  return Response.json({ result });
}

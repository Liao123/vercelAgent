import { getPersistedBrowserHarLog } from "@/agent/browser/browser-har";

export const dynamic = "force-dynamic";

export async function GET() {
  const log = await getPersistedBrowserHarLog();
  if (!log) {
    return Response.json({ error: "HAR log not found." }, { status: 404 });
  }
  return Response.json({ log });
}

import {
  clearPendingBrowserQuery,
  getPendingBrowserQuery,
  saveBrowserQueryResult,
  type BrowserQueryMatch,
} from "@/agent/browser/browser-query";

export const dynamic = "force-dynamic";

export async function GET() {
  const pending = await getPendingBrowserQuery();
  return Response.json({ pending });
}

export async function POST(request: Request) {
  let body: {
    selector?: string;
    url?: string | null;
    matches?: BrowserQueryMatch[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.selector?.trim()) {
    return Response.json({ error: "selector is required." }, { status: 400 });
  }

  const pending = await getPendingBrowserQuery();
  if (!pending || pending.selector !== body.selector.trim()) {
    return Response.json(
      { error: "No matching pending browser query." },
      { status: 409 },
    );
  }

  const result = await saveBrowserQueryResult({
    selector: body.selector.trim(),
    matches: Array.isArray(body.matches) ? body.matches : [],
    completedAt: new Date().toISOString(),
    url: body.url ?? null,
  });
  await clearPendingBrowserQuery();
  return Response.json({ result });
}

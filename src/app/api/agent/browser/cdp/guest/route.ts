import { persistBrowserCdpGuest } from "@/agent/browser/browser-cdp-guest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { guestWebContentsId?: number; browserVersion?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  const guestId = Number(body.guestWebContentsId);
  if (!Number.isFinite(guestId)) {
    return Response.json({ error: "guestWebContentsId required." }, { status: 400 });
  }

  const state = await persistBrowserCdpGuest({
    guestWebContentsId: guestId,
    browserVersion: body.browserVersion,
  });
  return Response.json({ ok: true, guest: state });
}

import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const SCREENSHOT_PATH = path.join(
  process.cwd(),
  ".agent-state",
  "browser-screenshot.jpg",
);

export async function GET() {
  try {
    const buf = await fs.readFile(SCREENSHOT_PATH);
    return new Response(buf, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Screenshot not found." }, { status: 404 });
  }
}

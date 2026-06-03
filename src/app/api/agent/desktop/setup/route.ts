import {
  getDesktopSetupStatus,
  seedDesktopEnvLocalFromExample,
} from "@/lib/desktop-setup-server";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getDesktopSetupStatus());
}

export async function POST(request: Request) {
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.action === "seed-env") {
    try {
      const result = await seedDesktopEnvLocalFromExample();
      const status = await getDesktopSetupStatus();
      return Response.json({ ...result, status });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to create .env.local from .env.example.",
        },
        { status: 400 },
      );
    }
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}

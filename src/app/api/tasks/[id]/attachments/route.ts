import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Working paper storage in-app is disabled.
// SharePoint integration will replace this endpoint.

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Working paper storage in-app is disabled. Save files to SharePoint and use manager review instead.",
    },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Working paper uploads are disabled (SharePoint integration pending).",
    },
    { status: 410 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error:
        "Working paper deletions are disabled (SharePoint integration pending).",
    },
    { status: 410 }
  );
}

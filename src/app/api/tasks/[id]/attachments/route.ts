import { prisma } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BUCKET = "working-papers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const attachments = await prisma.attachment.findMany({
    where: { taskId: id },
    orderBy: [{ createdAt: "desc" }],
  });
  return NextResponse.json({ attachments });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const filename = file.name || "upload";
  const contentType = file.type || "application/octet-stream";

  const allowed = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "image/jpeg",
    "image/png",
  ];

  if (!allowed.includes(contentType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${contentType}` },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${id}/${Date.now()}-${filename}`;

  const supabase = supabaseAdmin();

  const up = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false });

  if (up.error) {
    return NextResponse.json(
      {
        error:
          up.error.message +
          ` (bucket: ${BUCKET}). Ensure the bucket exists and allows uploads via service role.`,
      },
      { status: 500 }
    );
  }

  const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.data.publicUrl;

  const attachment = await prisma.attachment.create({
    data: {
      taskId: id,
      url,
      path,
      filename,
      contentType,
      sizeBytes: bytes.length,
    },
  });

  // If this is a monthly task, uploading a WP moves it into "Submitted" (display-only workflow).
  const task = await prisma.task.findUnique({ where: { id } });
  if ((task?.frequency ?? "").toLowerCase() === "monthly") {
    await prisma.task.update({
      where: { id },
      data: {
        approvalStatus: "SUBMITTED",
        reviewedAt: null,
        // keep reviewedBy/reviewNotes (so you can see prior feedback), but it’s now resubmitted.
      },
    });
  }

  return NextResponse.json({ attachment }, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { attachmentId?: string };
  if (!body.attachmentId) {
    return NextResponse.json(
      { error: "attachmentId is required" },
      { status: 400 }
    );
  }

  const att = await prisma.attachment.findFirst({
    where: { id: body.attachmentId, taskId: id },
  });
  if (!att) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = supabaseAdmin();
  await supabase.storage.from(BUCKET).remove([att.path]);
  await prisma.attachment.delete({ where: { id: att.id } });

  return NextResponse.json({ ok: true });
}

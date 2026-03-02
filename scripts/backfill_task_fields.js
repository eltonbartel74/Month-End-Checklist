const { PrismaClient } = require('@prisma/client');

function parseNotes(notes) {
  if (!notes) return {};
  const parts = String(notes).split('|').map(p => p.trim()).filter(Boolean);
  const out = {};
  for (const p of parts) {
    const idx = p.indexOf(':');
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim().toLowerCase();
    const val = p.slice(idx + 1).trim();
    if (!val) continue;
    if (key === 'frequency') out.frequency = val;
    if (key === 'est hours (p/m)' || key === 'est hours (pm)' || key === 'est hours') out.estHoursPm = val;
    if (key === 'dependency') out.dependency = val;
  }
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tasks = await prisma.task.findMany({
      where: {
        OR: [{ frequency: null }, { estHoursPm: null }, { dependency: null }],
        NOT: { notes: null },
      },
      select: { id: true, notes: true, frequency: true, estHoursPm: true, dependency: true },
      take: 5000,
    });

    let updated = 0;
    for (const t of tasks) {
      const parsed = parseNotes(t.notes);
      const data = {};
      if (!t.frequency && parsed.frequency) data.frequency = parsed.frequency;
      if (!t.estHoursPm && parsed.estHoursPm) data.estHoursPm = parsed.estHoursPm;
      if (!t.dependency && parsed.dependency) data.dependency = parsed.dependency;

      if (Object.keys(data).length === 0) continue;
      await prisma.task.update({ where: { id: t.id }, data });
      updated++;
    }

    console.log(`Backfill complete. updated=${updated} scanned=${tasks.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const tasks = await prisma.task.findMany({
      where: { frequency: { in: ['monthly', 'Monthly', 'MONTHLY'] } },
      orderBy: [{ owner: 'asc' }, { title: 'asc' }],
    });

    const outPath = process.argv[2] || path.join(process.cwd(), 'monthly_tasks_export.json');
    fs.writeFileSync(outPath, JSON.stringify(tasks, null, 2));
    console.error(`Wrote ${tasks.length} tasks -> ${outPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

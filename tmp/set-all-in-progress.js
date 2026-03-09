/*
  Set all tasks back to IN_PROGRESS.
  Also clears completion/review fields so KPIs + governance reflect the reset.

  Usage: node tmp/set-all-in-progress.js
*/

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const res = await prisma.task.updateMany({
    data: {
      status: 'IN_PROGRESS',
      lastDoneAt: null,
      approvalStatus: 'NOT_SUBMITTED',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    },
  });

  console.log(`Updated tasks: ${res.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

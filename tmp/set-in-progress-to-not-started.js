/*
  One-off data fix: set all tasks currently IN_PROGRESS back to NOT_STARTED.
  - Leaves DONE tasks untouched.
  - Intended for Month End Close Cockpit.

  Usage:
    node tmp/set-in-progress-to-not-started.js

  Requires env to connect to Prisma DB (same as app).
*/

const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.task.count({ where: { status: "IN_PROGRESS" } });
    console.log(`Found ${count} task(s) with status IN_PROGRESS`);

    if (count === 0) return;

    const res = await prisma.task.updateMany({
      where: { status: "IN_PROGRESS" },
      data: { status: "NOT_STARTED" },
    });

    console.log(`Updated ${res.count} task(s) to NOT_STARTED`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

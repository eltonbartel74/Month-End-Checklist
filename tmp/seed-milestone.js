require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const title = 'Bank reconciliations complete (EOM)';
  let t = await prisma.task.findFirst({ where: { title } });
  if (!t) {
    t = await prisma.task.create({
      data: {
        title,
        owner: null,
        status: 'NOT_STARTED',
        frequency: 'Monthly',
        estHoursPm: '0',
        dependency: null,
        repeatEnabled: true,
        dailyTime: null,
        weeklyDays: [],
        monthlyDay: 31,
        nextDueAt: null,
        dueAt: null,
        etaAt: null,
        blocker: null,
        notes: 'Milestone: complete all bank reconciliations for end of month.',
      },
    });
    console.log('created', t.id);
  } else {
    console.log('exists', t.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

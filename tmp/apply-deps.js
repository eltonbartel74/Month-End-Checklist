require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const milestoneTitle = 'Bank reconciliations complete (EOM)';

const titles = [
  'AL Accruals',
  'Awaiting Deliveries Report - required from Workshop and WA',
  'LSL Accruals',
  'Month End Payroll Journal',
  'Payroll Clearing',
  'Payroll Tax',
  'Payroll Tax Reconciliation and Payment',
  'Return to WorkSA Reconciliation and Payment',
  'Run JH Hire Listing - SAP',
  'Stock Flow Summary- from projects',
  'Super Payable',
  'WorkCover Payable',
  'Equipment Delivery - Follow up missing photos',
  'Invoice Hire Customers',
  'Clear Suspense Accounts',
  'Production Board Export',
];

async function main() {
  const ms = await prisma.task.findFirst({ where: { title: milestoneTitle } });
  if (!ms) throw new Error('Milestone task not found: ' + milestoneTitle);

  let updated = 0;
  let missing = [];

  for (const title of titles) {
    const t = await prisma.task.findFirst({ where: { title } });
    if (!t) {
      missing.push(title);
      continue;
    }
    await prisma.task.update({ where: { id: t.id }, data: { dependency: milestoneTitle } });
    updated++;
  }

  console.log('milestone', ms.id);
  console.log('updated', updated);
  if (missing.length) console.log('missing', missing);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

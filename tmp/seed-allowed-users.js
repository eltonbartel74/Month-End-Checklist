/* Seed pre-registered users for magic-code login */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const users = [
    {
      email: "elton.bartel@jamieson.com.au",
      role: "MANAGER",
      ownerNames: ["Elt", "Elton"],
    },
    {
      email: "kylie.deane@jamieson.com.au",
      role: "MANAGER",
      ownerNames: ["Kylie"],
    },
    {
      email: "donald.pierce@jamieson.com.au",
      role: "MANAGER",
      ownerNames: ["Donald"],
    },
    {
      email: "tony.george@jamieson.com.au",
      role: "STAFF",
      ownerNames: ["Tony"],
    },
    {
      email: "samantha.atkinson@jamieson.com.au",
      role: "STAFF",
      ownerNames: ["Samantha"],
    },
    {
      email: "pei.song@jamieson.com.au",
      role: "MANAGER",
      ownerNames: ["Pei"],
    },
  ];

  for (const u of users) {
    await prisma.allowedUser.upsert({
      where: { email: u.email.toLowerCase() },
      update: {
        role: u.role,
        active: true,
        ownerNames: u.ownerNames,
      },
      create: {
        email: u.email.toLowerCase(),
        role: u.role,
        active: true,
        ownerNames: u.ownerNames,
      },
    });
  }

  console.log(`Seeded/updated ${users.length} allowed users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

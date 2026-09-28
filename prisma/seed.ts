import { db } from "../src/lib/db";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error("Set SEED_ADMIN_EMAIL to seed the first admin");
  }

  await db.user.upsert({
    where: { email },
    update: { role: "ADMIN", status: "ACTIVE" },
    create: { email, role: "ADMIN", status: "ACTIVE" },
  });

  console.log(`Seeded admin: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { db } from "./src/lib/db";
async function main() {
  const updated = await db.user.update({
    where: { id: "cmu5egy4n0000vl4woqcvprel" },
    data: { email: "gemechu.bulti@coopbankoromiasc.com" },
  });
  console.log(JSON.stringify(updated, null, 2));
}
main().finally(() => db.$disconnect());

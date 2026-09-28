import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { db } from "./src/lib/db";

async function main() {
  try {
    const updated = await db.user.update({
      where: { id: "cmu5egy4n0000vl4woqcvprel" },
      data: {
        displayName: "Gemechu Bulti Firisa",
        username: "gemechubf",
        lastLoginAt: new Date(),
      },
    });
    console.log("DB update OK:", JSON.stringify(updated, null, 2));
  } catch (error) {
    console.error("DB UPDATE FAILED:", error);
  } finally {
    await db.$disconnect();
  }
}

main();

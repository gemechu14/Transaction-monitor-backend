import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { authenticateUser, LdapUnavailableError } from "./src/lib/ldap";
import { db } from "./src/lib/db";

async function main() {
  const identifier = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];
  if (!identifier || !password) {
    console.error("Usage: tsx scratch_login_probe.ts <identifier> <password>");
    process.exit(1);
  }

  try {
    console.log("1. Local gate...");
    const localUser = await db.user.findUnique({ where: { email: identifier } });
    console.log("localUser:", localUser);
    if (!localUser || localUser.status !== "ACTIVE") {
      console.log("=> would 401 (local gate)");
      return;
    }

    console.log("2. AD auth...");
    const adUser = await authenticateUser(identifier, password);
    console.log("adUser:", adUser);
    if (!adUser) {
      console.log("=> would 401 (AD auth)");
      return;
    }

    console.log("=> SUCCESS", adUser);
  } catch (error) {
    console.error("FULL ERROR:", error);
    if (error instanceof Error) {
      console.error("name:", error.name);
      console.error("message:", error.message);
      console.error("stack:", error.stack);
      console.error("cause:", (error as any).cause);
    }
    if (error instanceof LdapUnavailableError) {
      console.log("=> would 503");
    } else {
      console.log("=> would 500");
    }
  } finally {
    await db.$disconnect();
  }
}

main();

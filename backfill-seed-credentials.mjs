import "dotenv/config";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";

const DEV_PASSWORD = "asdf1234!";
const EXCLUDED_EMAILS = new Set(["ivan@zuka.id"]);

const sql = postgres(process.env.DATABASE_URL);

try {
  console.log("Hashing BetterAuth credential password for seed accounts...");
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const seedAccounts = await sql`
    select
      a.id,
      a.email,
      exists(
        select 1
        from auth_credential ac
        where ac.user_id = a.id
          and ac.provider_id = 'credential'
      ) as has_credential
    from account a
    where a.email is not null
      and a.id like 'seed-%'
  `;

  const accountsToBackfill = seedAccounts.filter(
    (account) =>
      !EXCLUDED_EMAILS.has(account.email) && !account.has_credential,
  );

  if (accountsToBackfill.length === 0) {
    console.log("No seed accounts need BetterAuth credential backfill.");
  } else {
    for (const account of accountsToBackfill) {
      await sql`
        insert into auth_credential (
          id,
          user_id,
          account_id,
          provider_id,
          password
        ) values (
          ${crypto.randomUUID()},
          ${account.id},
          ${crypto.randomUUID()},
          'credential',
          ${passwordHash}
        )
      `;

      console.log(`Backfilled credential for ${account.email}`);
    }
  }

  console.log(`Seed credential password is set to ${DEV_PASSWORD}`);
} finally {
  await sql.end();
}

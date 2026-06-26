/**
 * Apply pending SQL migrations from ./drizzle. Run on every deploy / container
 * start. Safe to run repeatedly — already-applied migrations are skipped.
 *
 *   npm run db:migrate
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations applied.");
} catch (err) {
  console.error("Migration failed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

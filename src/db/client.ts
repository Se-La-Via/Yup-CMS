import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres database.",
  );
}

// `prepare: false` keeps things compatible with Supabase's transaction pooler.
const client = postgres(url, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };

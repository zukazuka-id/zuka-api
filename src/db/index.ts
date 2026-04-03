import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

export const client = postgres(connectionString, {
  prepare: false,
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : (process.env.NODE_ENV === "production" ? 5 : 10),
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export { sql } from "drizzle-orm";

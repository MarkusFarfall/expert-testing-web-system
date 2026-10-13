import postgres from "npm:postgres@3.4.5";
import { drizzle } from "npm:drizzle-orm@0.45.2/postgres-js";
const connectionString = Deno.env.get("DB_URL");
if (!connectionString) throw new Error("DB_URL is required");
const client = postgres(connectionString, { prepare: false, max: 4 });
export const db = drizzle(client);

import postgres from "npm:postgres@3.4.5";
import { drizzle } from "npm:drizzle-orm@0.45.2/postgres-js";
const connectionString = Deno.env.get("DB_URL");
if (!connectionString) throw new Error("DB_URL is required");
// Запросы выполняем последовательно (см. store.ts): пулер Supavisor в транзакционном режиме
// не переносит параллельные запросы в одном клиенте postgres.js.
const client = postgres(connectionString, { prepare: false, max: 2, idle_timeout: 60, connect_timeout: 15, max_lifetime: 300 });
export const db = drizzle(client);

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.js";

async function runMigrations() {
  console.log("Running Drizzle migrations...");
  try {
    await migrate(db as any, { migrationsFolder: "./drizzle" });
    console.log("Migrations applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();

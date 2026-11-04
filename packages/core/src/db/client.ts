import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schemas/db.js";

const connectionString =
  process.env.DATABASE_URL || "postgresql://netrabox:netrabox_dev_password@localhost:5432/netrabox";

export const sql = postgres(connectionString, { max: 10 });
export const db = drizzle(sql, { schema });

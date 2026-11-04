import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schemas/db.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://netrabox:netrabox_dev_password@localhost:5432/netrabox",
  },
});

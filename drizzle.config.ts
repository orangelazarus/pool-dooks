import type { Config } from "drizzle-kit";

export default {
  // Games own no tables: they store everything through lib/game-sdk.
  schema: ["./lib/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;

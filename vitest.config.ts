import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["games/**/*.test.ts", "lib/**/*.test.ts"],
    env: {
      // .env.local's DATABASE_URL is production. Tests run in memory; if
      // anything ever reached for the real database, make it fail instead.
      DATABASE_URL: "postgres://tests-must-not-use-the-database.invalid:5432/none",
      NEXT_PUBLIC_SUPABASE_URL: "http://tests-must-not-use-supabase.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "none",
    },
  },
});

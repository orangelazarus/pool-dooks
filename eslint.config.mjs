import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Games are plugins: they talk to core only through the game SDK, never to
  // the database, auth or push directly. See docs/creating-a-game.md.
  // A warning while the existing games are moved onto the SDK; becomes an error after.
  {
    files: ["games/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              regex: "^@/(?!lib/game-sdk(/client)?$|components/ui/|lib/utils$)",
              message:
                "Game code may import from core only @/lib/game-sdk, @/lib/game-sdk/client, @/components/ui/* and @/lib/utils.",
            },
            {
              regex: "^(\\.\\./)+(app|components|hooks|lib|scripts)(/|$)",
              message: "Game code must not reach into core with relative paths — use @/lib/game-sdk.",
            },
            {
              regex: "^(drizzle-orm|pg|web-push|@supabase/|next/headers$)",
              message: "Game code must not use the database, auth or push directly — use the context from @/lib/game-sdk.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Model SDKs: games reach AI only through ctx.ai, which core meters.
const AI_SDKS = "^(@anthropic-ai/|openai$|@ai-sdk/|ai$|@google/genai|@google/generative-ai|@mistralai/|groq-sdk|cohere-ai|replicate$|ollama$)";

/** What code under games/ may import from core; tests may also use the harness. */
function gameImportRule(isTest) {
  const allowed = `lib/game-sdk(/client${isTest ? "|/testing" : ""})?$|components/ui/|lib/utils$`;
  return [
    "error",
    {
      patterns: [
        {
          regex: `^@/(?!${allowed})`,
          message: isTest
            ? "Game tests may import from core only @/lib/game-sdk, @/lib/game-sdk/client, @/lib/game-sdk/testing, @/components/ui/* and @/lib/utils."
            : "Game code may import from core only @/lib/game-sdk, @/lib/game-sdk/client, @/components/ui/* and @/lib/utils.",
        },
        {
          // Two or more levels up leaves games/<name>/; one level (e.g. a
          // game's own ../components) stays inside it.
          regex: "^(\\.\\./){2,}(app|components|hooks|lib|scripts)(/|$)",
          message: "Game code must not reach into core with relative paths — use @/lib/game-sdk.",
        },
        {
          regex: "^(drizzle-orm|pg|web-push|@supabase/|next/headers$)",
          message: "Game code must not use the database, auth or push directly — use the context from @/lib/game-sdk.",
        },
        { regex: AI_SDKS, message: "Games use AI only through ctx.ai — declare it in defineGame({ ai }). See docs/creating-a-game.md." },
      ],
    },
  ];
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Games are plugins: they talk to core only through the game SDK, never to
  // the database, auth or push directly. See docs/creating-a-game.md. Their
  // tests may also use the SDK's in-memory harness.
  {
    files: ["games/**/*.{ts,tsx}"],
    ignores: ["games/**/*.test.ts"],
    rules: {
      "no-restricted-imports": gameImportRule(false),
      // Secrets and outside services are core's: games get configuration and AI from the SDK.
      "no-restricted-properties": ["error", { object: "process", property: "env", message: "Games don't read the environment — ask core for what you need through the SDK." }],
      "no-restricted-globals": ["error", { name: "fetch", message: "Games call the server through @/lib/game-sdk/client, and AI through ctx.ai." }],
    },
  },
  {
    files: ["games/**/*.test.ts"],
    rules: { "no-restricted-imports": gameImportRule(true) },
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

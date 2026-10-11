// Shapes of what Pool Dooks keeps in core's game storage. Validated here, in
// code — the game owns no database tables.
import { z } from "zod";

export const THEMES = [
  "everyday_life",
  "entertainment",
  "sports",
  "sci_fi",
  "fantasy",
  "food",
  "travel",
  "custom",
] as const;

export type Theme = (typeof THEMES)[number];

export interface PoolDookToken {
  id: string;
  label: string;
  type: string;
  position: number;
  occurrence: number;
}

/** Content row: one story. Title, author and visibility are core's columns. */
export interface PoolDookContent {
  theme: string;
  /** The Tiptap document, for editing. */
  bodyJson: Record<string, unknown>;
  /** The story as text with {{token_id}} placeholders, for the reveal. */
  bodyText: string;
  tokens: PoolDookToken[];
  aiGenerated: boolean;
  extraWeird: boolean;
  importSource: string | null;
}

// A phone photo is a few MB; base64 adds a third.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

const Story = {
  title: z.string().min(1).max(200),
  theme: z.string().min(1),
  bodyJson: z.record(z.string(), z.unknown()),
  isPublic: z.boolean().optional().default(true),
};

export const CreateSchema = z.object({
  ...Story,
  aiGenerated: z.boolean().optional().default(false),
  extraWeird: z.boolean().optional().default(false),
  importSource: z.string().optional(),
});

export const UpdateSchema = z.object({ id: z.string(), ...Story });

export const IdSchema = z.object({ id: z.string() });

// Read from the query string, so everything arrives as text.
export const ListSchema = z.object({
  theme: z.string().optional(),
  search: z.string().optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const ImportSchema = z.object({
  text: z.string().max(100_000).optional(),
  json: z.unknown().optional(),
});

export const GenerateSchema = z.object({
  theme: z.string().min(1),
  extraWeird: z.boolean().optional().default(false),
  title: z.string().optional(),
});

export const EnhanceSchema = z.object({ text: z.string().min(10).max(5000) });

export const ScanSchema = z.object({
  mediaType: z.enum(IMAGE_TYPES),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4, "That image is too large"),
});

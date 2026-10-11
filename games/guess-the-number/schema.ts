// Shapes of what Guess the Number keeps in core's game storage. Validated
// here, in code — the game owns no database tables.
import { z } from "zod";

/** Content row: the range, and the number everyone is trying to guess. */
export interface NumberGameContent {
  minNumber: number;
  maxNumber: number;
  // Server-side only until the reveal: never put this in a list response or
  // in the play props.
  secretNumber: number;
}

export const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  min: z.number().int().min(0).max(999999).optional().default(1),
  max: z.number().int().min(1).max(1000000).optional().default(100),
});

// Shapes of what Farkle keeps in core's game storage. Validated here, in code —
// Farkle owns no database tables.
import { z } from "zod";
import type { Ruleset } from "./scoring";

/** Content row: the settings the host picked at creation time. */
export interface FarkleContent {
  targetScore: number;
  ruleset: Ruleset;
}

/** Session state: the live turn. */
export interface FarkleState {
  /** The roll waiting to be resolved, or null between rolls. */
  diceRolled: number[] | null;
  diceRemaining: number;
  turnScore: number;
  rollsThisTurn: number;
  // Banked totals per playerId. Also doubles as the "has this player ever
  // banked" check (scores[id] ?? 0) > 0 for the Original ruleset's one-time
  // 500-point entry threshold.
  scores: Record<string, number>;
}

/** What every action returns and broadcasts: the turn as clients should now show it. */
export interface FarkleStatePayload {
  currentPlayerId: string;
  dice: number[] | null;
  diceRemaining: number;
  turnScore: number;
  rollsThisTurn: number;
  scores: Record<string, number>;
  farkled: boolean;
  banked: boolean;
  hotDice: boolean;
  bankedAmount?: number;
}

export const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  targetScore: z.union([z.literal(2000), z.literal(3000), z.literal(5000)]),
  ruleset: z.enum(["original", "kcd"]),
});

export const KeepSchema = z.object({
  diceIndices: z.array(z.number().int().min(0)).min(1),
});

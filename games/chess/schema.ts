// Shapes of what Chess keeps in core's game storage. Validated here, in code —
// Chess owns no database tables.
import { z } from "zod";
import { TIME_CONTROLS } from "./clock";
import type { GameResult, HostColor, ResultReason } from "./engine";

const TIME_CONTROL_SECONDS = TIME_CONTROLS.map((t) => t.seconds);

/** Content row: the settings the host picked at creation time. */
export interface ChessContent {
  hostColor: HostColor;
  /** Seconds per side; null means untimed. */
  timeControlSeconds: number | null;
}

/** Session state: the live game. */
export interface ChessState {
  whitePlayerId: string;
  blackPlayerId: string;
  /** SAN move list — the source of truth the position is replayed from. */
  moves: string[];
  whiteMs: number | null;
  blackMs: number | null;
  /** Epoch ms when the side to move's clock started; null while untimed or before White's first move. */
  turnStartedAt: number | null;
  drawOfferedBy: string | null;
  result: GameResult | null;
  resultReason: ResultReason | null;
}

export const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  hostColor: z.enum(["white", "black", "random"]),
  timeControlSeconds: z
    .number()
    .int()
    .nullable()
    .refine((s) => TIME_CONTROL_SECONDS.includes(s), "Unsupported time control"),
});

const SQUARE = z.string().regex(/^[a-h][1-8]$/);
export const MoveSchema = z.object({
  from: SQUARE,
  to: SQUARE,
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});

export const DrawSchema = z.object({
  action: z.enum(["offer", "accept", "decline"]),
});

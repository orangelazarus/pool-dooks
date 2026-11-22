import { test, expect } from "vitest";
import { Chess } from "chess.js";
import { computerMove } from "./computer";

test("stockfish answers at each level", async () => {
  for (const level of ["easy", "medium", "hard"] as const) {
    const move = await computerMove(new Chess().fen(), level);
    expect(move).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
  }
  // Mate in one for White: Qh5xf7#
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
  expect(await computerMove(fen, "hard")).toBe("h5f7");
  // Checkmated side has no move.
  expect(await computerMove("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", "easy")).toBeNull();
}, 30000);

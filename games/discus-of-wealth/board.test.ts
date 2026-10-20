import { describe, expect, it } from "vitest";
import { COLUMNS, HIDDEN, ROWS, layoutBoard, maskBoard } from "./board";
import { PUZZLES } from "./puzzles";

describe("the board", () => {
  it("fits every puzzle in the bank", () => {
    const misfits = PUZZLES.filter((p) => layoutBoard(p.puzzle) === null).map((p) => p.puzzle);
    expect(misfits).toEqual([]);
  });

  it("keeps every puzzle inside its rows", () => {
    for (const { puzzle } of PUZZLES.slice(0, 500)) {
      const board = layoutBoard(puzzle)!;
      board.forEach((row, r) => {
        expect(row).toHaveLength(COLUMNS);
        const outside = [...row].filter((ch, c) => (c < ROWS[r].start || c >= ROWS[r].start + ROWS[r].width) && ch !== " ");
        expect(outside).toEqual([]);
      });
    }
  });

  it("lays out on the fewest, most even lines", () => {
    expect(layoutBoard("THE BOTTOM OF THE SWIMMING POOL")!.map((r) => r.trim())).toEqual([
      "THE BOTTOM",
      "OF THE",
      "SWIMMING POOL",
      "",
    ]);
    expect(layoutBoard("STOP")!.map((r) => r.trim())).toEqual(["", "STOP", "", ""]);
    expect(layoutBoard("A WORD THAT IS FAR TOO LONG TO EVER FIT ON THE BOARD AT ALL, REALLY")).toBeNull();
  });

  it("hides letters not yet called, and nothing else", () => {
    expect(maskBoard(["  IT'S A-OK!  "], ["A"])).toEqual([`  ${HIDDEN}${HIDDEN}'${HIDDEN} A-${HIDDEN}${HIDDEN}!  `]);
  });
});

describe("the puzzle bank", () => {
  it("has unique ids and puzzles", () => {
    expect(new Set(PUZZLES.map((p) => p.id)).size).toBe(PUZZLES.length);
    expect(new Set(PUZZLES.map((p) => p.puzzle)).size).toBe(PUZZLES.length);
  });

  it("has at least 50 puzzles in every category", () => {
    const counts = new Map<string, number>();
    for (const p of PUZZLES) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n < 50)).toEqual([]);
  });
});

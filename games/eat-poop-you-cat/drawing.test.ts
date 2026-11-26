import { describe, expect, it } from "vitest";
import { CANVAS_SIZE, MAX_DRAWING_CHARS, decodeDrawing, encodeDrawing, hasInk, simplify, strokePath, type Stroke } from "./drawing";

describe("drawing format", () => {
  it("round-trips strokes, including big jumps and taps", () => {
    const strokes: Stroke[] = [
      { color: 0, size: 1, points: [[10, 10], [12, 15], [200, 300], [199, 0]] },
      { color: 5, size: 2, points: [[CANVAS_SIZE, CANVAS_SIZE]] },
      { color: 8, size: 0, points: [[0, 0], [31, 0], [0, 31]] },
    ];
    expect(decodeDrawing(encodeDrawing(strokes))).toEqual(strokes);
  });

  it("clamps points to the canvas when encoding", () => {
    const encoded = encodeDrawing([{ color: 0, size: 0, points: [[-5, 400]] }]);
    expect(decodeDrawing(encoded)).toEqual([{ color: 0, size: 0, points: [[0, CANVAS_SIZE]] }]);
  });

  it("reads an empty drawing as no strokes", () => {
    expect(decodeDrawing("")).toEqual([]);
    expect(hasInk([])).toBe(false);
  });

  it("refuses anything that isn't a drawing", () => {
    expect(decodeDrawing("AA!!AAAA")).toBeNull(); // not the alphabet
    expect(decodeDrawing("AAAA")).toBeNull(); // too short for a point
    expect(decodeDrawing("zAAAAA")).toBeNull(); // no such colour
    expect(decodeDrawing("AA_AAA")).toBeNull(); // x past the canvas
    expect(decodeDrawing("AAAAAAA")).toBeNull(); // half a point
    expect(decodeDrawing("AAAAAA..AAAAAA")).toBeNull(); // empty stroke
    expect(decodeDrawing("AAAAAA" + "A".repeat(MAX_DRAWING_CHARS))).toBeNull(); // too long
    expect(decodeDrawing("AAAAAAAA")).toBeNull(); // delta below zero
  });

  it("only counts the eraser as no ink", () => {
    expect(hasInk([{ color: 8, size: 0, points: [[1, 1]] }])).toBe(false);
    expect(hasInk([{ color: 3, size: 0, points: [[1, 1]] }])).toBe(true);
  });

  it("drops points along a straight line", () => {
    const line = Array.from({ length: 50 }, (_, i) => [i, i * 2] as [number, number]);
    expect(simplify(line)).toEqual([line[0], line[49]]);
    const corner: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    expect(simplify(corner)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it("draws a tap as a dot", () => {
    expect(strokePath([[5, 5]])).toMatch(/^M5 5L5\.01 5$/);
  });
});

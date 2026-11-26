// Drawings are kept as compact strings so a whole game's worth fits in one
// game-state row (256 KB). Shared by the browser (encode, render) and the
// server (validate).
//
// Format: strokes joined by ".". Each stroke is
//   <color char><size char><x hi><x lo><y hi><y lo><dx><dy><dx><dy>…
// in the base64url alphabet. After the first point each coordinate is a delta:
// -31..31 is one char (value + 31); char 63 escapes to an absolute value in the
// two chars that follow.

export const CANVAS_SIZE = 320;
export const MAX_DRAWING_CHARS = 5500;
export const MAX_STROKES = 400;

/** The last one is the eraser: white paint on the white page. */
export const COLORS = ["#111827", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#92400e", "#ffffff"];
export const ERASER = COLORS.length - 1;
export const SIZES = [3, 7, 16];

export type Point = [number, number];

export interface Stroke {
  color: number;
  size: number;
  points: Point[];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Map([...ALPHABET].map((ch, i) => [ch, i]));
const ESCAPE = 63;
const MAX_DELTA = 31;

const clamp = (n: number) => Math.min(CANVAS_SIZE, Math.max(0, Math.round(n)));
const abs2 = (n: number) => ALPHABET[n >> 6] + ALPHABET[n & 63];

export function encodeDrawing(strokes: Stroke[]): string {
  return strokes
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const pts = s.points.map(([x, y]) => [clamp(x), clamp(y)] as Point);
      let out = ALPHABET[s.color] + ALPHABET[s.size] + abs2(pts[0][0]) + abs2(pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        for (const axis of [0, 1]) {
          const d = pts[i][axis] - pts[i - 1][axis];
          out += Math.abs(d) <= MAX_DELTA ? ALPHABET[d + MAX_DELTA] : ALPHABET[ESCAPE] + abs2(pts[i][axis]);
        }
      }
      return out;
    })
    .join(".");
}

/** Parses a drawing, or returns null if it isn't one. "" is an empty drawing. */
export function decodeDrawing(encoded: string): Stroke[] | null {
  if (encoded.length > MAX_DRAWING_CHARS) return null;
  if (encoded === "") return [];
  const parts = encoded.split(".");
  if (parts.length > MAX_STROKES) return null;
  const strokes: Stroke[] = [];
  for (const part of parts) {
    const v: number[] = [];
    for (const ch of part) {
      const n = VALUE.get(ch);
      if (n === undefined) return null;
      v.push(n);
    }
    if (v.length < 6) return null;
    const [color, size] = v;
    if (color >= COLORS.length || size >= SIZES.length) return null;
    let i = 2;
    const readAbs = () => {
      if (i + 2 > v.length) return null;
      const n = v[i] * 64 + v[i + 1];
      i += 2;
      return n <= CANVAS_SIZE ? n : null;
    };
    const x0 = readAbs();
    const y0 = readAbs();
    if (x0 === null || y0 === null) return null;
    const points: Point[] = [[x0, y0]];
    while (i < v.length) {
      const next: number[] = [];
      for (const axis of [0, 1]) {
        if (i >= v.length) return null;
        const c = v[i++];
        let n: number | null;
        if (c === ESCAPE) n = readAbs();
        else n = points[points.length - 1][axis] + c - MAX_DELTA;
        if (n === null || n < 0 || n > CANVAS_SIZE) return null;
        next.push(n);
      }
      points.push([next[0], next[1]]);
    }
    strokes.push({ color, size, points });
  }
  return strokes;
}

/** Ramer–Douglas–Peucker: drops points that don't change the line's shape by more than `epsilon`. */
export function simplify(points: Point[], epsilon = 0.75): Point[] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let worstDist = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const dist =
        len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (dist > worstDist) {
        worstDist = dist;
        worst = i;
      }
    }
    if (worst !== -1 && worstDist > epsilon) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A smoothed SVG path for a stroke; also usable as a canvas Path2D. */
export function strokePath(points: Point[]): string {
  if (points.length === 0) return "";
  const [x0, y0] = points[0];
  // A tap: a hair-long line, which round caps draw as a dot.
  if (points.length === 1) return `M${x0} ${y0}L${x0 + 0.01} ${y0}`;
  if (points.length === 2) return `M${x0} ${y0}L${points[1][0]} ${points[1][1]}`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d}L${lx} ${ly}`;
}

/** True if the drawing has a mark on it that isn't the eraser. */
export function hasInk(strokes: Stroke[]): boolean {
  return strokes.some((s) => s.color !== ERASER);
}

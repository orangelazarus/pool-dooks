"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CANVAS_SIZE,
  COLORS,
  ERASER,
  MAX_DRAWING_CHARS,
  SIZES,
  decodeDrawing,
  encodeDrawing,
  hasInk,
  simplify,
  strokePath,
  type Point,
  type Stroke,
} from "../drawing";

interface DrawingPadProps {
  /** Where the work in progress is kept, so closing the tab doesn't lose it. */
  draftKey: string;
  busy: boolean;
  /** Live mode: seconds left on the turn. The drawing is handed in just before time runs out. */
  secondsLeft: number | null;
  onSubmit: (drawing: string) => Promise<boolean>;
}

const AUTO_SUBMIT_SECONDS = 2;

function loadDraft(key: string): Stroke[] {
  try {
    return decodeDrawing(localStorage.getItem(key) ?? "") ?? [];
  } catch {
    return [];
  }
}

export function DrawingPad({ draftKey, busy, secondsLeft, onSubmit }: DrawingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Mounted only in the browser (see EpycBoard), so the draft can be read up front.
  const [strokes, setStrokes] = useState<Stroke[]>(() => loadDraft(draftKey));
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(1);
  const current = useRef<Stroke | null>(null);
  const autoSubmitted = useRef(false);

  const encoded = useMemo(() => encodeDrawing(strokes), [strokes]);
  const ink = encoded.length / MAX_DRAWING_CHARS;

  useEffect(() => {
    try {
      if (encoded) localStorage.setItem(draftKey, encoded);
      else localStorage.removeItem(draftKey);
    } catch {
      // Private browsing or a full quota: the draft just isn't kept.
    }
  }, [draftKey, encoded]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const scale = canvas.width / CANVAS_SIZE;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const s of current.current ? [...strokes, current.current] : strokes) {
      g.strokeStyle = COLORS[s.color];
      g.lineWidth = SIZES[s.size];
      g.stroke(new Path2D(strokePath(s.points)));
    }
  }, [strokes]);

  // Sharp on high-density screens: the backing store matches the device's pixels.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const px = Math.round(canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1));
      if (px > 0 && canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.min(CANVAS_SIZE, Math.max(0, n));
    return [
      clamp(((e.clientX - rect.left) / rect.width) * CANVAS_SIZE),
      clamp(((e.clientY - rect.top) / rect.height) * CANVAS_SIZE),
    ];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = { color, size, points: [pointAt(e)] };
    draw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke) return;
    const [x, y] = pointAt(e);
    const [lx, ly] = stroke.points[stroke.points.length - 1];
    if (Math.hypot(x - lx, y - ly) < 1) return;
    stroke.points.push([x, y]);
    draw();
  };

  const onPointerUp = () => {
    const stroke = current.current;
    current.current = null;
    if (!stroke) return;
    const points = simplify(stroke.points.map(([x, y]) => [Math.round(x), Math.round(y)] as Point));
    const next = [...strokes, { ...stroke, points }];
    if (encodeDrawing(next).length > MAX_DRAWING_CHARS) {
      toast.error("Out of ink! Undo a stroke or hand it in.");
      draw();
      return;
    }
    setStrokes(next);
  };

  const submit = useCallback(async () => {
    const ok = await onSubmit(encoded);
    if (ok) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    }
  }, [onSubmit, encoded, draftKey]);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft > AUTO_SUBMIT_SECONDS || autoSubmitted.current || busy) return;
    if (!hasInk(strokes)) return;
    autoSubmitted.current = true;
    void submit();
  }, [secondsLeft, strokes, busy, submit]);

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        className="block w-full max-w-[60vh] mx-auto aspect-square rounded-lg border bg-white touch-none cursor-crosshair select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {COLORS.slice(0, ERASER).map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${i + 1}`}
            onClick={() => setColor(i)}
            className={cn(
              "h-7 w-7 rounded-full border-2",
              color === i ? "border-primary ring-2 ring-primary/40" : "border-transparent"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <Button
          type="button"
          size="icon"
          variant={color === ERASER ? "default" : "outline"}
          className="h-7 w-7"
          aria-label="Eraser"
          onClick={() => setColor(ERASER)}
        >
          <Eraser className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        {SIZES.map((s, i) => (
          <Button
            key={s}
            type="button"
            size="icon"
            variant={size === i ? "default" : "outline"}
            className="h-8 w-8"
            aria-label={["Thin", "Medium", "Thick"][i]}
            onClick={() => setSize(i)}
          >
            <span className="rounded-full bg-current" style={{ width: s + 2, height: s + 2 }} />
          </Button>
        ))}
        <div className="flex-1" />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          aria-label="Undo"
          disabled={strokes.length === 0 || busy}
          onClick={() => setStrokes((s) => s.slice(0, -1))}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          aria-label="Clear"
          disabled={strokes.length === 0 || busy}
          onClick={() => {
            if (window.confirm("Clear the whole drawing?")) setStrokes([]);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full transition-all", ink > 0.9 ? "bg-destructive" : "bg-primary")}
              style={{ width: `${Math.min(100, ink * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">Ink used</p>
        </div>
        <Button onClick={submit} disabled={busy || !hasInk(strokes)}>
          Pass it on
        </Button>
      </div>
    </div>
  );
}

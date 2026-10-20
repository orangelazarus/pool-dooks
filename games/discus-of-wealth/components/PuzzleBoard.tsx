"use client";
import { cn } from "@/lib/utils";
import { COLUMNS, HIDDEN, ROWS } from "../board";

/** The puzzle board: pool-blue where there's no letter, white tiles for the puzzle. */
export function PuzzleBoard({ board, category }: { board: string[]; category: string }) {
  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-dooks p-1.5 sm:p-2 shadow-md">
        <div className="grid gap-0.5 sm:gap-1" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
          {board.map((row, r) =>
            [...row].map((ch, c) => {
              const onBoard = c >= ROWS[r].start && c < ROWS[r].start + ROWS[r].width;
              const tile = ch !== " ";
              return (
                <div
                  // Keyed by what it shows, so a tile turning over mounts afresh and animates.
                  key={`${r}-${c}-${ch}`}
                  className={cn(
                    "aspect-[3/4] rounded-[3px] grid place-items-center font-bold text-black leading-none",
                    "text-[clamp(0.6rem,3.6vw,1.35rem)]",
                    !onBoard && "invisible",
                    onBoard && !tile && "bg-pool/80",
                    tile && "bg-white shadow-inner",
                    tile && ch !== HIDDEN && "animate-in zoom-in-50 fade-in duration-500"
                  )}
                >
                  {tile && ch !== HIDDEN ? ch : ""}
                </div>
              );
            })
          )}
        </div>
      </div>
      <p className="text-center text-sm font-semibold uppercase tracking-widest text-dooks">{category}</p>
    </div>
  );
}

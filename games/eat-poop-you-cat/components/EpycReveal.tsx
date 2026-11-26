"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrawingView } from "./DrawingView";

type RevealEntry =
  | { kind: "text"; text: string; by: string }
  | { kind: "drawing"; drawing: string; by: string }
  | { kind: "skipped"; by: string };

interface EpycRevealProps {
  title: string;
  books: Array<{ id: string; owner: string; entries: RevealEntry[] }>;
}

export function EpycReveal({ title, books }: EpycRevealProps) {
  const [index, setIndex] = useState(0);
  const book = books[index];

  if (!book) return <p className="text-center text-muted-foreground">No books were finished.</p>;

  const real = book.entries.filter((e) => e.kind === "text");
  const first = real[0];
  const last = real[real.length - 1];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">{title}</h2>

      <div className="flex flex-wrap justify-center gap-1.5">
        {books.map((b, i) => (
          <Button key={b.id} size="sm" variant={i === index ? "default" : "outline"} onClick={() => setIndex(i)}>
            {b.owner}&apos;s book
          </Button>
        ))}
      </div>

      {first && last && first !== last && first.kind === "text" && last.kind === "text" && (
        <p className="text-center text-sm text-muted-foreground">
          From &ldquo;<span className="text-foreground font-medium">{first.text}</span>&rdquo; to &ldquo;
          <span className="text-foreground font-medium">{last.text}</span>&rdquo;
        </p>
      )}

      <ol className="max-w-md mx-auto space-y-4">
        {book.entries.map((e, i) => (
          <li key={i} className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {e.kind === "text" ? (book.entries.slice(0, i).every((x) => x.kind === "skipped") ? `${e.by} started with` : `${e.by} guessed`) : e.kind === "drawing" ? `${e.by} drew` : `${e.by} missed their turn`}
            </p>
            {e.kind === "text" && (
              <div className="border rounded-lg p-4 bg-card text-lg font-medium text-center">{e.text}</div>
            )}
            {e.kind === "drawing" && <DrawingView drawing={e.drawing} />}
          </li>
        ))}
      </ol>

      <div className="flex justify-between max-w-md mx-auto">
        <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <Button variant="outline" disabled={index === books.length - 1} onClick={() => setIndex(index + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeadline, useGameView, type DeadlineInfo } from "@/lib/game-sdk/client";
import { cn } from "@/lib/utils";
import { BONUS_CONSONANTS, BONUS_GIVEN, BONUS_SECONDS, CONSONANTS, VOWEL_COST, VOWELS } from "../board";
import type { DiscusView, Happening } from "../schema";
import { Discus, SPIN_MS } from "./Discus";
import { PuzzleBoard } from "./PuzzleBoard";

interface DiscusBoardProps {
  // Passed to every PlayComponent by core:
  shareCode: string;
  currentUserId: string; // "" for someone watching a public game
  hostId: string;
  players: Array<{ playerId: string; username: string }>;
  deadline: DeadlineInfo | null;
  // From buildPlayProps:
  title: string;
  initialView: DiscusView;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export function DiscusBoard({ shareCode, currentUserId, hostId, players, deadline, title, initialView }: DiscusBoardProps) {
  // Refreshes on the game's "changed" broadcast; actions reply with the new view.
  const { view, act, busy } = useGameView<DiscusView>("discus_of_wealth", shareCode, initialView);
  const { seconds } = useDeadline("discus_of_wealth", shareCode, deadline);

  // Hold back what a spin did until the discus stops turning.
  const [settledSpins, setSettledSpins] = useState(view.spins);
  useEffect(() => {
    if (view.spins === settledSpins) return;
    const timer = setTimeout(() => setSettledSpins(view.spins), SPIN_MS);
    return () => clearTimeout(timer);
  }, [view.spins, settledSpins]);
  const spinning = view.spins !== settledSpins;

  const name = (id: string) => players.find((p) => p.playerId === id)?.username ?? "Someone";
  const isHost = currentUserId === hostId;
  const myTurn = view.turnId === currentUserId;
  const inBonus = view.bonus !== null;
  const step = { step: view.step };

  return (
    <div className="max-w-2xl mx-auto px-2 sm:px-4 py-6 space-y-5">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>{inBonus ? "Bonus round" : `Puzzle ${view.round + 1} of ${view.totalRounds}`}</span>
          {seconds !== null && (
            <span className={cn("flex items-center gap-1 tabular-nums", seconds <= 5 && "text-destructive font-semibold")}>
              <Timer className="h-3 w-3" /> {seconds}s
            </span>
          )}
        </div>
      </div>

      <PuzzleBoard board={view.board} category={view.category} />

      <p className="text-center text-sm min-h-5" aria-live="polite">
        {spinning ? "Spinning…" : describe(view, name)}
      </p>

      {!inBonus && (
        <Discus wedges={view.wedges} landed={view.wedge} spins={view.spins} />
      )}

      <Scores view={view} name={name} currentUserId={currentUserId} />

      {!spinning && (
        <Controls key={view.step} view={view} myTurn={myTurn} busy={busy} act={act} name={name} isPlayer={players.some((p) => p.playerId === currentUserId)} />
      )}

      <UsedLetters called={view.called} />

      {/* With a turn timer running, the timer moves things along instead. */}
      {isHost && !myTurn && seconds === null && view.phase !== "solved" && view.phase !== "over" && (
        <div className="text-center">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => act("skip", step)}>
            Skip {name(view.turnId)}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One line on what just happened, or whose move it is. */
function describe(view: DiscusView, name: (id: string) => string): string {
  const last: Happening | null = view.last;
  const who = name;
  if (view.phase === "bonusPick") return `${who(view.turnId)} is choosing ${BONUS_CONSONANTS} consonants and a vowel`;
  if (view.phase === "bonusSolve" && !last) return `${who(view.turnId)} has ${BONUS_SECONDS} seconds to solve!`;
  if (!last) return `${who(view.turnId)} goes first`;

  const wedge = last.wedge !== undefined ? view.wedges[last.wedge] : null;
  switch (last.kind) {
    case "spin":
      return `${who(last.playerId)} landed on ${wedge?.kind === "cash" ? money(wedge.value) : "…"} — call a consonant`;
    case "bankrupt":
      return `${who(last.playerId)} hit Bankrupt! Over to ${who(view.turnId)}`;
    case "lose":
      return `${who(last.playerId)} lost a turn. Over to ${who(view.turnId)}`;
    case "letter": {
      if (!last.count) return `No ${last.letter}. Over to ${who(view.turnId)}`;
      const found = `${last.count === 1 ? "One" : last.count} ${last.letter}${last.count === 1 ? "" : "'s"}`;
      return last.amount && last.amount > 0 ? `${found} — ${money(last.amount)}!` : `${found}!`;
    }
    case "wrong":
      return view.phase === "bonusSolve"
        ? `"${last.guess}" — not it, keep trying!`
        : `"${last.guess}" isn't it. Over to ${who(view.turnId)}`;
    case "solved":
      return `${who(last.playerId)} solved it and banks ${money(last.amount ?? 0)}!`;
    case "timeout":
      return `${who(last.playerId)} ran out of time. Over to ${who(view.turnId)}`;
    case "skipped":
      return `${who(last.playerId)} was skipped. Over to ${who(view.turnId)}`;
    case "bonus":
      return last.amount ? `${who(last.playerId)} won the bonus: ${money(last.amount)}!` : "Not this time — the bonus is lost.";
  }
}

function Scores({ view, name, currentUserId }: { view: DiscusView; name: (id: string) => string; currentUserId: string }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {view.order.map((id) => (
        <div
          key={id}
          className={cn(
            "rounded-lg border p-2 text-center",
            id === view.turnId && view.phase !== "solved" && view.phase !== "over"
              ? "border-pool bg-pool/15"
              : "bg-muted/30"
          )}
        >
          <p className="text-sm font-medium truncate">
            {name(id)}
            {id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
          </p>
          <p className="text-lg font-bold tabular-nums">{money(view.roundMoney[id] ?? 0)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">banked {money(view.banks[id] ?? 0)}</p>
        </div>
      ))}
    </div>
  );
}

function UsedLetters({ called }: { called: string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => (
        <span
          key={l}
          className={cn(
            "w-6 h-6 grid place-items-center rounded text-xs font-semibold",
            called.includes(l) ? "bg-muted text-muted-foreground/40 line-through" : "bg-muted/40"
          )}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

interface ControlsProps {
  view: DiscusView;
  myTurn: boolean;
  isPlayer: boolean;
  busy: boolean;
  act: (action: string, input?: unknown) => Promise<boolean>;
  name: (id: string) => string;
}

/** What the viewer can do now. Keyed by step, so it resets after every move. */
function Controls({ view, myTurn, isPlayer, busy, act, name }: ControlsProps) {
  const [mode, setMode] = useState<"vowel" | "solve" | null>(null);

  // The game is over: everyone is on their way to the reveal.
  if (view.phase === "over") return null;
  if (view.phase === "solved") {
    if (!isPlayer) return null;
    return (
      <div className="text-center">
        <Button disabled={busy} onClick={() => act("next", { step: view.step })}>
          {view.round + 1 < view.totalRounds ? "Next puzzle" : "Continue"}
        </Button>
      </div>
    );
  }

  if (!myTurn) {
    return <p className="text-center text-sm text-muted-foreground">Waiting for {name(view.turnId)}…</p>;
  }

  if (view.phase === "bonusPick") return <BonusPicker busy={busy} onPick={(picks) => act("bonusPick", picks)} />;
  if (view.phase === "bonusSolve") return <SolveForm busy={busy} onSolve={(guess) => act("bonusSolve", { guess })} />;

  if (view.phase === "call") {
    return (
      <div className="space-y-2">
        <p className="text-center text-sm font-medium">Call a consonant</p>
        <LetterPad letters={CONSONANTS} called={view.called} busy={busy} onPick={(letter) => act("consonant", { letter })} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-center gap-2">
        <Button disabled={busy || !view.canSpin} onClick={() => act("spin")}>
          Spin the discus
        </Button>
        <Button
          variant={mode === "vowel" ? "default" : "outline"}
          disabled={busy || !view.canBuy}
          onClick={() => setMode(mode === "vowel" ? null : "vowel")}
        >
          Buy a vowel ({money(VOWEL_COST)})
        </Button>
        <Button variant={mode === "solve" ? "default" : "outline"} disabled={busy} onClick={() => setMode(mode === "solve" ? null : "solve")}>
          Solve
        </Button>
      </div>
      {mode === "vowel" && (
        <LetterPad letters={VOWELS} called={view.called} busy={busy} onPick={(letter) => act("vowel", { letter })} />
      )}
      {mode === "solve" && <SolveForm busy={busy} onSolve={(guess) => act("solve", { guess })} />}
    </div>
  );
}

function LetterPad({ letters, called, busy, onPick }: { letters: string[]; called: string[]; busy: boolean; onPick: (l: string) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {letters.map((l) => (
        <Button key={l} variant="outline" size="sm" className="w-9 font-bold" disabled={busy || called.includes(l)} onClick={() => onPick(l)}>
          {l}
        </Button>
      ))}
    </div>
  );
}

function SolveForm({ busy, onSolve }: { busy: boolean; onSolve: (guess: string) => void }) {
  const [guess, setGuess] = useState("");
  return (
    <form
      className="flex gap-2 max-w-md mx-auto"
      onSubmit={(e) => {
        e.preventDefault();
        if (guess.trim()) onSolve(guess.trim());
        setGuess("");
      }}
    >
      <Input
        autoFocus
        value={guess}
        onChange={(e) => setGuess(e.target.value.toUpperCase())}
        placeholder="Type the whole puzzle"
        maxLength={80}
      />
      <Button type="submit" disabled={busy || !guess.trim()}>
        Solve
      </Button>
    </form>
  );
}

function BonusPicker({ busy, onPick }: { busy: boolean; onPick: (picks: { consonants: string[]; vowel: string }) => void }) {
  const [consonants, setConsonants] = useState<string[]>([]);
  const [vowel, setVowel] = useState<string | null>(null);
  const toggle = (l: string) =>
    setConsonants((c) => (c.includes(l) ? c.filter((x) => x !== l) : c.length < BONUS_CONSONANTS ? [...c, l] : c));

  const pad = (letters: string[], chosen: (l: string) => boolean, onClick: (l: string) => void) => (
    <div className="flex flex-wrap justify-center gap-1.5">
      {letters
        .filter((l) => !BONUS_GIVEN.includes(l))
        .map((l) => (
          <Button key={l} variant={chosen(l) ? "default" : "outline"} size="sm" className="w-9 font-bold" onClick={() => onClick(l)}>
            {l}
          </Button>
        ))}
    </div>
  );

  return (
    <div className="space-y-3 text-center">
      <p className="text-sm font-medium">
        R S T L N E are on the board. Pick {BONUS_CONSONANTS} more consonants and a vowel.
      </p>
      {pad(CONSONANTS, (l) => consonants.includes(l), toggle)}
      {pad(VOWELS, (l) => vowel === l, setVowel)}
      <Button
        disabled={busy || consonants.length !== BONUS_CONSONANTS || !vowel}
        onClick={() => onPick({ consonants, vowel: vowel! })}
      >
        Reveal my letters
      </Button>
    </div>
  );
}

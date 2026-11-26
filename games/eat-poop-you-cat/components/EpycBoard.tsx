"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Clock, Dices, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pickOne, useDeadline, useGameView, type DeadlineInfo } from "@/lib/game-sdk/client";
import { cn } from "@/lib/utils";
import { MAX_TEXT, MIN_TEXT, type EpycView, type Task } from "../schema";
import { PROMPTS } from "../prompts";
import { DrawingPad } from "./DrawingPad";
import { DrawingView } from "./DrawingView";

const GAME = "eat_poop_you_cat";

// True once rendering in the browser: drafts live in localStorage, which the server doesn't have.
const subscribeNothing = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

interface EpycBoardProps {
  // Passed to every PlayComponent by core:
  shareCode: string;
  currentUserId: string; // "" for someone watching a public game
  hostId: string;
  players: Array<{ playerId: string; username: string }>;
  deadline: DeadlineInfo | null;
  // From buildPlayProps:
  title: string;
  initialView: EpycView;
}

export function EpycBoard({ shareCode, currentUserId, hostId, players, deadline, title, initialView }: EpycBoardProps) {
  const { view, act, busy } = useGameView<EpycView>(GAME, shareCode, initialView);
  const { seconds } = useDeadline(GAME, shareCode, deadline);
  const hydrated = useHydrated();

  const isPlayer = players.some((p) => p.playerId === currentUserId);
  const isHost = currentUserId === hostId;
  const name = (id: string) => players.find((p) => p.playerId === id)?.username ?? "Someone";
  const live = view.mode === "live";
  const stillGoing = view.progress.filter((p) => p.done < p.total);

  const submit = useCallback(
    (task: Task, value: { text: string } | { drawing: string }) =>
      act("submit", { bookId: task.bookId, step: task.step, ...value }),
    [act]
  );

  const skip = (playerId: string) => {
    if (window.confirm(`Skip ${name(playerId)}? Whatever is waiting for them moves on without their turn.`)) {
      void act("skip", { playerId });
    }
  };

  const task = view.task;
  const draftKey = task ? `epyc:${shareCode}:${task.bookId}:${task.step}` : "";

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      <div className="text-center space-y-1.5">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{live ? "Live" : "At your own pace"}</Badge>
          {live ? (
            <span>
              Turn {Math.min(view.round + 1, view.totalSteps)} of {view.totalSteps}
            </span>
          ) : (
            isPlayer && (
              <span>
                {view.myDone} of {view.myTotal} turns done
              </span>
            )
          )}
          {live && seconds !== null && (
            <span className={cn("flex items-center gap-1 tabular-nums", seconds <= 10 && "text-destructive font-semibold")}>
              <Clock className="h-3.5 w-3.5" />
              {seconds}s
            </span>
          )}
        </div>
      </div>

      {task && !hydrated ? (
        <div className="aspect-square rounded-lg border bg-muted animate-pulse" />
      ) : task ? (
        <div key={draftKey} className="space-y-4">
          {task.kind === "start" && (
            <>
              <p className="text-center text-sm text-muted-foreground">
                Start a book: write something for the next player to draw.
              </p>
              <TextForm
                draftKey={draftKey}
                busy={busy}
                secondsLeft={live ? seconds : null}
                placeholder="A cat running for mayor"
                suggest
                onSubmit={(text) => submit(task, { text })}
              />
            </>
          )}
          {task.kind === "draw" && (
            <>
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">Draw this:</p>
                <p className="text-xl font-semibold">{task.text}</p>
              </div>
              <DrawingPad
                draftKey={draftKey}
                busy={busy}
                secondsLeft={live ? seconds : null}
                onSubmit={(drawing) => submit(task, { drawing })}
              />
            </>
          )}
          {task.kind === "describe" && (
            <>
              <p className="text-center text-sm text-muted-foreground">What is this a drawing of?</p>
              {task.drawing !== undefined && <DrawingView drawing={task.drawing} />}
              <TextForm
                draftKey={draftKey}
                busy={busy}
                secondsLeft={live ? seconds : null}
                placeholder="Describe it in a few words"
                onSubmit={(text) => submit(task, { text })}
              />
            </>
          )}
          {view.queued > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {view.queued} more book{view.queued === 1 ? "" : "s"} waiting for you after this one
            </p>
          )}
        </div>
      ) : (
        <div className="border rounded-lg p-6 bg-card text-center space-y-2">
          <Hourglass className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="text-sm">
            {!isPlayer
              ? "Everyone is busy drawing and writing. The books are revealed at the end."
              : view.myDone >= view.myTotal
                ? "You've done all your turns! The books are revealed once everyone finishes."
                : view.waitingOn
                  ? `Waiting for ${name(view.waitingOn)} to pass you a book.`
                  : "Waiting for the next turn…"}
          </p>
          {isPlayer && !live && (
            <p className="text-xs text-muted-foreground">You can close this page. We&apos;ll let you know when it&apos;s your turn.</p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold">Players</h2>
        <ul className="divide-y border rounded-lg">
          {view.progress.map((p) => (
            <li key={p.playerId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className={cn("flex-1 truncate", p.playerId === currentUserId && "font-semibold")}>{name(p.playerId)}</span>
              {p.done >= p.total ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <>
                  {p.ready > 0 && <Badge variant="secondary">{live ? "working" : `${p.ready} waiting`}</Badge>}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.done}/{p.total}
                  </span>
                  {isHost && !live && p.ready > 0 && p.playerId !== currentUserId && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => skip(p.playerId)}>
                      Skip
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {stillGoing.length === 0 && <p className="text-xs text-muted-foreground">Wrapping up…</p>}
      </div>
    </div>
  );
}

interface TextFormProps {
  draftKey: string;
  busy: boolean;
  secondsLeft: number | null;
  placeholder: string;
  /** Offer a random phrase to start from. */
  suggest?: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}

const AUTO_SUBMIT_SECONDS = 2;

function TextForm({ draftKey, busy, secondsLeft, placeholder, suggest, onSubmit }: TextFormProps) {
  // Mounted only in the browser, so the draft can be read up front.
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const autoSubmitted = useRef(false);

  const change = (value: string) => {
    setText(value);
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch {}
  };

  const ok = text.trim().length >= MIN_TEXT;

  const submit = useCallback(async () => {
    if (await onSubmit(text)) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    }
  }, [onSubmit, text, draftKey]);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft > AUTO_SUBMIT_SECONDS || autoSubmitted.current || busy || !ok) return;
    autoSubmitted.current = true;
    void submit();
  }, [secondsLeft, busy, ok, submit]);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          value={text}
          maxLength={MAX_TEXT}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => change(e.target.value)}
        />
        {suggest && (
          <Button type="button" size="icon" variant="outline" aria-label="Suggest one" onClick={() => change(pickOne(PROMPTS))}>
            <Dices className="h-4 w-4" />
          </Button>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={busy || !ok}>
        Pass it on
      </Button>
    </form>
  );
}

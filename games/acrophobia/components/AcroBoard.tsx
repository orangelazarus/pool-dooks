"use client";
import { useState } from "react";
import { Check, Crown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useGameView } from "@/lib/game-sdk/client";
import { initials, misfit } from "../acronym";
import type { AcroView } from "../schema";

interface AcroBoardProps {
  // Passed to every PlayComponent by core:
  shareCode: string;
  currentUserId: string; // "" for someone watching a public game
  hostId: string;
  players: Array<{ playerId: string; username: string }>;
  // From buildPlayProps:
  title: string;
  initialView: AcroView;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function AcroBoard({ shareCode, currentUserId, hostId, players, title, initialView }: AcroBoardProps) {
  // Refreshes on the game's "changed" broadcast; actions reply with the new view.
  const { view, act, busy } = useGameView<AcroView>("acrophobia", shareCode, initialView);

  const isPlayer = players.some((p) => p.playerId === currentUserId);
  const isHost = currentUserId === hostId;
  const expected = view.expectedIds.includes(currentUserId);
  const faceoff = view.stage === "faceoff";
  const step = { round: view.round, phase: view.phase };
  const name = (id: string) => players.find((p) => p.playerId === id)?.username ?? "Someone";
  const waitingOn = players.filter((p) => view.expectedIds.includes(p.playerId) && !view.actedIds.includes(p.playerId));
  const lastFaceoff = faceoff && view.stageRound + 1 >= view.faceoffRounds;

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          {faceoff ? (
            <Badge>
              Face-off {view.stageRound + 1} of {view.faceoffRounds}
            </Badge>
          ) : (
            <span>
              Round {view.round + 1} · first to {view.target} goes to the face-off
            </span>
          )}
        </div>
      </div>

      {faceoff && view.finalists && (
        <p className="text-center text-sm">
          <span className="font-semibold">{view.finalists.map(name).join(" vs ")}</span>
          <span className="text-muted-foreground"> — everyone else votes</span>
        </p>
      )}

      {view.phase === "choosing" ? (
        <div className="border rounded-lg p-5 bg-card text-center space-y-1">
          <p className="text-sm text-muted-foreground">Round winner</p>
          <p className="text-lg font-semibold">{name(view.chooserId ?? "")} is picking the category</p>
        </div>
      ) : (
        <div className="border rounded-lg p-5 bg-card text-center space-y-3">
          {view.category && (
            <Badge variant="outline" className="text-xs">
              {view.category}
            </Badge>
          )}
          <div className="flex justify-center gap-2 font-mono text-4xl font-bold tracking-widest text-primary">
            {view.acronym.split("").map((letter, i) => (
              <span key={i}>{letter}</span>
            ))}
          </div>
        </div>
      )}

      {view.phase === "choosing" && view.chooserId === currentUserId && (
        <CategoryPicker key={view.round} offered={view.offered} busy={busy} onPick={(category) => act("choose", { category })} />
      )}

      {view.phase === "writing" &&
        (expected && !view.myAnswer ? (
          <AnswerForm key={view.round} acronym={view.acronym} busy={busy} onSubmit={(text) => act("answer", { text })} />
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {view.myAnswer ? (
              <>
                Your answer: <span className="font-semibold text-foreground">{view.myAnswer}</span>
              </>
            ) : faceoff ? (
              "The finalists are writing…"
            ) : (
              "Everyone is writing…"
            )}
          </p>
        ))}

      {view.phase === "voting" && view.entries && (
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            {!expected
              ? faceoff && isPlayer
                ? "Everyone else is voting…"
                : "Everyone is voting…"
              : view.myVote
                ? "Locked in."
                : "Vote for your favourite"}
          </p>
          {view.entries.map((entry) => (
            <Button
              key={entry.id}
              variant={view.myVote === entry.id ? "default" : "outline"}
              className="w-full h-auto min-h-10 whitespace-normal py-2"
              disabled={!expected || busy || !!view.myVote || entry.mine}
              onClick={() => act("vote", { entryId: entry.id })}
            >
              {entry.text}
              {entry.mine && <span className="ml-2 text-xs font-normal opacity-70">(yours)</span>}
            </Button>
          ))}
        </div>
      )}

      {view.phase === "results" && view.results && (
        <div className="space-y-2">
          {view.results.entries.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">Nobody answered this one.</p>
          )}
          {[...view.results.entries]
            .sort((a, b) => b.voterIds.length - a.voterIds.length || a.at - b.at)
            .map((entry) => {
              const won = entry.id === view.results!.winnerEntryId;
              return (
                <div
                  key={entry.id}
                  className={`border rounded-lg p-3 space-y-1 ${won ? "bg-primary/15 border-primary/60" : "bg-muted/30"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm">{entry.text}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {won && <Crown className="h-4 w-4 text-primary" />}
                      {entry.id === view.results!.fastestEntryId && <Zap className="h-4 w-4 text-primary" />}
                      <Badge variant={won ? "default" : "secondary"} className="text-xs">
                        {entry.voterIds.length} vote{entry.voterIds.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {name(entry.authorId)} · {seconds(entry.at)}
                    {entry.voterIds.length > 0 && ` · liked by ${entry.voterIds.map(name).join(", ")}`}
                  </p>
                </div>
              );
            })}
          {!faceoff && (
            <p className="text-center text-xs text-muted-foreground">
              <Crown className="inline h-3 w-3" /> winner +{view.acronym.length} · <Zap className="inline h-3 w-3" />{" "}
              fastest with a vote +2 · voting for the winner +1 · no vote, no points
            </p>
          )}
          {isPlayer && (
            <Button className="w-full" disabled={busy} onClick={() => act("next", step)}>
              {lastFaceoff ? "See who won" : "Next round"}
            </Button>
          )}
        </div>
      )}

      <div className="border rounded-lg p-3 space-y-2">
        {faceoff && (
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Face-off votes · main game score</p>
        )}
        {players.map((p) => {
          const gained = view.results?.gained[p.playerId];
          const finalist = view.finalists?.includes(p.playerId);
          return (
            <div key={p.playerId} className={`flex items-center gap-3 ${faceoff && !finalist ? "opacity-60" : ""}`}>
              <span className="text-sm font-medium flex-1">
                {p.username}
                {p.playerId === currentUserId && <span className="text-xs text-muted-foreground"> (you)</span>}
              </span>
              {view.actedIds.includes(p.playerId) && <Check className="h-4 w-4 text-primary" />}
              {gained ? <span className="text-xs text-primary font-semibold">+{gained}</span> : null}
              {faceoff && finalist && (
                <span className="font-mono text-sm font-semibold text-primary">{view.faceoffScores[p.playerId] ?? 0}</span>
              )}
              <span className={`font-mono text-sm ${faceoff ? "text-muted-foreground" : "font-semibold"}`}>
                {view.scores[p.playerId] ?? 0}
              </span>
            </div>
          );
        })}
      </div>

      {view.phase !== "results" && waitingOn.length > 0 && (
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">Waiting for {waitingOn.map((p) => p.username).join(", ")}</p>
          {isHost && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act("skip", step)}>
              {view.phase === "choosing" ? "Pick a random category" : "Stop waiting and move on"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryPicker({ offered, busy, onPick }: { offered: string[]; busy: boolean; onPick: (category: string) => void }) {
  const [own, setOwn] = useState("");
  const ready = own.trim().length > 0 && !busy;
  return (
    <div className="space-y-3">
      <p className="text-center text-sm font-medium">You won the round — pick the next category</p>
      <div className="grid grid-cols-2 gap-2">
        {offered.map((category) => (
          <Button
            key={category}
            variant="outline"
            className="h-auto min-h-10 whitespace-normal py-2"
            disabled={busy}
            onClick={() => onPick(category)}
          >
            {category}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onPick(own);
        }}
      >
        <Input value={own} onChange={(e) => setOwn(e.target.value)} maxLength={40} placeholder="Or make one up" />
        <Button type="submit" disabled={!ready}>
          Use
        </Button>
      </form>
    </div>
  );
}

function AnswerForm({ acronym, busy, onSubmit }: { acronym: string; busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const typed = initials(text);
  const problem = misfit(acronym, text);
  const ready = !problem && !busy;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(text);
      }}
    >
      <div className="flex justify-center gap-1">
        {acronym.split("").map((letter, i) => (
          <span
            key={i}
            className={`w-7 h-7 flex items-center justify-center rounded font-mono text-sm font-bold border ${
              typed[i] === undefined
                ? "text-muted-foreground"
                : typed[i] === letter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-destructive/20 border-destructive text-destructive"
            }`}
          >
            {letter}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={150}
          placeholder={`${acronym.length} words, starting ${acronym.split("").join(", ")}`}
          autoFocus
        />
        <Button type="submit" disabled={!ready}>
          Submit
        </Button>
      </div>
      {text.trim() && problem && <p className="text-center text-xs text-muted-foreground">{problem}</p>}
    </form>
  );
}

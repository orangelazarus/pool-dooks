"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Square } from "chess.js";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { formatClock, remainingMs, timeControlLabel, type Side } from "../clock";
import { describeResult, otherSide, replay, sideToMove, type ChessStatePayload } from "../engine";
import { BoardGrid, MoveList, PieceGlyph } from "./BoardGrid";

interface ChessBoardProps {
  shareCode: string;
  currentUserId: string;
  players: Array<{ playerId: string; username: string; avatarUrl?: string | null }>;
  title: string;
  timeControlSeconds: number | null;
  initialState: ChessStatePayload;
}

// The server's state plus how far this device's clock is from the server's,
// measured when the state arrived.
interface Synced {
  game: ChessStatePayload;
  skew: number;
}

const sync = (game: ChessStatePayload): Synced => ({ game, skew: game.serverNow - Date.now() });

const PROMOTION_PIECES = ["q", "r", "b", "n"] as const;

export function ChessBoard({
  shareCode,
  currentUserId,
  players,
  title,
  timeControlSeconds,
  initialState,
}: ChessBoardProps) {
  const router = useRouter();
  const [{ game, skew }, setSynced] = useState<Synced>(() => sync(initialState));
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The move count we last reported an expired clock for, so each client
  // flags a given position at most once.
  const flaggedAtRef = useRef<number | null>(null);

  const applyState = (next: ChessStatePayload) => {
    setSynced(sync(next));
    setSelected(null);
    setPromotion(null);
  };

  useSession(shareCode, (event) => {
    if (event.type === "chess:state") {
      // Another client's action — reflect it live for every open browser.
      applyState(event.payload as ChessStatePayload);
    }
    if (event.type === "session:completed" || event.type === "session:revealed") {
      router.push(`/sessions/${shareCode}/reveal`);
    }
  });

  // Phones drop the realtime connection in the background, so catch up on
  // whatever was missed when the tab comes back.
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/games/chess/${shareCode}/state`);
        if (!res.ok) return;
        const next: ChessStatePayload = await res.json();
        if (next.result) router.push(`/sessions/${shareCode}/reveal`);
        else applyState(next);
      } catch {
        // Offline — the next visibility change or broadcast will catch up.
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [shareCode, router]);

  const chess = useMemo(() => replay(game.moves), [game.moves]);
  const toMove = sideToMove(chess);
  const mySide: Side | null =
    game.whitePlayerId === currentUserId ? "white" : game.blackPlayerId === currentUserId ? "black" : null;
  const orientation: Side = mySide ?? "white";
  const isMyTurn = mySide === toMove && !game.result;
  const clockRunning = game.turnStartedAt !== null && !game.result;

  useEffect(() => {
    if (!clockRunning) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [clockRunning]);

  const timeLeft = (side: Side) => remainingMs(game, side, toMove, now + skew);
  const runningTimeLeft = clockRunning ? timeLeft(toMove) : null;

  async function call(action: "move" | "resign" | "draw" | "flag", body?: unknown, quiet = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/games/chess/${shareCode}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        // Some rejections carry the authoritative state (e.g. your clock ran out).
        if (data.state) applyState(data.state);
        throw new Error(typeof data.error === "string" ? data.error : "Something went wrong");
      }
      applyState(data as ChessStatePayload);
      return data as ChessStatePayload;
    } catch (e) {
      if (!quiet) toast.error(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // When the running clock hits zero, ask the server to confirm and end the game.
  useEffect(() => {
    if (runningTimeLeft !== 0 || !mySide) return;
    if (flaggedAtRef.current === game.moves.length) return;
    flaggedAtRef.current = game.moves.length;
    call("flag", undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTimeLeft, mySide, game.moves.length]);

  const legalMoves = useMemo(
    () => (selected ? chess.moves({ square: selected, verbose: true }) : []),
    [chess, selected]
  );
  const targets = useMemo(() => new Set<string>(legalMoves.map((m) => m.to)), [legalMoves]);

  const history = useMemo(() => chess.history({ verbose: true }), [chess]);
  const last = history[history.length - 1];
  const lastMove = last ? { from: last.from, to: last.to } : null;
  const checkSquare = chess.isCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] : null;

  const handleSquareClick = (square: Square) => {
    if (!isMyTurn || busy) return;
    if (selected && targets.has(square)) {
      if (legalMoves.some((m) => m.to === square && m.isPromotion())) {
        setPromotion({ from: selected, to: square });
      } else {
        call("move", { from: selected, to: square });
      }
      return;
    }
    const piece = chess.get(square);
    setSelected(piece && piece.color === chess.turn() && square !== selected ? square : null);
  };

  const names = {
    white: players.find((p) => p.playerId === game.whitePlayerId)?.username ?? "White",
    black: players.find((p) => p.playerId === game.blackPlayerId)?.username ?? "Black",
  };
  const opponentOffered = !!game.drawOfferedBy && game.drawOfferedBy !== currentUserId;
  const iOffered = game.drawOfferedBy === currentUserId;

  const playerRow = (side: Side) => {
    const id = side === "white" ? game.whitePlayerId : game.blackPlayerId;
    const ms = timeLeft(side);
    const active = toMove === side && !game.result;
    return (
      <div className="flex items-center gap-3" data-player-side={side}>
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-xs">{names[side][0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium flex-1">
          {names[side]}
          {id === currentUserId && <span className="text-xs text-muted-foreground"> (you)</span>}
          <span className="text-xs text-muted-foreground"> · {side}</span>
        </span>
        {active && <Badge className="text-xs">to move</Badge>}
        {ms !== null && (
          <span
            data-clock={side}
            className={`font-mono text-sm font-semibold tabular-nums rounded px-2 py-0.5 ${
              active ? "bg-foreground text-background" : "bg-muted"
            } ${ms < 30_000 ? "text-destructive" : ""}`}
          >
            {formatClock(ms)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{timeControlLabel(timeControlSeconds)}</Badge>
          {timeControlSeconds !== null && game.moves.length === 0 && <span>Clocks start after White&apos;s first move</span>}
        </div>
      </div>

      {playerRow(otherSide(orientation))}

      <div className="relative">
        <BoardGrid
          chess={chess}
          orientation={orientation}
          selected={selected}
          targets={targets}
          lastMove={lastMove}
          checkSquare={checkSquare}
          disabled={!isMyTurn || busy}
          onSquareClick={handleSquareClick}
        />
        {promotion && mySide && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-md">
            <div className="bg-card border rounded-lg p-3 space-y-2 text-center">
              <p className="text-sm font-medium">Promote to</p>
              <div className="flex gap-2">
                {PROMOTION_PIECES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    data-promotion={type}
                    disabled={busy}
                    onClick={() => call("move", { ...promotion, promotion: type })}
                    className="h-12 w-12 rounded-md text-4xl flex items-center justify-center"
                    style={{ background: "#b58863" }}
                  >
                    <PieceGlyph type={type} color={mySide === "white" ? "w" : "b"} />
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPromotion(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {playerRow(orientation)}

      <p className="text-center text-sm text-muted-foreground" data-status>
        {game.result && game.resultReason
          ? describeResult(game.result, game.resultReason, names)
          : chess.isCheck()
            ? isMyTurn
              ? "You're in check"
              : `${names[toMove]} is in check`
            : isMyTurn
              ? "Your move"
              : `Waiting for ${names[toMove]}…`}
      </p>

      {opponentOffered && !game.result && (
        <div className="border rounded-lg p-3 flex items-center gap-2" data-draw-offer>
          <span className="text-sm flex-1">{names[otherSide(mySide ?? "white")]} offered a draw</span>
          <Button size="sm" disabled={busy} onClick={() => call("draw", { action: "accept" })}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => call("draw", { action: "decline" })}>
            Decline
          </Button>
        </div>
      )}

      <MoveList moves={game.moves} />

      {mySide && !game.result && (
        <div className="flex gap-2">
          <Button
            className="flex-1"
            variant="outline"
            disabled={busy || iOffered || opponentOffered}
            onClick={() => call("draw", { action: "offer" })}
          >
            {iOffered ? "Draw offered" : "Offer draw"}
          </Button>
          {confirmResign ? (
            <>
              <Button className="flex-1" variant="destructive" disabled={busy} onClick={() => call("resign")}>
                Confirm resign
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmResign(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button className="flex-1" variant="outline" disabled={busy} onClick={() => setConfirmResign(true)}>
              Resign
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

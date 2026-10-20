// The game's rules as pure functions over its state. Server-side only: this
// imports the puzzle bank. Each refuses a move by throwing a GameError.
import { GameError, shuffle } from "@/lib/game-sdk";
import { PUZZLES, type Puzzle } from "./puzzles";
import {
  BONUS_CONSONANTS,
  BONUS_GIVEN,
  BONUS_PRIZE,
  CONSONANTS,
  MIN_ROUND_WIN,
  VOWEL_COST,
  VOWELS,
  layoutBoard,
  maskBoard,
  wedgesFor,
} from "./board";
import type { DiscusState, DiscusView, Happening } from "./schema";

const BY_ID = new Map(PUZZLES.map((p) => [p.id, p]));

export function getPuzzle(id: string): Puzzle {
  const puzzle = BY_ID.get(id);
  if (!puzzle) throw new Error(`Unknown puzzle: ${id}`);
  return puzzle;
}

// Bonus puzzles are short, as on the show.
const BONUS_MAX_WORDS = 3;
const BONUS_MAX_LETTERS = 16;
const lettersOf = (text: string) => text.toUpperCase().replace(/[^A-Z]/g, "");

/**
 * Picks the game's puzzles: `rounds` for the main game, no category twice in a
 * row, and a short one for the bonus round.
 */
export function pickPuzzles(rounds: number): { puzzleIds: string[]; bonusPuzzleId: string } {
  const picked: Puzzle[] = [];
  for (const puzzle of shuffle(PUZZLES)) {
    if (picked.length === rounds) break;
    if (puzzle.category !== picked.at(-1)?.category) picked.push(puzzle);
  }
  const bonus = shuffle(PUZZLES).find(
    (p) =>
      !picked.includes(p) &&
      p.puzzle.split(" ").length <= BONUS_MAX_WORDS &&
      lettersOf(p.puzzle).length <= BONUS_MAX_LETTERS
  )!;
  return { puzzleIds: picked.map((p) => p.id), bonusPuzzleId: bonus.id };
}

export function freshState(playerIds: string[], puzzles: { puzzleIds: string[]; bonusPuzzleId: string }): DiscusState {
  return {
    ...puzzles,
    order: playerIds,
    round: 0,
    phase: "turn",
    step: 0,
    turnId: playerIds[0],
    called: [],
    wedge: null,
    spins: 0,
    roundMoney: {},
    banks: {},
    last: null,
    history: [],
    bonus: null,
  };
}

/** The puzzle being played: the round's, or the bonus one once the bonus round has begun. */
export function currentPuzzle(state: DiscusState): Puzzle {
  return getPuzzle(state.bonus ? state.bonusPuzzleId! : state.puzzleIds[state.round]);
}

const remaining = (state: DiscusState, letters: string[]) => {
  const inPuzzle = new Set(lettersOf(currentPuzzle(state).puzzle));
  return letters.filter((l) => inPuzzle.has(l) && !state.called.includes(l));
};
const countOf = (state: DiscusState, letter: string) =>
  [...currentPuzzle(state).puzzle].filter((ch) => ch === letter).length;

function mustBeTurn(state: DiscusState, playerId: string, phase: DiscusState["phase"] = "turn") {
  if (state.turnId !== playerId) throw new GameError(400, "It's not your turn");
  if (state.phase !== phase) {
    throw new GameError(400, phase === "call" ? "Spin the discus first" : "You can't do that right now");
  }
}

/** Play passes to the next player in the order. */
export function passTurn(state: DiscusState, last: Happening): DiscusState {
  const at = state.order.indexOf(state.turnId);
  return { ...state, phase: "turn", turnId: state.order[(at + 1) % state.order.length], last };
}

// ── The main game ───────────────────────────────────────────────────────────

/** `wedge` is chosen by the caller, outside any retry, so a retried write lands on the same one. */
export function spin(state: DiscusState, playerId: string, wedge: number): DiscusState {
  mustBeTurn(state, playerId);
  if (remaining(state, CONSONANTS).length === 0) throw new GameError(400, "Only vowels remain — buy one or solve");

  const landed = wedgesFor(state.round, state.puzzleIds.length)[wedge];
  const spun = { ...state, spins: state.spins + 1 };
  if (landed.kind === "bankrupt") {
    return passTurn(
      { ...spun, roundMoney: { ...state.roundMoney, [playerId]: 0 } },
      { kind: "bankrupt", playerId, wedge }
    );
  }
  if (landed.kind === "lose") return passTurn(spun, { kind: "lose", playerId, wedge });
  return { ...spun, phase: "call", wedge, last: { kind: "spin", playerId, wedge } };
}

export function callConsonant(state: DiscusState, playerId: string, letter: string): DiscusState {
  mustBeTurn(state, playerId, "call");
  if (!CONSONANTS.includes(letter)) throw new GameError(400, "Call a consonant");
  if (state.called.includes(letter)) throw new GameError(400, `${letter} has already been called`);

  const landed = wedgesFor(state.round, state.puzzleIds.length)[state.wedge!];
  const value = landed.kind === "cash" ? landed.value : 0;
  const count = countOf(state, letter);
  const called = [...state.called, letter];
  const last: Happening = { kind: "letter", playerId, letter, count, amount: value * count };
  if (count === 0) return passTurn({ ...state, called }, last);

  const roundMoney = { ...state.roundMoney, [playerId]: (state.roundMoney[playerId] ?? 0) + value * count };
  return { ...state, phase: "turn", called, roundMoney, last };
}

export function buyVowel(state: DiscusState, playerId: string, letter: string): DiscusState {
  mustBeTurn(state, playerId);
  if (!VOWELS.includes(letter)) throw new GameError(400, "That isn't a vowel");
  if (state.called.includes(letter)) throw new GameError(400, `${letter} has already been called`);
  if ((state.roundMoney[playerId] ?? 0) < VOWEL_COST) {
    throw new GameError(400, `A vowel costs $${VOWEL_COST} of this round's money`);
  }
  if (remaining(state, VOWELS).length === 0) throw new GameError(400, "There are no vowels left to buy");

  const count = countOf(state, letter);
  const called = [...state.called, letter];
  const roundMoney = { ...state.roundMoney, [playerId]: state.roundMoney[playerId] - VOWEL_COST };
  const last: Happening = { kind: "letter", playerId, letter, count, amount: -VOWEL_COST };
  const bought = { ...state, called, roundMoney, last };
  return count === 0 ? passTurn(bought, last) : bought;
}

export const isSolution = (puzzle: Puzzle, guess: string) => lettersOf(guess) === lettersOf(puzzle.puzzle);

export function solve(state: DiscusState, playerId: string, guess: string): DiscusState {
  mustBeTurn(state, playerId);
  if (!isSolution(currentPuzzle(state), guess)) return passTurn(state, { kind: "wrong", playerId, guess });

  const won = Math.max(state.roundMoney[playerId] ?? 0, MIN_ROUND_WIN);
  return {
    ...state,
    phase: "solved",
    banks: { ...state.banks, [playerId]: (state.banks[playerId] ?? 0) + won },
    history: [...state.history, { puzzleId: state.puzzleIds[state.round], winnerId: playerId, won }],
    last: { kind: "solved", playerId, amount: won },
  };
}

export const isLastRound = (state: DiscusState) => state.round >= state.puzzleIds.length - 1;

/** From the solved board: the next round, which the next player in the rotation opens. */
export function nextRound(state: DiscusState): DiscusState {
  const round = state.round + 1;
  return {
    ...state,
    round,
    phase: "turn",
    turnId: state.order[round % state.order.length],
    called: [],
    roundMoney: {},
    last: null,
  };
}

// ── The bonus round ─────────────────────────────────────────────────────────

/** The leader plays it; on a tie, whoever sits first. */
export function startBonus(state: DiscusState): DiscusState {
  const playerId = state.order.reduce((best, id) => ((state.banks[id] ?? 0) > (state.banks[best] ?? 0) ? id : best));
  return {
    ...state,
    phase: "bonusPick",
    turnId: playerId,
    called: BONUS_GIVEN,
    last: null,
    bonus: { playerId, picks: [], guesses: [], won: null },
  };
}

export function bonusPick(state: DiscusState, playerId: string, consonants: string[], vowel: string): DiscusState {
  mustBeTurn(state, playerId, "bonusPick");
  const picks = [...consonants, vowel];
  if (new Set(consonants).size !== BONUS_CONSONANTS || !consonants.every((c) => CONSONANTS.includes(c))) {
    throw new GameError(400, `Pick ${BONUS_CONSONANTS} different consonants`);
  }
  if (!VOWELS.includes(vowel)) throw new GameError(400, "Pick a vowel");
  if (picks.some((l) => BONUS_GIVEN.includes(l))) throw new GameError(400, "R, S, T, L, N and E are already showing");

  return { ...state, phase: "bonusSolve", called: [...BONUS_GIVEN, ...picks], bonus: { ...state.bonus!, picks } };
}

export function bonusSolve(state: DiscusState, playerId: string, guess: string): DiscusState {
  mustBeTurn(state, playerId, "bonusSolve");
  const bonus = { ...state.bonus!, guesses: [...state.bonus!.guesses, guess] };
  if (!isSolution(currentPuzzle(state), guess)) {
    return { ...state, bonus, last: { kind: "wrong", playerId, guess } };
  }
  return endBonus({ ...state, bonus }, true);
}

export function endBonus(state: DiscusState, won: boolean): DiscusState {
  const playerId = state.bonus!.playerId;
  const banks = won ? { ...state.banks, [playerId]: (state.banks[playerId] ?? 0) + BONUS_PRIZE } : state.banks;
  return {
    ...state,
    phase: "over",
    banks,
    bonus: { ...state.bonus!, won },
    last: { kind: "bonus", playerId, amount: won ? BONUS_PRIZE : 0 },
  };
}

// ── Players leaving ─────────────────────────────────────────────────────────

/** Takes a player out of the order, passing the turn on first if it was theirs. */
export function withoutPlayer(state: DiscusState, playerId: string): DiscusState {
  let next = state;
  if (state.turnId === playerId && (state.phase === "turn" || state.phase === "call")) {
    next = passTurn(state, { kind: "skipped", playerId });
  }
  return { ...next, order: next.order.filter((id) => id !== playerId) };
}

// ── What a browser sees ─────────────────────────────────────────────────────

/** The puzzle shows in full once it is solved, or once the game is over. */
const revealed = (state: DiscusState) => state.phase === "solved" || state.phase === "over";

/**
 * Everything one browser is told. The single place state becomes something
 * sent to a client, so it is the single place a puzzle could leak.
 */
export function viewFor(state: DiscusState, viewerId: string | null): DiscusView {
  const puzzle = currentPuzzle(state);
  const board = layoutBoard(puzzle.puzzle)!;
  const me = viewerId ?? "";
  const myTurn = state.turnId === me && state.phase === "turn";

  return {
    round: state.round,
    totalRounds: state.puzzleIds.length,
    phase: state.phase,
    step: state.step,
    category: puzzle.category,
    board: revealed(state) ? board : maskBoard(board, state.called),
    called: state.called,
    order: state.order,
    turnId: state.turnId,
    wedges: wedgesFor(state.round, state.puzzleIds.length),
    wedge: state.wedge,
    spins: state.spins,
    roundMoney: state.roundMoney,
    banks: state.banks,
    last: state.last,
    canSpin: myTurn && remaining(state, CONSONANTS).length > 0,
    canBuy: myTurn && remaining(state, VOWELS).length > 0 && (state.roundMoney[me] ?? 0) >= VOWEL_COST,
    bonus: state.bonus && { ...state.bonus, prize: BONUS_PRIZE },
  };
}

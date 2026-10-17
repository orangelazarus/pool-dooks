// The game's rules as pure functions over its state (apart from the dice:
// acronyms, categories and shuffles are random).
import { pickOne, pickSome, shuffle } from "@/lib/game-sdk";
import { CATEGORIES } from "./categories";
import type { AcroContent, AcroState, AcroView, Entry, RoundRecord } from "./schema";

// Points, as in the IRC versions of Acrophobia.
const VOTE_POINTS = 1;
const SPEED_POINTS = 2;
const PICKED_WINNER_POINTS = 1;
// The round's winner also gets a point per letter.

/** How many categories the last round's winner chooses between. */
const OFFERED = 4;

// Roughly how often English words start with each letter. Q, X and Z are left out.
const LETTER_WEIGHTS: Record<string, number> = {
  S: 11, C: 9, P: 8, A: 6, B: 6, D: 6, M: 6, T: 6, F: 5, H: 5, R: 5, E: 4, G: 4, L: 4, W: 4,
  I: 3, N: 3, O: 3, U: 2, V: 2, J: 1, K: 1, Y: 1,
};
const LETTERS = Object.entries(LETTER_WEIGHTS).flatMap(([letter, weight]) => Array(weight).fill(letter) as string[]);

export function makeAcronym(length: number): string {
  let out = "";
  while (out.length < length) {
    const letter = pickOne(LETTERS);
    if (letter !== out[out.length - 1]) out += letter;
  }
  return out;
}

/** Main rounds go 3, 4, 5, 6, 7 letters and around again; the face-off goes 3, 4, 5. */
export function acronymLength(state: Pick<AcroState, "stage" | "stageRound">): number {
  return state.stage === "main" ? 3 + (state.stageRound % 5) : 3 + (state.stageRound % 3);
}

export function anyCategory(): string {
  return pickOne(CATEGORIES);
}

const randomCategory = (content: AcroContent) => (content.categories === "off" ? null : anyCategory());

/** A new round's writing phase, with a fresh acronym. */
function startWriting(state: AcroState, category: string | null): AcroState {
  return {
    ...state,
    phase: "writing",
    acronym: makeAcronym(acronymLength(state)),
    category,
    offered: [],
    chooserId: null,
    openedAt: Date.now(),
    answers: {},
    entries: [],
    votes: {},
  };
}

export function freshState(content: AcroContent): AcroState {
  const blank: AcroState = {
    stage: "main",
    round: 0,
    stageRound: 0,
    phase: "writing",
    acronym: "",
    category: null,
    offered: [],
    chooserId: null,
    openedAt: 0,
    answers: {},
    entries: [],
    votes: {},
    scores: {},
    wins: {},
    finalists: null,
    faceoffScores: {},
    history: [],
  };
  return startWriting(blank, randomCategory(content));
}

/** Who writes this round: everyone, or in the face-off just the two finalists. */
export function writerIds(state: AcroState, playerIds: string[]): string[] {
  return state.stage === "faceoff" ? playerIds.filter((id) => state.finalists?.includes(id)) : playerIds;
}

/** Who votes this round: everyone, or in the face-off everyone but the finalists. */
export function voterIds(state: AcroState, playerIds: string[]): string[] {
  return state.stage === "faceoff" ? playerIds.filter((id) => !state.finalists?.includes(id)) : playerIds;
}

/** Who the current phase waits on. */
export function expectedIds(state: AcroState, playerIds: string[]): string[] {
  if (state.phase === "choosing") return state.chooserId ? [state.chooserId] : [];
  if (state.phase === "writing") return writerIds(state, playerIds);
  if (state.phase === "voting") return voterIds(state, playerIds);
  return [];
}

/** Who has acted in the current phase. */
export function actedIds(state: AcroState): string[] {
  if (state.phase === "writing") return Object.keys(state.answers);
  if (state.phase === "voting") return Object.keys(state.votes);
  return [];
}

/** The last winner's pick, or one they typed: on to writing. */
export function chooseCategory(state: AcroState, category: string): AcroState {
  return startWriting(state, category);
}

export function offeredCategories(): string[] {
  return pickSome(CATEGORIES, OFFERED);
}

/** Writing is over: the answers become one anonymous, shuffled list. */
export function openVoting(state: AcroState): AcroState {
  const entries: Entry[] = shuffle(Object.entries(state.answers)).map(([authorId, answer], i) => ({
    id: `e${i}`,
    authorId,
    text: answer.text,
    at: answer.at,
  }));
  return { ...state, phase: "voting", entries, votes: {} };
}

/** Most votes wins; a tie goes to whoever answered first. Nobody wins without a vote. */
function topEntry(entries: Entry[], count: (e: Entry) => number): Entry | null {
  const ranked = entries.filter((e) => count(e) > 0).sort((a, b) => count(b) - count(a) || a.at - b.at);
  return ranked[0] ?? null;
}

/**
 * Voting is over: score it and show the results. In the main stage a player
 * who didn't vote scores nothing — that keeps people from writing and walking
 * away. In the face-off only the finalists score, a point a vote.
 */
export function closeRound(state: AcroState): AcroState {
  const count = (e: Entry) => Object.values(state.votes).filter((id) => id === e.id).length;
  const winner = topEntry(state.entries, count);
  const gained: Record<string, number> = {};
  const add = (playerId: string, points: number) => {
    gained[playerId] = (gained[playerId] ?? 0) + points;
  };

  let fastest: Entry | null = null;
  const scores = { ...state.scores };
  const wins = { ...state.wins };
  const faceoffScores = { ...state.faceoffScores };

  if (state.stage === "main") {
    for (const entry of state.entries) add(entry.authorId, count(entry) * VOTE_POINTS);
    if (winner) {
      add(winner.authorId, state.acronym.length);
      wins[winner.authorId] = (wins[winner.authorId] ?? 0) + 1;
      fastest = state.entries.filter((e) => count(e) > 0).sort((a, b) => a.at - b.at)[0] ?? null;
      if (fastest) add(fastest.authorId, SPEED_POINTS);
      for (const [voterId, entryId] of Object.entries(state.votes)) {
        if (entryId === winner.id) add(voterId, PICKED_WINNER_POINTS);
      }
    }
    for (const playerId of Object.keys(gained)) if (!state.votes[playerId] || !gained[playerId]) delete gained[playerId];
    for (const [playerId, points] of Object.entries(gained)) scores[playerId] = (scores[playerId] ?? 0) + points;
  } else {
    for (const entry of state.entries) if (count(entry)) add(entry.authorId, count(entry) * VOTE_POINTS);
    for (const [playerId, points] of Object.entries(gained)) {
      faceoffScores[playerId] = (faceoffScores[playerId] ?? 0) + points;
    }
  }

  const record: RoundRecord = {
    stage: state.stage,
    acronym: state.acronym,
    category: state.category,
    entries: state.entries,
    votes: state.votes,
    winnerEntryId: winner?.id ?? null,
    fastestEntryId: fastest?.id ?? null,
    gained,
  };
  return { ...state, phase: "results", scores, wins, faceoffScores, history: [...state.history, record] };
}

export function isOver(state: AcroState, content: AcroContent): boolean {
  return state.stage === "faceoff" && state.stageRound >= content.faceoffRounds - 1;
}

/** The two finalists: highest scores, then most rounds won, then the luck of the draw. */
export function pickFinalists(state: AcroState, playerIds: string[]): string[] {
  return shuffle(playerIds)
    .sort((a, b) => (state.scores[b] ?? 0) - (state.scores[a] ?? 0) || (state.wins[b] ?? 0) - (state.wins[a] ?? 0))
    .slice(0, 2);
}

/** From the results, on to the next round — or to the face-off once someone reaches the target. */
export function nextRound(state: AcroState, content: AcroContent, playerIds: string[]): AcroState {
  const moved = { ...state, round: state.round + 1, stageRound: state.stageRound + 1 };

  if (state.stage === "main" && playerIds.some((id) => (state.scores[id] ?? 0) >= content.target)) {
    const faceoff: AcroState = {
      ...moved,
      stage: "faceoff",
      stageRound: 0,
      finalists: pickFinalists(state, playerIds),
      faceoffScores: {},
    };
    return startWriting(faceoff, randomCategory(content));
  }

  const last = state.history[state.history.length - 1];
  const lastWinner = last?.entries.find((e) => e.id === last.winnerEntryId)?.authorId;
  if (state.stage === "main" && content.categories === "winner" && lastWinner && playerIds.includes(lastWinner)) {
    return {
      ...moved,
      phase: "choosing",
      acronym: "",
      category: null,
      offered: offeredCategories(),
      chooserId: lastWinner,
      answers: {},
      entries: [],
      votes: {},
    };
  }
  return startWriting(moved, randomCategory(content));
}

/**
 * Who won: the better face-off, then the better main game; both finalists when
 * that's level too. A finalist who walked out loses. Without a face-off (too
 * few players were left for one), the top of the main game.
 */
export function champions(state: AcroState): string[] {
  if (!state.finalists) {
    const top = Math.max(0, ...Object.values(state.scores));
    return Object.keys(state.scores).filter((id) => top > 0 && state.scores[id] === top);
  }
  const finalists = state.finalists.filter((id) => id !== state.forfeit);
  const key = (id: string) => [state.faceoffScores[id] ?? 0, state.scores[id] ?? 0];
  const best = finalists.reduce<number[] | null>((top, id) => {
    const k = key(id);
    return !top || k[0] > top[0] || (k[0] === top[0] && k[1] > top[1]) ? k : top;
  }, null);
  return finalists.filter((id) => best && key(id)[0] === best[0] && key(id)[1] === best[1]);
}

/**
 * Everything one browser is told. The single place state becomes something
 * sent to a client, so it is the single place a secret could leak: who wrote
 * which answer, and who voted for what, appear only once the phase is "results".
 */
export function viewFor(state: AcroState, content: AcroContent, playerIds: string[], viewerId: string | null): AcroView {
  const me = viewerId ?? "";
  const record = state.phase === "results" ? state.history[state.history.length - 1] : undefined;

  return {
    round: state.round,
    stage: state.stage,
    stageRound: state.stageRound,
    faceoffRounds: content.faceoffRounds,
    target: content.target,
    phase: state.phase,
    acronym: state.acronym,
    category: state.category,
    offered: state.phase === "choosing" ? state.offered : [],
    chooserId: state.chooserId,
    finalists: state.finalists,
    expectedIds: expectedIds(state, playerIds),
    actedIds: actedIds(state),
    scores: state.scores,
    faceoffScores: state.faceoffScores,
    myAnswer: state.answers[me]?.text ?? null,
    myVote: state.votes[me] ?? null,
    entries:
      state.phase === "voting"
        ? state.entries.map((e) => ({ id: e.id, text: e.text, mine: e.authorId === me }))
        : null,
    results: record
      ? {
          entries: record.entries.map((e) => ({
            id: e.id,
            text: e.text,
            authorId: e.authorId,
            at: e.at,
            voterIds: Object.keys(record.votes).filter((voterId) => record.votes[voterId] === e.id),
          })),
          winnerEntryId: record.winnerEntryId,
          fastestEntryId: record.fastestEntryId,
          gained: record.gained,
        }
      : null,
  };
}

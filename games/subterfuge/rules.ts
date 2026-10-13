// The game's rules as pure functions over its state. Server-side only: this
// imports the question bank.
import { QUESTIONS, type Question } from "./questions";
import type { Choice, RoundRecord, SubterfugeState, SubterfugeView } from "./schema";

const TRUTH_POINTS = 1000;
const FOOL_POINTS = 500;
const FINAL_MULTIPLIER = 2;
// With few players the bank's suggestions pad the list out to this many choices.
const MIN_CHOICES = 4;

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export function getQuestion(id: string): Question {
  const question = BY_ID.get(id);
  if (!question) throw new Error(`Unknown question: ${id}`);
  return question;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How a lie is stored and shown: all caps, so the truth can't be told apart by its formatting. */
export function clean(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

/** The form two answers are compared in: case, punctuation, articles and plurals don't count. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => !["a", "an", "the"].includes(word))
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");
}

export function isTruth(question: Question, text: string): boolean {
  const given = normalize(text);
  return [question.answer, ...(question.alternates ?? [])].some((answer) => normalize(answer) === given);
}

/** A random set of questions, ending on one written for the final round when the bank has any. */
export function freshState(rounds: number): SubterfugeState {
  const ids = (final: boolean) => shuffle(QUESTIONS.filter((q) => !!q.final === final).map((q) => q.id));
  const [closer] = ids(true);
  const questionIds = closer ? [...ids(false).slice(0, rounds - 1), closer] : ids(false).slice(0, rounds);
  return { questionIds, round: 0, phase: "lying", lies: {}, choices: [], picks: {}, scores: {}, history: [] };
}

function multiplier(state: SubterfugeState): number {
  return state.round === state.questionIds.length - 1 ? FINAL_MULTIPLIER : 1;
}

/** Who has acted in the current phase. */
export function actedIds(state: SubterfugeState): string[] {
  if (state.phase === "lying") return Object.keys(state.lies);
  if (state.phase === "guessing") return Object.keys(state.picks);
  return [];
}

/**
 * Lying is over: the truth and the lies become one shuffled list. Identical
 * lies share a choice; a decoy is a lie nobody wrote, so it has no authors.
 */
export function openGuessing(state: SubterfugeState): SubterfugeState {
  const question = getQuestion(state.questionIds[state.round]);
  const lies = new Map<string, { text: string; authorIds: string[] }>();
  for (const [playerId, text] of Object.entries(state.lies)) {
    const key = normalize(text);
    const existing = lies.get(key);
    if (existing) existing.authorIds.push(playerId);
    else lies.set(key, { text, authorIds: [playerId] });
  }

  const decoys: string[] = [];
  for (const suggestion of shuffle(question.suggestions ?? [])) {
    if (1 + lies.size + decoys.length >= MIN_CHOICES) break;
    if (!lies.has(normalize(suggestion)) && !isTruth(question, suggestion)) decoys.push(clean(suggestion));
  }

  const choices: Choice[] = shuffle([
    { text: clean(question.answer), authorIds: [] as string[], isTruth: true },
    ...[...lies.values()].map((lie) => ({ ...lie, isTruth: false })),
    ...decoys.map((text) => ({ text, authorIds: [] as string[], isTruth: false })),
  ]).map((choice, i) => ({ id: `c${i}`, ...choice }));

  return { ...state, phase: "guessing", choices, picks: {} };
}

/** Guessing is over: score it and show the results. */
export function closeRound(state: SubterfugeState): SubterfugeState {
  const worth = multiplier(state);
  const gained: Record<string, number> = {};
  const add = (playerId: string, points: number) => {
    gained[playerId] = (gained[playerId] ?? 0) + points;
  };

  for (const [playerId, choiceId] of Object.entries(state.picks)) {
    const choice = state.choices.find((c) => c.id === choiceId);
    if (!choice) continue;
    if (choice.isTruth) add(playerId, TRUTH_POINTS * worth);
    else for (const authorId of choice.authorIds) add(authorId, FOOL_POINTS * worth);
  }

  const scores = { ...state.scores };
  for (const [playerId, points] of Object.entries(gained)) scores[playerId] = (scores[playerId] ?? 0) + points;

  const record: RoundRecord = {
    questionId: state.questionIds[state.round],
    choices: state.choices,
    picks: state.picks,
    gained,
  };
  return { ...state, phase: "results", scores, history: [...state.history, record] };
}

export function isLastRound(state: SubterfugeState): boolean {
  return state.round >= state.questionIds.length - 1;
}

export function nextRound(state: SubterfugeState): SubterfugeState {
  return { ...state, round: state.round + 1, phase: "lying", lies: {}, choices: [], picks: {} };
}

/**
 * Everything one browser is told. The single place state becomes something
 * sent to a client, so it is the single place a secret could leak: authors,
 * the answer and which choice is true appear only once the phase is "results".
 */
export function viewFor(state: SubterfugeState, viewerId: string | null): SubterfugeView {
  const question = getQuestion(state.questionIds[state.round]);
  const me = viewerId ?? "";
  const record = state.phase === "results" ? state.history[state.history.length - 1] : undefined;

  return {
    round: state.round,
    totalRounds: state.questionIds.length,
    phase: state.phase,
    prompt: question.prompt,
    multiplier: multiplier(state),
    actedIds: actedIds(state),
    scores: state.scores,
    myLie: state.lies[me] ?? null,
    myPick: state.picks[me] ?? null,
    choices:
      state.phase === "guessing"
        ? state.choices.map((c) => ({ id: c.id, text: c.text, mine: c.authorIds.includes(me) }))
        : null,
    results: record
      ? {
          answer: question.answer,
          choices: record.choices.map((c) => ({
            id: c.id,
            text: c.text,
            isTruth: c.isTruth,
            authorIds: c.authorIds,
            pickerIds: Object.keys(record.picks).filter((playerId) => record.picks[playerId] === c.id),
          })),
          gained: record.gained,
        }
      : null,
  };
}

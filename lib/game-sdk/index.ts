// The server-side surface of the game SDK — the only core module (besides
// ./client, the UI components and `cn`) that code under games/ may import.
// Deliberately NOT exported: the database client, table definitions, the
// Supabase client, and the push sender.
export { defineGame } from "./define";
export { GameError, StateConflictError } from "./errors";
export { shuffle, pickOne, pickSome } from "./shared";
export type {
  ContentAction,
  ContentApi,
  ContentContext,
  ContentListOptions,
  ContentRecord,
  Deadline,
  DeadlineApi,
  GameDefinition,
  GivenAnswer,
  PushMessage,
  SessionAction,
  SessionContext,
  SessionInfo,
  SessionPlayer,
  StateApi,
  Viewer,
  ViewerRole,
} from "./types";

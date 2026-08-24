import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session, Answer } from "@/lib/db/schema";
import { db, numberGames } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NumberGameBoard } from "@/components/games/guess-the-number/NumberGameBoard";
import { NumberGameReveal } from "@/components/games/guess-the-number/NumberGameReveal";

export const guessTheNumberPlugin: GamePlugin = {
  gameType: "guess_the_number",
  displayName: "Guess the Number",
  description: "Everyone guesses a secret number — closest wins",
  browsePath: "/games/guess-the-number",
  minPlayers: 2,
  maxPlayers: 16,
  supportsRandomize: false,

  async getContentMeta(gameContentId: string) {
    const [game] = await db
      .select({ title: numberGames.title, minNumber: numberGames.minNumber, maxNumber: numberGames.maxNumber })
      .from(numberGames)
      .where(eq(numberGames.id, gameContentId));
    if (!game) throw new Error("Number game not found");
    return { title: game.title };
  },

  async getLobbyMeta(session: Session) {
    const id = session.gameContentId!;
    const [game] = await db
      .select({ minNumber: numberGames.minNumber, maxNumber: numberGames.maxNumber })
      .from(numberGames)
      .where(eq(numberGames.id, id));
    return { subtitle: `Guess a number between ${game.minNumber} and ${game.maxNumber}` };
  },

  async start(session: Session, players: SessionPlayerInfo[], randomize: boolean) {
    const sorted = [...players].sort((a, b) => a.joinOrder - b.joinOrder);
    if (randomize) {
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
    }
    const tokenOrder = sorted.map((p) => `guess_${p.playerId}`);
    return { tokenOrder, firstPlayerId: sorted[0]?.playerId };
  },

  async getAnswerHints(_ctx: AnswerContext) {
    return { nextTokenLabel: "number" };
  },

  async buildResult(session: Session, sessionAnswers: Answer[]) {
    const id = session.gameContentId!;
    const [game] = await db.select().from(numberGames).where(eq(numberGames.id, id));
    if (!game) throw new Error("Number game not found");

    const rankings = sessionAnswers
      .map((a) => ({
        player: (a as Answer & { username?: string | null }).username ?? "Unknown",
        guess: parseInt(a.value, 10),
        distance: Math.abs(parseInt(a.value, 10) - game.secretNumber),
      }))
      .sort((a, b) => a.distance - b.distance);

    return {
      title: game.title,
      secretNumber: game.secretNumber,
      min: game.minNumber,
      max: game.maxNumber,
      rankings,
    };
  },

  async buildPlayProps(session: Session, _players: SessionPlayerInfo[]) {
    const id = session.gameContentId!;
    const [game] = await db
      .select({ title: numberGames.title, minNumber: numberGames.minNumber, maxNumber: numberGames.maxNumber })
      .from(numberGames)
      .where(eq(numberGames.id, id));
    if (!game) throw new Error("Number game not found");

    const tokenOrder = (session.tokenOrder ?? []) as string[];
    const currentTokenId = tokenOrder[session.currentTokenIndex ?? 0] ?? tokenOrder[0];

    return {
      title: game.title,
      min: game.minNumber,
      max: game.maxNumber,
      tokenOrder,
      initialCurrentTokenId: currentTokenId,
      initialCurrentPlayerId: session.currentPlayerId ?? session.hostId,
      initialTokenIndex: session.currentTokenIndex ?? 0,
    };
  },

  PlayComponent: NumberGameBoard,
  RevealComponent: NumberGameReveal,
};

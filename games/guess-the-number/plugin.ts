import { NextRequest, NextResponse } from "next/server";
import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session, Answer } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { numberGames } from "./schema";
import { NumberGameBoard } from "./components/NumberGameBoard";
import { NumberGameReveal } from "./components/NumberGameReveal";
import BrowsePage from "./pages/BrowsePage";

const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  min: z.number().int().min(0).max(999999).optional().default(1),
  max: z.number().int().min(1).max(1000000).optional().default(100),
});

export const plugin: GamePlugin = {
  gameType: "guess_the_number",
  displayName: "Guess the Number",
  description: "Everyone guesses a secret number — closest wins",
  browsePath: "/games/guess_the_number",
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

  async handleRequest(req: NextRequest, path: string[]) {
    const method = req.method;
    const [seg0] = path;

    // GET / (list recent games)
    if (method === "GET" && !seg0) {
      const rows = await db
        .select({
          id: numberGames.id,
          title: numberGames.title,
          minNumber: numberGames.minNumber,
          maxNumber: numberGames.maxNumber,
          createdAt: numberGames.createdAt,
        })
        .from(numberGames)
        .orderBy(desc(numberGames.createdAt))
        .limit(20);

      return NextResponse.json(rows);
    }

    // POST / (create game)
    if (method === "POST" && !seg0) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const body = await req.json();
      const parsed = CreateSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

      const { min = 1, max = 100 } = parsed.data;
      if (min >= max) return NextResponse.json({ error: "min must be less than max" }, { status: 400 });

      const secretNumber = Math.floor(Math.random() * (max - min + 1)) + min;
      const title = parsed.data.title ?? `Guess 1–${max}`;

      const [game] = await db
        .insert(numberGames)
        .values({ authorId: user.id, title, minNumber: min, maxNumber: max, secretNumber })
        .returning({ id: numberGames.id, title: numberGames.title });

      return NextResponse.json(game, { status: 201 });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  },

  PlayComponent: NumberGameBoard,
  RevealComponent: NumberGameReveal,
  BrowsePage,
};

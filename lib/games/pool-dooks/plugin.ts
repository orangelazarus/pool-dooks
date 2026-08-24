import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session, Answer } from "@/lib/db/schema";
import { db, poolDooks } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { PoolDookToken } from "@/lib/db/schema";
import { resolveTokenOrder } from "@/lib/utils/token-ordering";
import { GameBoard } from "@/components/session/GameBoard";
import { RevealDisplay } from "@/components/session/RevealDisplay";

/** Pool Dook ID for a session — uses gameContentId for new sessions, poolDookId for legacy. */
function contentId(session: Session): string {
  const id = session.gameContentId ?? session.poolDookId;
  if (!id) throw new Error("Session has no game content ID");
  return id;
}

export const poolDooksPlugin: GamePlugin = {
  gameType: "pool_dooks",
  displayName: "Pool Dooks",
  description: "Fill in the blanks together, then read the hilarious result",
  browsePath: "/games/pool-dooks",
  minPlayers: 1,
  maxPlayers: 16,
  supportsRandomize: true,

  async getContentMeta(gameContentId: string) {
    const [poolDook] = await db
      .select({ title: poolDooks.title })
      .from(poolDooks)
      .where(eq(poolDooks.id, gameContentId));
    if (!poolDook) throw new Error("Pool Dook not found");
    return { title: poolDook.title };
  },

  async start(session: Session, _players: SessionPlayerInfo[], randomize: boolean) {
    const [poolDook] = await db.select().from(poolDooks).where(eq(poolDooks.id, contentId(session)));
    if (!poolDook) throw new Error("Pool Dook not found");
    const tokens = (poolDook.tokens ?? []) as PoolDookToken[];
    const tokenOrder = resolveTokenOrder(tokens, randomize);
    return { tokenOrder };
  },

  async getAnswerHints(ctx: AnswerContext) {
    if (!ctx.nextTokenId) return {};
    const [poolDook] = await db
      .select({ tokens: poolDooks.tokens })
      .from(poolDooks)
      .where(eq(poolDooks.id, contentId(ctx.session)));
    const tokens = (poolDook?.tokens ?? []) as PoolDookToken[];
    const token = tokens.find((t) => t.id === ctx.nextTokenId);
    return { nextTokenLabel: token?.label };
  },

  async buildResult(session: Session, sessionAnswers: Answer[]) {
    const [poolDook] = await db.select().from(poolDooks).where(eq(poolDooks.id, contentId(session)));
    if (!poolDook) throw new Error("Pool Dook not found");

    let resultText = poolDook.bodyText;
    for (const answer of sessionAnswers) {
      resultText = resultText.replace(
        new RegExp(`\\{\\{${answer.tokenId}\\}\\}`, "g"),
        `**${answer.value}**`
      );
    }

    // Fix a/an based on the first letter of the following word
    resultText = resultText.replace(
      /\b(a\/an)\s+\*\*([a-zA-Z])/gi,
      (_, article, firstLetter) => {
        const isVowel = /[aeiou]/i.test(firstLetter);
        const corrected =
          article[0] === "A"
            ? isVowel ? "An" : "A"
            : isVowel ? "an" : "a";
        return `${corrected} **${firstLetter}`;
      }
    );

    const tokens = (poolDook.tokens ?? []) as PoolDookToken[];
    const tokenOrder = (session.tokenOrder ?? []) as string[];
    const answersWithMeta = tokenOrder.map((tokenId) => {
      const token = tokens.find((t) => t.id === tokenId);
      const answer = sessionAnswers.find((a) => a.tokenId === tokenId);
      return {
        tokenId,
        label: token?.label ?? tokenId,
        type: token?.type ?? "custom",
        value: answer?.value ?? "",
        player: (answer as (Answer & { username?: string | null }) | undefined)?.username ?? "Unknown",
      };
    });

    return {
      title: poolDook.title,
      theme: poolDook.theme,
      resultText,
      answersWithMeta,
      completedAt: session.completedAt,
    };
  },

  async buildPlayProps(session: Session, _players: SessionPlayerInfo[]) {
    const [poolDook] = await db.select().from(poolDooks).where(eq(poolDooks.id, contentId(session)));
    if (!poolDook) throw new Error("Pool Dook not found");
    const tokens = (poolDook.tokens ?? []) as PoolDookToken[];
    const tokenOrder = (session.tokenOrder ?? []) as string[];
    const currentTokenId = tokenOrder[session.currentTokenIndex ?? 0] ?? tokenOrder[0];
    return {
      tokens,
      tokenOrder,
      initialCurrentTokenId: currentTokenId,
      initialCurrentPlayerId: session.currentPlayerId ?? session.hostId,
      initialTokenIndex: session.currentTokenIndex ?? 0,
    };
  },

  async getLobbyMeta(session: Session) {
    const [poolDook] = await db
      .select({ tokens: poolDooks.tokens })
      .from(poolDooks)
      .where(eq(poolDooks.id, contentId(session)));
    const count = ((poolDook?.tokens ?? []) as PoolDookToken[]).length;
    return { subtitle: `${count} blank${count !== 1 ? "s" : ""} to fill` };
  },

  PlayComponent: GameBoard,
  RevealComponent: RevealDisplay,
};

import type { PushPayload } from "@/lib/push/send";

// An answer a game has chosen to make public during play (see
// GamePlugin.getAnswerHints): who gave it, and which blank it filled.
export interface AnnouncedAnswer {
  username: string;
  value: string;
  label: string;
  tokenType: string;
}

/** "noun", or "name of a pet (noun)" when the blank has its own label. */
export function describeBlank(label: string, tokenType: string): string {
  const same = label.trim().toLowerCase() === tokenType.trim().toLowerCase();
  return same || !tokenType || tokenType === "custom" ? label : `${label} (${tokenType})`;
}

/** `Alex answered "banana" for noun` */
export function describeAnswer(a: AnnouncedAnswer): string {
  return `${a.username} answered "${a.value}" for ${describeBlank(a.label, a.tokenType)}`;
}

/**
 * Push for the player whose turn is next. When the previous answer is public
 * it rides along here, so they get one notification rather than two.
 */
export function nextTurnPush(url: string, nextTokenLabel: string | undefined, answer: AnnouncedAnswer | null): PushPayload {
  const prompt = `Fill in the blank: ${nextTokenLabel ?? "word"}`;
  return { title: "Your turn!", body: answer ? `${describeAnswer(answer)}. ${prompt}` : prompt, url };
}

/** Push for everyone else who is neither the answerer nor up next. */
export function answerPush(url: string, answer: AnnouncedAnswer): PushPayload {
  return {
    title: `${answer.username} answered`,
    body: `"${answer.value}" for ${describeBlank(answer.label, answer.tokenType)}`,
    url,
  };
}

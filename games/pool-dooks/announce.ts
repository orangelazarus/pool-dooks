// Wording for "who answered what" in the play screen's toast. Mirrors the text
// core uses for the matching push notification.

/** "noun", or "name of a pet (noun)" when the blank has its own label. */
export function describeBlank(label: string, tokenType: string): string {
  const same = label.trim().toLowerCase() === tokenType.trim().toLowerCase();
  return same || !tokenType || tokenType === "custom" ? label : `${label} (${tokenType})`;
}

/** `Alex answered "banana" for noun` */
export function describeAnswer(a: { username: string; value: string; label: string; tokenType: string }): string {
  return `${a.username} answered "${a.value}" for ${describeBlank(a.label, a.tokenType)}`;
}

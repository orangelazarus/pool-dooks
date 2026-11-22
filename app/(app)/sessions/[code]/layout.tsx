import type { Metadata } from "next";
import { SessionChat } from "@/components/session/SessionChat";
import { sessionLinkMetadata } from "@/lib/sessions/link-preview";

// Here rather than on the lobby page so a link to the game in progress, or to
// its reveal, unfurls too.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return sessionLinkMetadata(code);
}

// Wraps the lobby, play and reveal pages of one session, so its chat stays
// mounted — and open, if it was — as the game moves between them.
export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <>
      {children}
      <SessionChat shareCode={code} />
    </>
  );
}

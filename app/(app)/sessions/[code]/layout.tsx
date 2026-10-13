import { SessionChat } from "@/components/session/SessionChat";

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

export const dynamic = "force-dynamic";
import { createClient } from "@/lib/supabase/server";
import { db, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Nav } from "@/components/layout/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const rows = await db.select().from(profiles).where(eq(profiles.id, user.id));
    profile = rows[0] ?? null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav user={user} profile={profile} />
      <main className="flex-1">{children}</main>
    </div>
  );
}

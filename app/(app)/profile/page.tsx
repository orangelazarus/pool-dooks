import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";
import { format } from "date-fns";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id));

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="flex flex-col items-center text-center mb-8">
        <Avatar className="h-20 w-20 mb-4">
          <AvatarFallback className="text-2xl">
            {profile?.username?.[0]?.toUpperCase() ?? "U"}
          </AvatarFallback>
        </Avatar>
        <h1 className="text-2xl font-bold">@{profile?.username ?? "unknown"}</h1>
        <p className="text-muted-foreground text-sm mt-1">{user.email}</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Joined
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {profile?.createdAt ? format(new Date(profile.createdAt), "MMM yyyy") : "—"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, numberGames } from "@/lib/db";
import { desc } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  min: z.number().int().min(0).max(999999).optional().default(1),
  max: z.number().int().min(1).max(1000000).optional().default(100),
});

export async function GET() {
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

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { min = 1, max = 100 } = parsed.data;
  if (min >= max) {
    return NextResponse.json({ error: "min must be less than max" }, { status: 400 });
  }

  const secretNumber = Math.floor(Math.random() * (max - min + 1)) + min;
  const title = parsed.data.title ?? `Guess 1–${max}`;

  const [game] = await db
    .insert(numberGames)
    .values({ authorId: user.id, title, minNumber: min, maxNumber: max, secretNumber })
    .returning({ id: numberGames.id, title: numberGames.title });

  return NextResponse.json(game, { status: 201 });
}

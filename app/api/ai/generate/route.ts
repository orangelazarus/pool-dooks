import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePoolDook } from "@/lib/ai/generate";
import { z } from "zod";

const Schema = z.object({
  theme: z.string().min(1),
  extraWeird: z.boolean().optional().default(false),
  title: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await generatePoolDook(
      parsed.data.theme,
      parsed.data.extraWeird,
      parsed.data.title
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai/generate]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

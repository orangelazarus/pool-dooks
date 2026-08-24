import { NextRequest, NextResponse } from "next/server";
import { parsePlainText, parseJsonImport } from "@/lib/editor/deserialize";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const text = await file.text();

    try {
      // Try JSON first
      const json = JSON.parse(text);
      return NextResponse.json(parseJsonImport(json));
    } catch {
      // Fall back to plain text parsing
      return NextResponse.json(parsePlainText(text));
    }
  } else {
    const body = await req.json();
    if (body.text) {
      return NextResponse.json(parsePlainText(body.text));
    }
    if (body.json) {
      return NextResponse.json(parseJsonImport(body.json));
    }
    return NextResponse.json({ error: "Provide text or json field" }, { status: 400 });
  }
}

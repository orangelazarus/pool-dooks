CREATE TABLE "number_games" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "author_id" uuid REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "min_number" integer NOT NULL DEFAULT 1,
  "max_number" integer NOT NULL DEFAULT 100,
  "secret_number" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

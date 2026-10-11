-- Public sessions are listed on the home page: anyone can join while in the
-- lobby, and anyone can watch once started. Existing sessions stay private.
ALTER TABLE "sessions" ADD COLUMN "is_public" boolean NOT NULL DEFAULT false;

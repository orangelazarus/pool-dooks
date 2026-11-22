import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Session links set their title and description from the database. Next
  // streams such metadata into the body for browsers it doesn't know as bots,
  // and many link unfurlers (Telegram, Signal, Mastodon, ...) only read
  // <head>. Always put it in <head>; the session lookup is one quick query.
  htmlLimitedBots: /.*/,
};

export default nextConfig;

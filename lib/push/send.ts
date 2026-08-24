import webPush from "web-push";
import { getVapidKeys } from "./vapid";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const { publicKey, privateKey, subject } = getVapidKeys();

  webPush.setVapidDetails(subject, publicKey, privateKey);

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      )
    )
  );

  // Remove expired subscriptions
  const expiredIndices = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "rejected" && (r.reason as { statusCode?: number }).statusCode === 410)
    .map(({ i }) => i);

  for (const idx of expiredIndices) {
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subs[idx].endpoint));
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  await Promise.allSettled(userIds.map((id) => sendPushToUser(id, payload)));
}

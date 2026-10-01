import { createECDH } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { pushSubscriptions } from "@/db/schema/push-subscriptions";
import { db } from "@/lib/db";
import {
  getWebPushSettings,
  type WebPushSettings,
} from "@/lib/integration-settings";
import type { CredentialTestResult } from "@/lib/integration-test";

/** Shape the service worker (public/service-worker.js) expects. Kept flat and
 * without a `data.pusher` key, which is how the SW tells it apart from Beams. */
export interface WebPushPayload {
  body: string;
  tag?: string;
  title: string;
  url?: string;
}

// Push service responses meaning the subscription is permanently gone
// (unsubscribed, expired, or the browser profile was deleted).
const GONE_STATUS_CODES = new Set([404, 410]);

export function generateVapidKeys(): { privateKey: string; publicKey: string } {
  return webpush.generateVAPIDKeys();
}

/** Sends `payload` to every saved subscription of the given users, pruning
 * subscriptions the push service reports as gone. No-op when VAPID keys aren't
 * configured. Returns how many deliveries the push services accepted. */
export async function sendWebPushToUsers(
  userIds: string[],
  payload: WebPushPayload,
  settings?: WebPushSettings
): Promise<{ attempted: number; delivered: number }> {
  const vapid = settings ?? (await getWebPushSettings());
  if (!vapid || userIds.length === 0) {
    return { attempted: 0, delivered: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
  if (subs.length === 0) {
    return { attempted: 0, delivered: 0 };
  }

  const body = JSON.stringify(payload);
  const gone: string[] = [];
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          {
            vapidDetails: vapid,
            TTL: 60 * 60 * 24,
            urgency: "high",
          }
        )
        .catch((error: unknown) => {
          if (
            error instanceof webpush.WebPushError &&
            GONE_STATUS_CODES.has(error.statusCode)
          ) {
            gone.push(sub.id);
          }
          throw error;
        })
    )
  );

  if (gone.length > 0) {
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, gone))
      .catch(() => undefined);
  }

  return {
    attempted: subs.length,
    delivered: results.filter((r) => r.status === "fulfilled").length,
  };
}

/** Drops every saved subscription. Called when the VAPID key pair changes —
 * browsers bind a subscription to the public key it was created with, so the
 * old ones can never receive pushes signed by the new key. Agents' browsers
 * re-subscribe on their next page load (components/agent/push-init.tsx). */
export async function clearAllWebPushSubscriptions(): Promise<void> {
  await db.delete(pushSubscriptions);
}

/** Upserts on `endpoint`: the same browser re-subscribing (e.g. after another
 * agent signs in on it) moves the device to the current user. */
export async function saveWebPushSubscription(input: {
  auth: string;
  endpoint: string;
  p256dh: string;
  userAgent: string | null;
  userId: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({ id: createId(), ...input, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        updatedAt: now,
      },
    });
}

export async function deleteWebPushSubscription(
  userId: string,
  endpoint: string
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, userId)
      )
    );
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** VAPID keys can be checked fully offline: the format (via web-push's own
 * validators) and that the public key really is derived from the private one —
 * a mismatched pair is the most likely copy-paste mistake and would otherwise
 * only surface as every push failing with 403. */
export function testWebPushKeys(
  settings: WebPushSettings
): CredentialTestResult {
  try {
    webpush.setVapidDetails(
      settings.subject,
      settings.publicKey,
      settings.privateKey
    );
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Invalid VAPID settings.",
    };
  }

  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(decodeBase64Url(settings.privateKey));
    if (!ecdh.getPublicKey().equals(decodeBase64Url(settings.publicKey))) {
      return {
        ok: false,
        message: "The public and private keys are not a matching pair.",
      };
    }
  } catch {
    return { ok: false, message: "The private key is not a valid VAPID key." };
  }

  return { ok: true, message: "VAPID keys are valid." };
}

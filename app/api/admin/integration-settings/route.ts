import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { integrationSettings } from "@/db/schema/integration-settings";
import { audit } from "@/lib/audit";
import { requireAdminFromRequest } from "@/lib/authz";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  getIntegrationSettingsSummary,
  vapidSubject,
} from "@/lib/integration-settings";
import {
  testGoogleOAuthCredentials,
  testPusherBeamsConnection,
  testPusherChannelsConnection,
  testSmtpConnection,
} from "@/lib/integration-test";
import { clearAllWebPushSubscriptions, testWebPushKeys } from "@/lib/web-push";

const VALID_STORAGE_DRIVERS = new Set(["local", "s3", "r2"]);
const VALID_PUSH_PROVIDERS = new Set(["pusher", "webpush"]);

// GET — agent/admin can read (middleware already enforced /api/admin/* access).
// Secret fields are never sent back to the browser — only whether one is set.
export async function GET() {
  return NextResponse.json(await getIntegrationSettingsSummary());
}

/** undefined = leave column untouched; "" clears it (stored as null); non-empty sets it, trimmed. */
function plainField(incoming: unknown): string | null | undefined {
  if (typeof incoming !== "string") {
    return;
  }
  const trimmed = incoming.trim();
  return trimmed === "" ? null : trimmed;
}

/** Same semantics as plainField, but encrypts non-empty values before storing. */
function secretField(incoming: unknown): string | null | undefined {
  if (typeof incoming !== "string") {
    return;
  }
  if (incoming === "") {
    return null;
  }
  return encryptSecret(incoming);
}

/** Drops keys whose resolved value is undefined, so drizzle only touches submitted fields. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

interface PatchBody {
  google?: { clientId?: unknown; clientSecret?: unknown };
  push?: { provider?: unknown };
  pusherBeams?: { instanceId?: unknown; secretKey?: unknown };
  pusherChannels?: {
    appId?: unknown;
    key?: unknown;
    secret?: unknown;
    cluster?: unknown;
  };
  smtp?: {
    host?: unknown;
    port?: unknown;
    user?: unknown;
    pass?: unknown;
    from?: unknown;
  };
  storage?: {
    driver?: unknown;
    s3Bucket?: unknown;
    s3Region?: unknown;
    r2Bucket?: unknown;
    r2AccountId?: unknown;
    awsAccessKeyId?: unknown;
    awsSecretAccessKey?: unknown;
    r2AccessKeyId?: unknown;
    r2SecretAccessKey?: unknown;
    publicBaseUrl?: unknown;
  };
  webPush?: { publicKey?: unknown; privateKey?: unknown };
}

// PATCH — admin only. Partial update, one section (smtp/google/pusherBeams/
// pusherChannels/webPush/storage) at a time — `push` (the provider choice) may
// accompany pusherBeams or webPush; only fields present in that section's
// object are changed. Within a section: key omitted = unchanged, "" = clear,
// non-empty = set (encrypted for secret fields).
export async function PATCH(request: NextRequest) {
  let admin;
  try {
    admin = requireAdminFromRequest(request);
  } catch (e) {
    return e as Response;
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const auditSections: string[] = [];
  const testedSections: Record<string, { message: string; ok: boolean }> = {};

  // Only the testable sections need the existing row (to merge in an
  // untouched saved secret before testing) — storage doesn't.
  const existing =
    body.smtp ||
    body.google ||
    body.pusherChannels ||
    body.pusherBeams ||
    body.webPush
      ? (
          await db
            .select()
            .from(integrationSettings)
            .where(eq(integrationSettings.id, "default"))
            .limit(1)
        )[0]
      : undefined;

  if (body.smtp) {
    const port =
      typeof body.smtp.port === "number"
        ? Math.trunc(body.smtp.port)
        : undefined;
    if (port !== undefined && (port < 1 || port > 65_535)) {
      return NextResponse.json(
        { error: "Invalid SMTP port." },
        { status: 400 }
      );
    }
    const smtpUpdates = compact({
      smtpHost: plainField(body.smtp.host),
      smtpPort: port,
      smtpUser: plainField(body.smtp.user),
      smtpPassEncrypted: secretField(body.smtp.pass),
      emailFrom: plainField(body.smtp.from),
    });
    Object.assign(updates, smtpUpdates);
    auditSections.push("smtp");

    const mergedHost =
      "smtpHost" in smtpUpdates ? smtpUpdates.smtpHost : existing?.smtpHost;
    const mergedPort =
      "smtpPort" in smtpUpdates ? smtpUpdates.smtpPort : existing?.smtpPort;
    const mergedUser =
      "smtpUser" in smtpUpdates ? smtpUpdates.smtpUser : existing?.smtpUser;
    const mergedFrom =
      "emailFrom" in smtpUpdates ? smtpUpdates.emailFrom : existing?.emailFrom;
    const mergedPassEncrypted =
      "smtpPassEncrypted" in smtpUpdates
        ? smtpUpdates.smtpPassEncrypted
        : existing?.smtpPassEncrypted;

    if (
      mergedHost &&
      mergedPort &&
      mergedUser &&
      mergedFrom &&
      mergedPassEncrypted
    ) {
      const result = await testSmtpConnection({
        host: mergedHost,
        port: mergedPort,
        user: mergedUser,
        pass: decryptSecret(mergedPassEncrypted),
      });
      updates.smtpLastTestedAt = new Date();
      updates.smtpLastTestOk = result.ok;
      updates.smtpLastTestError = result.ok ? null : result.message;
      testedSections.smtp = result;
    } else {
      updates.smtpLastTestedAt = null;
      updates.smtpLastTestOk = null;
      updates.smtpLastTestError = null;
    }
  }

  if (body.google) {
    const googleUpdates = compact({
      googleClientId: plainField(body.google.clientId),
      googleClientSecretEncrypted: secretField(body.google.clientSecret),
    });
    Object.assign(updates, googleUpdates);
    auditSections.push("google");

    const mergedClientId =
      "googleClientId" in googleUpdates
        ? googleUpdates.googleClientId
        : existing?.googleClientId;
    const mergedClientSecretEncrypted =
      "googleClientSecretEncrypted" in googleUpdates
        ? googleUpdates.googleClientSecretEncrypted
        : existing?.googleClientSecretEncrypted;

    if (mergedClientId && mergedClientSecretEncrypted) {
      const result = await testGoogleOAuthCredentials(
        mergedClientId,
        decryptSecret(mergedClientSecretEncrypted)
      );
      updates.googleLastTestedAt = new Date();
      updates.googleLastTestOk = result.ok;
      updates.googleLastTestError = result.ok ? null : result.message;
      testedSections.google = result;
    } else {
      updates.googleLastTestedAt = null;
      updates.googleLastTestOk = null;
      updates.googleLastTestError = null;
    }
  }

  if (body.pusherBeams) {
    const pusherBeamsUpdates = compact({
      pusherBeamsInstanceId: plainField(body.pusherBeams.instanceId),
      pusherBeamsSecretKeyEncrypted: secretField(body.pusherBeams.secretKey),
    });
    Object.assign(updates, pusherBeamsUpdates);
    auditSections.push("pusherBeams");

    const mergedInstanceId =
      "pusherBeamsInstanceId" in pusherBeamsUpdates
        ? pusherBeamsUpdates.pusherBeamsInstanceId
        : existing?.pusherBeamsInstanceId;
    const mergedSecretKeyEncrypted =
      "pusherBeamsSecretKeyEncrypted" in pusherBeamsUpdates
        ? pusherBeamsUpdates.pusherBeamsSecretKeyEncrypted
        : existing?.pusherBeamsSecretKeyEncrypted;

    if (mergedInstanceId && mergedSecretKeyEncrypted) {
      const result = await testPusherBeamsConnection({
        instanceId: mergedInstanceId,
        secretKey: decryptSecret(mergedSecretKeyEncrypted),
      });
      updates.pusherBeamsLastTestedAt = new Date();
      updates.pusherBeamsLastTestOk = result.ok;
      updates.pusherBeamsLastTestError = result.ok ? null : result.message;
      testedSections.pusherBeams = result;
    } else {
      updates.pusherBeamsLastTestedAt = null;
      updates.pusherBeamsLastTestOk = null;
      updates.pusherBeamsLastTestError = null;
    }
  }

  if (body.push) {
    if (!VALID_PUSH_PROVIDERS.has(body.push.provider as string)) {
      return NextResponse.json(
        { error: "Invalid push provider." },
        { status: 400 }
      );
    }
    updates.pushProvider = body.push.provider;
    auditSections.push("push");
  }

  let vapidKeysChanged = false;
  if (body.webPush) {
    const webPushUpdates = compact({
      webPushVapidPublicKey: plainField(body.webPush.publicKey),
      webPushVapidPrivateKeyEncrypted: secretField(
        typeof body.webPush.privateKey === "string"
          ? body.webPush.privateKey.trim()
          : undefined
      ),
    });
    Object.assign(updates, webPushUpdates);
    auditSections.push("webPush");

    const mergedPublicKey =
      "webPushVapidPublicKey" in webPushUpdates
        ? webPushUpdates.webPushVapidPublicKey
        : existing?.webPushVapidPublicKey;
    const mergedPrivateKeyEncrypted =
      "webPushVapidPrivateKeyEncrypted" in webPushUpdates
        ? webPushUpdates.webPushVapidPrivateKeyEncrypted
        : existing?.webPushVapidPrivateKeyEncrypted;

    vapidKeysChanged =
      (mergedPublicKey ?? null) !== (existing?.webPushVapidPublicKey ?? null);

    if (mergedPublicKey && mergedPrivateKeyEncrypted) {
      const result = testWebPushKeys({
        publicKey: mergedPublicKey,
        privateKey: decryptSecret(mergedPrivateKeyEncrypted),
        subject: vapidSubject(),
      });
      updates.webPushLastTestedAt = new Date();
      updates.webPushLastTestOk = result.ok;
      updates.webPushLastTestError = result.ok ? null : result.message;
      testedSections.webPush = result;
    } else {
      updates.webPushLastTestedAt = null;
      updates.webPushLastTestOk = null;
      updates.webPushLastTestError = null;
    }
  }

  if (body.pusherChannels) {
    const pusherChannelsUpdates = compact({
      pusherAppId: plainField(body.pusherChannels.appId),
      pusherKey: plainField(body.pusherChannels.key),
      pusherSecretEncrypted: secretField(body.pusherChannels.secret),
      pusherCluster: plainField(body.pusherChannels.cluster),
    });
    Object.assign(updates, pusherChannelsUpdates);
    auditSections.push("pusherChannels");

    const mergedAppId =
      "pusherAppId" in pusherChannelsUpdates
        ? pusherChannelsUpdates.pusherAppId
        : existing?.pusherAppId;
    const mergedKey =
      "pusherKey" in pusherChannelsUpdates
        ? pusherChannelsUpdates.pusherKey
        : existing?.pusherKey;
    const mergedCluster =
      "pusherCluster" in pusherChannelsUpdates
        ? pusherChannelsUpdates.pusherCluster
        : existing?.pusherCluster;
    const mergedSecretEncrypted =
      "pusherSecretEncrypted" in pusherChannelsUpdates
        ? pusherChannelsUpdates.pusherSecretEncrypted
        : existing?.pusherSecretEncrypted;

    if (mergedAppId && mergedKey && mergedCluster && mergedSecretEncrypted) {
      const result = await testPusherChannelsConnection({
        appId: mergedAppId,
        key: mergedKey,
        cluster: mergedCluster,
        secret: decryptSecret(mergedSecretEncrypted),
      });
      updates.pusherChannelsLastTestedAt = new Date();
      updates.pusherChannelsLastTestOk = result.ok;
      updates.pusherChannelsLastTestError = result.ok ? null : result.message;
      testedSections.pusherChannels = result;
    } else {
      updates.pusherChannelsLastTestedAt = null;
      updates.pusherChannelsLastTestOk = null;
      updates.pusherChannelsLastTestError = null;
    }
  }

  if (body.storage) {
    if (
      body.storage.driver !== undefined &&
      !VALID_STORAGE_DRIVERS.has(body.storage.driver as string)
    ) {
      return NextResponse.json(
        { error: "Invalid storage driver." },
        { status: 400 }
      );
    }
    Object.assign(
      updates,
      compact({
        storageDriver:
          typeof body.storage.driver === "string"
            ? body.storage.driver
            : undefined,
        s3Bucket: plainField(body.storage.s3Bucket),
        s3Region: plainField(body.storage.s3Region),
        r2Bucket: plainField(body.storage.r2Bucket),
        r2AccountId: plainField(body.storage.r2AccountId),
        awsAccessKeyId: plainField(body.storage.awsAccessKeyId),
        awsSecretAccessKeyEncrypted: secretField(
          body.storage.awsSecretAccessKey
        ),
        r2AccessKeyId: plainField(body.storage.r2AccessKeyId),
        r2SecretAccessKeyEncrypted: secretField(body.storage.r2SecretAccessKey),
        storagePublicBaseUrl: plainField(body.storage.publicBaseUrl),
      })
    );
    auditSections.push("storage");
  }

  if (auditSections.length === 0) {
    return NextResponse.json(
      { error: "No settings provided." },
      { status: 400 }
    );
  }

  const now = new Date();
  await db
    .insert(integrationSettings)
    .values({ id: "default", ...updates, updatedAt: now })
    .onConflictDoUpdate({
      target: integrationSettings.id,
      set: { ...updates, updatedAt: now },
    });

  // Browsers bind each subscription to the public key it was created with, so
  // a new key pair orphans every saved one; agents re-subscribe on next load.
  if (vapidKeysChanged) {
    await clearAllWebPushSubscriptions();
  }

  await audit({
    action: "integration_settings.updated",
    actorEmail: admin.email,
    actorId: admin.id,
    description: `Updated integration settings: ${auditSections.join(", ")}`,
    entityId: "default",
    entityType: "integration_settings",
    metadata: { sections: auditSections },
  });

  return NextResponse.json({ ok: true, tested: testedSections });
}

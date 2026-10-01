import { eq } from "drizzle-orm";
import { cache } from "react";
import { integrationSettings } from "@/db/schema/integration-settings";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** The single integration_settings row, or undefined on a fresh install (or one
 * that only ever used .env). Memoized per-request, so every getter below shares
 * one query. */
const getRow = cache(async () => {
  const [row] = await db
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.id, "default"))
    .limit(1);
  return row;
});

function nonEmpty(value: string | null | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

export interface SmtpSettings {
  from: string;
  host: string;
  pass: string;
  port: number;
  user: string;
}

/** DB value wins per field, env var is the fallback — see db/schema/integration-settings.ts. */
export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  const row = await getRow();
  const host = nonEmpty(row?.smtpHost) ?? env.SMTP_HOST;
  const user = nonEmpty(row?.smtpUser) ?? env.SMTP_USER;
  const from = nonEmpty(row?.emailFrom) ?? env.EMAIL_FROM;
  const pass = row?.smtpPassEncrypted
    ? decryptSecret(row.smtpPassEncrypted)
    : env.SMTP_PASS;
  const port = row?.smtpPort ?? env.SMTP_PORT ?? 587;

  if (!(host && user && pass && from)) {
    return null;
  }
  return { host, port, user, pass, from };
}

export async function isSmtpConfigured(): Promise<boolean> {
  return (await getSmtpSettings()) !== null;
}

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
}

/** Read once at boot by lib/auth.ts, which bakes social-providers into its
 * singleton — so changes take effect only after a restart (docs/authentication).
 * UI "is Google configured" checks call this too, as a fresh read each time. */
export async function getGoogleOAuthSettings(): Promise<GoogleOAuthSettings | null> {
  const row = await getRow();
  const clientId = nonEmpty(row?.googleClientId) ?? env.GOOGLE_CLIENT_ID;
  const clientSecret = row?.googleClientSecretEncrypted
    ? decryptSecret(row.googleClientSecretEncrypted)
    : env.GOOGLE_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    return null;
  }
  return { clientId, clientSecret };
}

export async function isGoogleOAuthConfigured(): Promise<boolean> {
  return (await getGoogleOAuthSettings()) !== null;
}

export interface PusherBeamsSettings {
  instanceId: string;
  secretKey: string;
}

export async function getPusherBeamsSettings(): Promise<PusherBeamsSettings | null> {
  const row = await getRow();
  const instanceId =
    nonEmpty(row?.pusherBeamsInstanceId) ??
    env.NEXT_PUBLIC_PUSHER_BEAMS_INSTANCE_ID;
  const secretKey = row?.pusherBeamsSecretKeyEncrypted
    ? decryptSecret(row.pusherBeamsSecretKeyEncrypted)
    : env.PUSHER_BEAMS_SECRET_KEY;

  if (!(instanceId && secretKey)) {
    return null;
  }
  return { instanceId, secretKey };
}

export type PushProvider = "pusher" | "webpush";

/** Which backend delivers browser/OS push. DB wins, then PUSH_PROVIDER, then
 * "pusher" — so installs that predate the switch keep using Beams. */
export async function getPushProvider(): Promise<PushProvider> {
  const row = await getRow();
  const value = nonEmpty(row?.pushProvider) ?? env.PUSH_PROVIDER;
  return value === "webpush" ? "webpush" : "pusher";
}

export interface WebPushSettings {
  privateKey: string;
  publicKey: string;
  subject: string;
}

/** VAPID requires an https: or mailto: contact. It isn't admin-configurable:
 * the app URL qualifies in production; a plain-http dev URL doesn't, so fall
 * back to a mailto there. */
export function vapidSubject(): string {
  const url = new URL(env.NEXT_PUBLIC_APP_URL);
  return url.protocol === "https:"
    ? url.origin
    : `mailto:admin@${url.hostname}`;
}

/** VAPID keys — pair-wise resolution, not per-field: a DB public key with an
 * env private key would be a mismatched pair, so the DB pair wins only when
 * both halves are saved there. */
export async function getWebPushSettings(): Promise<WebPushSettings | null> {
  const row = await getRow();
  const dbPublicKey = nonEmpty(row?.webPushVapidPublicKey);
  const dbPrivateKey = row?.webPushVapidPrivateKeyEncrypted
    ? decryptSecret(row.webPushVapidPrivateKeyEncrypted)
    : undefined;

  const [publicKey, privateKey] =
    dbPublicKey && dbPrivateKey
      ? [dbPublicKey, dbPrivateKey]
      : [env.WEB_PUSH_VAPID_PUBLIC_KEY, env.WEB_PUSH_VAPID_PRIVATE_KEY];
  if (!(publicKey && privateKey)) {
    return null;
  }
  return { publicKey, privateKey, subject: vapidSubject() };
}

export interface PusherChannelsSettings {
  appId: string;
  cluster: string;
  key: string;
  secret: string;
}

export async function getPusherChannelsSettings(): Promise<PusherChannelsSettings | null> {
  const row = await getRow();
  const appId = nonEmpty(row?.pusherAppId) ?? env.PUSHER_APP_ID;
  const key = nonEmpty(row?.pusherKey) ?? env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster =
    nonEmpty(row?.pusherCluster) ?? env.NEXT_PUBLIC_PUSHER_CLUSTER;
  const secret = row?.pusherSecretEncrypted
    ? decryptSecret(row.pusherSecretEncrypted)
    : env.PUSHER_SECRET;

  if (!(appId && key && secret && cluster)) {
    return null;
  }
  return { appId, key, secret, cluster };
}

export interface PusherClientConfig {
  beamsInstanceId: string | null;
  pusherCluster: string | null;
  pusherKey: string | null;
  pushProvider: PushProvider;
  vapidPublicKey: string | null;
}

/** Public identifiers only, no secrets — served unauthenticated via
 * GET /api/config/client so the browser reads them at runtime rather than
 * needing NEXT_PUBLIC_* baked in at Docker build time. */
export async function getPusherClientConfig(): Promise<PusherClientConfig> {
  const row = await getRow();
  const pushProvider = await getPushProvider();
  return {
    pushProvider,
    vapidPublicKey:
      pushProvider === "webpush"
        ? ((await getWebPushSettings())?.publicKey ?? null)
        : null,
    pusherKey: nonEmpty(row?.pusherKey) ?? env.NEXT_PUBLIC_PUSHER_KEY ?? null,
    pusherCluster:
      nonEmpty(row?.pusherCluster) ?? env.NEXT_PUBLIC_PUSHER_CLUSTER ?? null,
    beamsInstanceId:
      pushProvider === "pusher"
        ? (nonEmpty(row?.pusherBeamsInstanceId) ??
          env.NEXT_PUBLIC_PUSHER_BEAMS_INSTANCE_ID ??
          null)
        : null,
  };
}

export type StorageSettings =
  | { driver: "local" }
  | {
      driver: "s3";
      bucket: string;
      region: string | undefined;
      publicBaseUrl: string | undefined;
      accessKeyId: string | undefined;
      secretAccessKey: string | undefined;
    }
  | {
      driver: "r2";
      bucket: string;
      accountId: string;
      publicBaseUrl: string | undefined;
      accessKeyId: string | undefined;
      secretAccessKey: string | undefined;
    };

/** Resolves the storage driver and its credentials, throwing a clear message if
 * s3/r2 is selected without its required fields. Checked lazily on first use
 * rather than at boot, since the driver can now come from the DB. */
export async function getStorageSettings(): Promise<StorageSettings> {
  const row = await getRow();
  const driver = (nonEmpty(row?.storageDriver) ??
    env.STORAGE_DRIVER) as StorageSettings["driver"];

  if (driver === "s3") {
    const bucket = nonEmpty(row?.s3Bucket) ?? env.S3_BUCKET;
    if (!bucket) {
      throw new Error("STORAGE_DRIVER=s3 requires an S3 bucket to be set.");
    }
    return {
      driver: "s3",
      bucket,
      region: nonEmpty(row?.s3Region) ?? env.S3_REGION,
      publicBaseUrl:
        nonEmpty(row?.storagePublicBaseUrl) ?? env.STORAGE_PUBLIC_BASE_URL,
      // DB-only, no env fallback on purpose: with neither set the s3 adapter is
      // called without `credentials`, leaving the AWS SDK's own default chain
      // (env, IAM role, shared profile) working as before. See lib/storage.ts.
      accessKeyId: nonEmpty(row?.awsAccessKeyId),
      secretAccessKey: row?.awsSecretAccessKeyEncrypted
        ? decryptSecret(row.awsSecretAccessKeyEncrypted)
        : undefined,
    };
  }

  if (driver === "r2") {
    const bucket = nonEmpty(row?.r2Bucket) ?? env.R2_BUCKET;
    const accountId = nonEmpty(row?.r2AccountId) ?? env.R2_ACCOUNT_ID;
    if (!(bucket && accountId)) {
      throw new Error(
        "STORAGE_DRIVER=r2 requires an R2 bucket and account ID to be set."
      );
    }
    return {
      driver: "r2",
      bucket,
      accountId,
      publicBaseUrl:
        nonEmpty(row?.storagePublicBaseUrl) ?? env.STORAGE_PUBLIC_BASE_URL,
      accessKeyId: nonEmpty(row?.r2AccessKeyId) ?? env.R2_ACCESS_KEY_ID,
      secretAccessKey: row?.r2SecretAccessKeyEncrypted
        ? decryptSecret(row.r2SecretAccessKeyEncrypted)
        : env.R2_SECRET_ACCESS_KEY,
    };
  }

  return { driver: "local" };
}

/** Result of the last credential check for a section that supports one (SMTP,
 * Google, Pusher Channels, Pusher Beams, Web Push) — see lib/integration-test.ts.
 * `lastTestOk` is null until the first check ever runs, and reset to null
 * whenever the section becomes incomplete. */
export interface LastTestResult {
  lastTestError: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

export interface IntegrationSettingsSummary {
  google: { clientId: string; hasClientSecret: boolean } & LastTestResult;
  push: { provider: PushProvider };
  pusherBeams: { instanceId: string; hasSecretKey: boolean } & LastTestResult;
  pusherChannels: {
    appId: string;
    key: string;
    cluster: string;
    hasSecret: boolean;
  } & LastTestResult;
  smtp: {
    host: string;
    port: number;
    user: string;
    from: string;
    hasPassword: boolean;
  } & LastTestResult;
  storage: {
    driver: "local" | "s3" | "r2";
    s3Bucket: string;
    s3Region: string;
    r2Bucket: string;
    r2AccountId: string;
    awsAccessKeyId: string;
    hasAwsSecretAccessKey: boolean;
    r2AccessKeyId: string;
    hasR2SecretAccessKey: boolean;
    publicBaseUrl: string;
  };
  webPush: {
    publicKey: string;
    hasPrivateKey: boolean;
  } & LastTestResult;
}

/** Prefills the /admin/integrations forms with what the admin typed and saved,
 * not the resolved DB+env value — so an env-configured field shows blank rather
 * than being saved back as DB-authoritative. Secrets appear only as booleans. */
export async function getIntegrationSettingsSummary(): Promise<IntegrationSettingsSummary> {
  const row = await getRow();
  return {
    smtp: {
      host: row?.smtpHost ?? "",
      port: row?.smtpPort ?? 587,
      user: row?.smtpUser ?? "",
      from: row?.emailFrom ?? "",
      hasPassword: !!row?.smtpPassEncrypted,
      lastTestedAt: row?.smtpLastTestedAt?.toISOString() ?? null,
      lastTestOk: row?.smtpLastTestOk ?? null,
      lastTestError: row?.smtpLastTestError ?? null,
    },
    google: {
      clientId: row?.googleClientId ?? "",
      hasClientSecret: !!row?.googleClientSecretEncrypted,
      lastTestedAt: row?.googleLastTestedAt?.toISOString() ?? null,
      lastTestOk: row?.googleLastTestOk ?? null,
      lastTestError: row?.googleLastTestError ?? null,
    },
    // Resolved (DB → env → default) rather than raw, unlike the fields
    // below: a dropdown has no "blank" state to show an env-set value as.
    push: { provider: await getPushProvider() },
    webPush: {
      publicKey: row?.webPushVapidPublicKey ?? "",
      hasPrivateKey: !!row?.webPushVapidPrivateKeyEncrypted,
      lastTestedAt: row?.webPushLastTestedAt?.toISOString() ?? null,
      lastTestOk: row?.webPushLastTestOk ?? null,
      lastTestError: row?.webPushLastTestError ?? null,
    },
    pusherBeams: {
      instanceId: row?.pusherBeamsInstanceId ?? "",
      hasSecretKey: !!row?.pusherBeamsSecretKeyEncrypted,
      lastTestedAt: row?.pusherBeamsLastTestedAt?.toISOString() ?? null,
      lastTestOk: row?.pusherBeamsLastTestOk ?? null,
      lastTestError: row?.pusherBeamsLastTestError ?? null,
    },
    pusherChannels: {
      appId: row?.pusherAppId ?? "",
      key: row?.pusherKey ?? "",
      cluster: row?.pusherCluster ?? "",
      hasSecret: !!row?.pusherSecretEncrypted,
      lastTestedAt: row?.pusherChannelsLastTestedAt?.toISOString() ?? null,
      lastTestOk: row?.pusherChannelsLastTestOk ?? null,
      lastTestError: row?.pusherChannelsLastTestError ?? null,
    },
    storage: {
      driver: (row?.storageDriver as "local" | "s3" | "r2" | null) ?? "local",
      s3Bucket: row?.s3Bucket ?? "",
      s3Region: row?.s3Region ?? "",
      r2Bucket: row?.r2Bucket ?? "",
      r2AccountId: row?.r2AccountId ?? "",
      awsAccessKeyId: row?.awsAccessKeyId ?? "",
      hasAwsSecretAccessKey: !!row?.awsSecretAccessKeyEncrypted,
      r2AccessKeyId: row?.r2AccessKeyId ?? "",
      hasR2SecretAccessKey: !!row?.r2SecretAccessKeyEncrypted,
      publicBaseUrl: row?.storagePublicBaseUrl ?? "",
    },
  };
}

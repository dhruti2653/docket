import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Admin-configurable alternative to lib/env.ts's optional vars, set from the
// setup wizard or /admin/integrations. Single row, id "default". A non-null DB
// value wins over the matching env var, so .env-only installs are unaffected.
// `*Encrypted` columns are AES-256-GCM, never sent to the browser in plaintext.
export const integrationSettings = pgTable("integration_settings", {
  id: text("id").primaryKey().default("default"),

  // SMTP
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassEncrypted: text("smtp_pass_encrypted"),
  emailFrom: text("email_from"),
  // Result of the last credential check — run automatically whenever a PATCH
  // leaves the section fully filled in, and on demand from the "Test
  // connection" button (which does not itself persist). Null = never tested.
  // See lib/integration-test.ts.
  smtpLastTestedAt: timestamp("smtp_last_tested_at", { withTimezone: true }),
  smtpLastTestOk: boolean("smtp_last_test_ok"),
  smtpLastTestError: text("smtp_last_test_error"),

  // Google OAuth — read once at process boot (lib/auth.ts); changes need a
  // restart, see docs/authentication.md.
  googleClientId: text("google_client_id"),
  googleClientSecretEncrypted: text("google_client_secret_encrypted"),
  googleLastTestedAt: timestamp("google_last_tested_at", {
    withTimezone: true,
  }),
  googleLastTestOk: boolean("google_last_test_ok"),
  googleLastTestError: text("google_last_test_error"),

  // Which backend delivers browser/OS push: "pusher" (Pusher Beams) or
  // "webpush" (standard Web Push with VAPID keys, no third party). Null falls
  // back to PUSH_PROVIDER, then "pusher" — see getPushProvider().
  pushProvider: text("push_provider"),

  // Web Push (VAPID) — public key is served to the browser via
  // /api/config/client; private key is server-only.
  webPushVapidPublicKey: text("web_push_vapid_public_key"),
  webPushVapidPrivateKeyEncrypted: text("web_push_vapid_private_key_encrypted"),
  webPushLastTestedAt: timestamp("web_push_last_tested_at", {
    withTimezone: true,
  }),
  webPushLastTestOk: boolean("web_push_last_test_ok"),
  webPushLastTestError: text("web_push_last_test_error"),

  // Pusher Beams (browser/OS push)
  pusherBeamsInstanceId: text("pusher_beams_instance_id"),
  pusherBeamsSecretKeyEncrypted: text("pusher_beams_secret_key_encrypted"),
  pusherBeamsLastTestedAt: timestamp("pusher_beams_last_tested_at", {
    withTimezone: true,
  }),
  pusherBeamsLastTestOk: boolean("pusher_beams_last_test_ok"),
  pusherBeamsLastTestError: text("pusher_beams_last_test_error"),

  // Pusher Channels (real-time ticket updates) — key/cluster are public
  // identifiers (served to the browser via /api/config/client), appId/secret
  // are server-only.
  pusherAppId: text("pusher_app_id"),
  pusherKey: text("pusher_key"),
  pusherSecretEncrypted: text("pusher_secret_encrypted"),
  pusherCluster: text("pusher_cluster"),
  pusherChannelsLastTestedAt: timestamp("pusher_channels_last_tested_at", {
    withTimezone: true,
  }),
  pusherChannelsLastTestOk: boolean("pusher_channels_last_test_ok"),
  pusherChannelsLastTestError: text("pusher_channels_last_test_error"),

  // File storage — driver switch + credentials for the non-default drivers.
  storageDriver: text("storage_driver"), // "local" | "s3" | "r2"
  s3Bucket: text("s3_bucket"),
  s3Region: text("s3_region"),
  awsAccessKeyId: text("aws_access_key_id"),
  awsSecretAccessKeyEncrypted: text("aws_secret_access_key_encrypted"),
  r2Bucket: text("r2_bucket"),
  r2AccountId: text("r2_account_id"),
  r2AccessKeyId: text("r2_access_key_id"),
  r2SecretAccessKeyEncrypted: text("r2_secret_access_key_encrypted"),
  storagePublicBaseUrl: text("storage_public_base_url"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

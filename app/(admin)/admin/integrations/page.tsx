import { getIntegrationSettingsSummary } from "@/lib/integration-settings";
import { GoogleOAuthSettingsForm } from "./_components/google-oauth-settings-form";
import { PushNotificationsSettingsForm } from "./_components/push-notifications-settings-form";
import { PusherChannelsSettingsForm } from "./_components/pusher-channels-settings-form";
import { SmtpSettingsForm } from "./_components/smtp-settings-form";
import { StorageSettingsForm } from "./_components/storage-settings-form";

export const metadata = { title: "Integrations" };

// Settings queried here must be per-request, not build-time — same reason as
// every other admin settings page (Docker builder has no database).
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const settings = await getIntegrationSettingsSummary();

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-base-content">
          Integrations
        </h1>
        <p className="text-sm text-base-content-muted mt-1">
          Optional — the app works without any of these. Configure what you need
          here instead of editing .env; everything below applies live except
          Google Sign-in, which needs a restart.
        </p>
      </div>
      <SmtpSettingsForm initial={settings.smtp} />
      <GoogleOAuthSettingsForm initial={settings.google} />
      <PusherChannelsSettingsForm initial={settings.pusherChannels} />
      <PushNotificationsSettingsForm initial={settings} />
      <StorageSettingsForm initial={settings.storage} />
    </div>
  );
}

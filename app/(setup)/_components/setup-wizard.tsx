"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  EyeIcon,
  EyeSlashIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  TicketIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { GoogleOAuthSettingsForm } from "@/app/(admin)/admin/integrations/_components/google-oauth-settings-form";
import { PushNotificationsSettingsForm } from "@/app/(admin)/admin/integrations/_components/push-notifications-settings-form";
import { PusherChannelsSettingsForm } from "@/app/(admin)/admin/integrations/_components/pusher-channels-settings-form";
import { SmtpSettingsForm } from "@/app/(admin)/admin/integrations/_components/smtp-settings-form";
import { StorageSettingsForm } from "@/app/(admin)/admin/integrations/_components/storage-settings-form";
import { ThemeProvider, useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRODUCT_NAME } from "@/config/platform";
import { authClient } from "@/lib/auth-client";
import type { IntegrationSettingsSummary } from "@/lib/integration-settings";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// This step always runs immediately after the admin account is created, so
// nothing in integration_settings has ever been saved yet — no need to fetch
// current values like /admin/integrations does, every field starts blank.
const EMPTY_INTEGRATION_SETTINGS: IntegrationSettingsSummary = {
  smtp: {
    host: "",
    port: 587,
    user: "",
    from: "",
    hasPassword: false,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
  },
  google: {
    clientId: "",
    hasClientSecret: false,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
  },
  push: { provider: "pusher" },
  webPush: {
    publicKey: "",
    hasPrivateKey: false,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
  },
  pusherBeams: {
    instanceId: "",
    hasSecretKey: false,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
  },
  pusherChannels: {
    appId: "",
    key: "",
    cluster: "",
    hasSecret: false,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
  },
  storage: {
    driver: "local",
    s3Bucket: "",
    s3Region: "",
    r2Bucket: "",
    r2AccountId: "",
    awsAccessKeyId: "",
    hasAwsSecretAccessKey: false,
    r2AccessKeyId: "",
    hasR2SecretAccessKey: false,
    publicBaseUrl: "",
  },
};

const THEME_OPTIONS = [
  { id: "default", name: "Default", color: "#384959" },
  { id: "ocean", name: "Ocean", color: "#1A4A5E" },
  { id: "forest", name: "Forest", color: "#1E4D35" },
  { id: "sunset", name: "Sunset", color: "#5E2D1A" },
  { id: "indigo", name: "Indigo", color: "#2D1E5E" },
  { id: "slate", name: "Slate", color: "#263040" },
];

const APPEARANCE_OPTIONS = [
  { id: "light" as const, label: "Light", icon: SunIcon },
  { id: "dark" as const, label: "Dark", icon: MoonIcon },
  { id: "auto" as const, label: "System", icon: MonitorIcon },
];

const STEPS = ["Welcome", "Account", "Integrations"];

export function SetupWizard({
  initialStep,
}: {
  // "integrations" resumes a wizard whose admin account already exists (the
  // page was reloaded, or similar, while the client-only step state was on
  // Integrations) — see app/(setup)/setup/page.tsx.
  initialStep?: "integrations";
}) {
  // The wizard renders its own ThemeProvider so the appearance step is a live
  // preview — the whole card recolors as you pick a theme / light-dark mode.
  return (
    <ThemeProvider initialAppearanceMode="light" initialTheme="default">
      <WizardInner initialStep={initialStep} />
    </ThemeProvider>
  );
}

function WizardInner({ initialStep }: { initialStep?: "integrations" }) {
  const router = useRouter();
  const { currentTheme, appearanceMode, setTheme, setAppearance } = useTheme();

  // step: 0 welcome, 1 account (form, or the "creating" spinner below it),
  // 2 integrations (only reached once the admin account exists).
  const [step, setStep] = React.useState(
    initialStep === "integrations" ? 2 : 0
  );
  const [brandName, setBrandName] = React.useState("");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  function handleAccountSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    void submitSetup();
  }

  async function submitSetup() {
    setCreating(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          theme: currentTheme,
          appearanceMode,
          brandName: brandName.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        setCreating(false);
        return;
      }

      // Persist the chosen theme locally so the dashboard renders it instantly,
      // before the server settings round-trip.
      try {
        localStorage.setItem("docket_theme", currentTheme);
        localStorage.setItem("docket_appearance", appearanceMode);
      } catch {
        // localStorage may be unavailable (private mode) — non-fatal.
      }

      // Auto sign-in with the new credentials so the session-gated Integrations
      // forms can save. No `callbackURL` on purpose: passing one makes Better
      // Auth set `redirect: true`, and the SDK's redirect plugin then navigates
      // immediately — straight past Integrations, before setStep(2) runs.
      const signIn = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (signIn.error) {
        router.push("/login");
        return;
      }
      setCreating(false);
      setStep(2);
    } catch {
      setError("Something went wrong. Please try again.");
      setCreating(false);
    }
  }

  async function finish() {
    // Best-effort: even if this fails, still proceed to the dashboard rather
    // than trap the user on the wizard — they can be re-prompted to finish
    // integrations from Admin → Integrations later.
    try {
      await fetch("/api/setup/finish", { method: "POST" });
    } catch {
      // Network error — ignore, see comment above.
    }
    router.push("/post-auth");
  }

  return (
    <main className="min-h-screen bg-base-200 flex flex-col items-center justify-center px-4 py-10">
      {/* Stepper dots */}
      <div className="flex items-center gap-2.5 mb-8">
        {STEPS.map((label, i) => (
          <div className="flex items-center gap-2.5" key={label}>
            <span
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex items-center justify-center size-6 rounded-full text-2xs font-semibold transition-colors",
                i < step && "bg-primary text-primary-content",
                i === step &&
                  "bg-primary/10 text-primary ring-2 ring-primary/40",
                i > step && "bg-base-300 text-base-content-muted"
              )}
            >
              {i < step ? (
                <CheckIcon className="size-3.5" weight="bold" />
              ) : (
                i + 1
              )}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px w-6 sm:w-10",
                  i < step ? "bg-primary" : "bg-base-300"
                )}
              />
            )}
          </div>
        ))}
      </div>

      <div
        className={cn(
          "w-full rounded-xl border border-base-300 bg-base-100 shadow-sm p-6 sm:p-8",
          step === 2 ? "max-w-2xl" : "max-w-md"
        )}
      >
        {step === 0 && (
          <WelcomeStep
            appearanceMode={appearanceMode}
            brandName={brandName}
            currentTheme={currentTheme}
            onNext={() => setStep(1)}
            setAppearance={setAppearance}
            setBrandName={setBrandName}
            setTheme={setTheme}
          />
        )}

        {step === 1 && creating && (
          <div className="flex flex-col items-center text-center py-6">
            <CircleNotchIcon className="size-8 text-primary animate-spin" />
            <h1 className="text-lg font-semibold text-base-content mt-4">
              Setting up your workspace…
            </h1>
            <p className="text-sm text-base-content-muted mt-1">
              Creating your admin account and signing you in.
            </p>
          </div>
        )}

        {step === 1 && !creating && (
          <form className="space-y-5" onSubmit={handleAccountSubmit}>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-base-content">
                Let&apos;s set up your account
              </h1>
              <p className="text-sm text-base-content-muted mt-1">
                This is the administrator account for {PRODUCT_NAME}.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">
                Full Name <span className="text-error">*</span>
              </Label>
              <Input
                autoComplete="name"
                autoFocus
                id="name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                value={name}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">
                Email Address{" "}
                <span className="text-base-content-muted font-normal">
                  (will be your login ID)
                </span>{" "}
                <span className="text-error">*</span>
              </Label>
              <Input
                autoComplete="username"
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">
                Password <span className="text-error">*</span>
              </Label>
              <div className="relative">
                <Input
                  autoComplete="new-password"
                  className="pr-10"
                  id="password"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content-muted hover:text-base-content transition-colors"
                  onClick={() => setShowPassword((v) => !v)}
                  type="button"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm">
                Confirm Password <span className="text-error">*</span>
              </Label>
              <Input
                autoComplete="new-password"
                id="confirm"
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                type={showPassword ? "text" : "password"}
                value={confirm}
              />
            </div>

            {error && (
              <p className="text-sm text-error bg-error/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button
                className="gap-1.5"
                onClick={() => {
                  setError(null);
                  setStep(0);
                }}
                type="button"
                variant="ghost"
              >
                <ArrowLeftIcon className="size-4" />
                Previous
              </Button>
              <Button className="gap-1.5" disabled={creating} type="submit">
                Create account
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </form>
        )}

        {step === 2 && <IntegrationsStep onFinish={finish} />}
      </div>

      <p className="text-xs text-base-content-muted mt-6 flex items-center gap-1.5">
        <CheckCircleIcon className="size-3.5" weight="fill" />
        Runs once — this page disappears after your first admin is created.
      </p>
    </main>
  );
}

function WelcomeStep({
  currentTheme,
  appearanceMode,
  brandName,
  setTheme,
  setAppearance,
  setBrandName,
  onNext,
}: {
  currentTheme: string;
  appearanceMode: "light" | "dark" | "auto";
  brandName: string;
  setTheme: (t: string) => void;
  setAppearance: (m: "light" | "dark" | "auto") => void;
  setBrandName: (n: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center size-12 rounded-xl bg-primary text-primary-content mb-3">
          <TicketIcon className="size-6" weight="fill" />
        </div>
        <h1 className="text-xl font-semibold text-base-content">
          Welcome to {PRODUCT_NAME}
        </h1>
        <p className="text-sm text-base-content-muted mt-1">
          Let&apos;s get your instance set up. Pick a look — you can change it
          later in Appearance settings.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="setup-brand-name">
          Brand name{" "}
          <span className="text-base-content-muted font-normal">
            (optional)
          </span>
        </Label>
        <Input
          id="setup-brand-name"
          onChange={(e) => setBrandName(e.target.value)}
          placeholder={PRODUCT_NAME}
          value={brandName}
        />
        <p className="text-xs text-base-content-muted">
          Shown instead of "{PRODUCT_NAME}" in emails and across the app. You
          can add a logo afterward from Appearance settings.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium text-base-content mb-2.5">
          Color theme
        </h2>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          {THEME_OPTIONS.map((theme) => {
            const selected = currentTheme === theme.id;
            return (
              <button
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-center transition-all cursor-pointer",
                  selected
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                    : "border-base-300 bg-base-100 hover:bg-base-300/60"
                )}
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                title={theme.name}
                type="button"
              >
                <span
                  className="size-7 rounded-full flex items-center justify-center border border-black/5 shadow-sm"
                  style={{ backgroundColor: theme.color }}
                >
                  {selected && (
                    <CheckIcon
                      className="size-3.5 text-white drop-shadow"
                      weight="bold"
                    />
                  )}
                </span>
                <span className="text-2xs font-medium text-base-content">
                  {theme.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-base-content mb-2.5">
          Appearance
        </h2>
        <div className="grid grid-cols-3 gap-2.5">
          {APPEARANCE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = appearanceMode === opt.id;
            return (
              <button
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all cursor-pointer",
                  selected
                    ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                    : "border-base-300 bg-base-100 hover:bg-base-300/60"
                )}
                key={opt.id}
                onClick={() => setAppearance(opt.id)}
                type="button"
              >
                <Icon className="size-4 text-base-content" />
                <span className="text-2xs font-medium text-base-content">
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button className="gap-1.5" onClick={onNext} type="button">
          Next
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function IntegrationsStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-base-content">
          Connect your integrations
        </h1>
        <p className="text-sm text-base-content-muted mt-1">
          All optional — {PRODUCT_NAME} works without any of these. Skip now and
          add them later from Admin → Integrations.
        </p>
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
        <SmtpSettingsForm
          collapsible
          defaultOpen
          initial={EMPTY_INTEGRATION_SETTINGS.smtp}
        />
        <GoogleOAuthSettingsForm
          collapsible
          initial={EMPTY_INTEGRATION_SETTINGS.google}
        />
        <PusherChannelsSettingsForm
          collapsible
          initial={EMPTY_INTEGRATION_SETTINGS.pusherChannels}
        />
        <PushNotificationsSettingsForm
          collapsible
          initial={EMPTY_INTEGRATION_SETTINGS}
        />
        <StorageSettingsForm
          collapsible
          initial={EMPTY_INTEGRATION_SETTINGS.storage}
        />
      </div>

      <div className="flex justify-end pt-1">
        <Button className="gap-1.5" onClick={onFinish} type="button">
          Continue to dashboard
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

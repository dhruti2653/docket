"use client";

import { KeyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  IntegrationSettingsSummary,
  PushProvider,
} from "@/lib/integration-settings";
import { IntegrationCard } from "./integration-card";
import { SecretInput } from "./secret-input";

type Initial = Pick<
  IntegrationSettingsSummary,
  "push" | "pusherBeams" | "webPush"
>;

interface Props {
  collapsible?: boolean;
  defaultOpen?: boolean;
  initial: Initial;
}

interface Verification {
  lastTestError: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

type TestedResponse = {
  error?: string;
  tested?: Partial<
    Record<"pusherBeams" | "webPush", { message: string; ok: boolean }>
  >;
};

const PROVIDER_DESCRIPTIONS: Record<PushProvider, string> = {
  pusher:
    "OS-level push to agents for new tickets and customer replies, even with the app closed — delivered through Pusher Beams (dashboard.pusher.com → Beams).",
  webpush:
    "OS-level push to agents for new tickets and customer replies, even with the app closed — delivered with the browser's built-in Web Push. No third-party account; just generate keys and save.",
};

function verificationOf(source: Verification): Verification {
  return {
    lastTestedAt: source.lastTestedAt,
    lastTestOk: source.lastTestOk,
    lastTestError: source.lastTestError,
  };
}

function verificationFromTest(
  tested: { message: string; ok: boolean } | undefined
): Verification {
  return {
    lastTestedAt: tested ? new Date().toISOString() : null,
    lastTestOk: tested ? tested.ok : null,
    lastTestError: tested && !tested.ok ? tested.message : null,
  };
}

/** One card for browser/OS push: the admin picks the provider, and only that
 * provider's fields are shown, saved, tested, or removed. The provider choice
 * itself is saved alongside them, so "Save" is the switch. */
export function PushNotificationsSettingsForm({
  initial,
  collapsible,
  defaultOpen,
}: Props) {
  const [provider, setProvider] = useState<PushProvider>(initial.push.provider);
  const [savedProvider, setSavedProvider] = useState<PushProvider>(
    initial.push.provider
  );

  // Pusher Beams
  const [instanceId, setInstanceId] = useState(initial.pusherBeams.instanceId);
  const [secretKey, setSecretKey] = useState("");
  const [hasSecretKey, setHasSecretKey] = useState(
    initial.pusherBeams.hasSecretKey
  );
  const [beamsVerification, setBeamsVerification] = useState(
    verificationOf(initial.pusherBeams)
  );

  // Web Push
  const [publicKey, setPublicKey] = useState(initial.webPush.publicKey);
  const [privateKey, setPrivateKey] = useState("");
  const [hasPrivateKey, setHasPrivateKey] = useState(
    initial.webPush.hasPrivateKey
  );
  const [webPushVerification, setWebPushVerification] = useState(
    verificationOf(initial.webPush)
  );
  const [savedPublicKey, setSavedPublicKey] = useState(
    initial.webPush.publicKey
  );
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testing, setTesting] = useState(false);

  const isWebPush = provider === "webpush";
  const configured = isWebPush
    ? !!(publicKey && (hasPrivateKey || privateKey))
    : !!(instanceId && hasSecretKey);

  async function patch(body: Record<string, unknown>, message: string) {
    const res = await fetch("/api/admin/integration-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as TestedResponse;
    if (!res.ok) {
      toast.error(data.error ?? "Failed to save.");
      return null;
    }
    toast.success(message);
    return data;
  }

  function reportTested(tested: { message: string; ok: boolean } | undefined) {
    if (tested && !tested.ok) {
      toast.error(`Saved, but verification failed: ${tested.message}`);
    }
  }

  async function save() {
    setSaving(true);
    try {
      if (isWebPush) {
        const keysChanged = publicKey.trim() !== savedPublicKey;
        const data = await patch(
          {
            push: { provider },
            webPush: {
              publicKey,
              privateKey: privateKey || undefined,
            },
          },
          keysChanged && savedPublicKey
            ? "Web Push saved. Agents will re-subscribe on their next page load."
            : "Web Push settings saved."
        );
        if (data) {
          setSavedProvider(provider);
          if (privateKey) {
            setHasPrivateKey(true);
          }
          setPrivateKey("");
          setSavedPublicKey(publicKey.trim());
          setWebPushVerification(verificationFromTest(data.tested?.webPush));
          reportTested(data.tested?.webPush);
        }
      } else {
        const data = await patch(
          {
            push: { provider },
            pusherBeams: { instanceId, secretKey: secretKey || undefined },
          },
          "Pusher Beams settings saved."
        );
        if (data) {
          setSavedProvider(provider);
          if (secretKey) {
            setHasSecretKey(true);
          }
          setSecretKey("");
          setBeamsVerification(verificationFromTest(data.tested?.pusherBeams));
          reportTested(data.tested?.pusherBeams);
        }
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      if (isWebPush) {
        const data = await patch(
          { webPush: { publicKey: "", privateKey: "" } },
          "Web Push settings removed."
        );
        if (data) {
          setPublicKey("");
          setPrivateKey("");
          setHasPrivateKey(false);
          setSavedPublicKey("");
          setWebPushVerification(verificationFromTest(undefined));
        }
      } else {
        const data = await patch(
          { pusherBeams: { instanceId: "", secretKey: "" } },
          "Pusher Beams settings removed."
        );
        if (data) {
          setInstanceId("");
          setSecretKey("");
          setHasSecretKey(false);
          setBeamsVerification(verificationFromTest(undefined));
        }
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch(
        isWebPush
          ? "/api/admin/integration-settings/web-push/test"
          : "/api/admin/integration-settings/pusher-beams/test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isWebPush
              ? { publicKey, privateKey: privateKey || undefined }
              : { instanceId, secretKey: secretKey || undefined }
          ),
        }
      );
      const result = (await res.json().catch(() => ({}))) as {
        message?: string;
        ok?: boolean;
      };
      const ok = res.ok && !!result.ok;
      const verification = {
        lastTestedAt: new Date().toISOString(),
        lastTestOk: ok,
        lastTestError: ok ? null : (result.message ?? "Test failed."),
      };
      if (isWebPush) {
        setWebPushVerification(verification);
      } else {
        setBeamsVerification(verification);
      }
      if (ok) {
        toast.success(result.message ?? "Connection succeeded.");
      } else {
        toast.error(result.message ?? "Connection test failed.");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setTesting(false);
    }
  }

  async function generateKeys() {
    setConfirmRegenerate(false);
    setGenerating(true);
    try {
      const res = await fetch(
        "/api/admin/integration-settings/web-push/generate-keys",
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        privateKey?: string;
        publicKey?: string;
      };
      if (!(res.ok && data.publicKey && data.privateKey)) {
        toast.error(data.error ?? "Failed to generate keys.");
        return;
      }
      setPublicKey(data.publicKey);
      setPrivateKey(data.privateKey);
      toast.success("Keys generated — press Save to apply them.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <IntegrationCard
        collapsible={collapsible}
        configured={configured}
        defaultOpen={defaultOpen}
        description={PROVIDER_DESCRIPTIONS[provider]}
        note={
          isWebPush
            ? "Web Push needs HTTPS in production (localhost is exempt). Agents are asked to allow notifications on their next page load. On iOS, Web Push works only after the app is added to the Home Screen."
            : undefined
        }
        onRemove={remove}
        onSave={save}
        onTest={testConnection}
        removing={removing}
        saving={saving}
        testing={testing}
        title="Push Notifications"
        verification={isWebPush ? webPushVerification : beamsVerification}
      >
        <div className="space-y-1.5">
          <Label htmlFor="push-provider">Provider</Label>
          <Select
            disabled={saving}
            onValueChange={(v) => setProvider(v as PushProvider)}
            value={provider}
          >
            <SelectTrigger className="h-11 w-full" id="push-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pusher">Pusher Beams</SelectItem>
              <SelectItem value="webpush">
                Web Push (built-in, no third party)
              </SelectItem>
            </SelectContent>
          </Select>
          {provider !== savedProvider && (
            <p className="text-xs text-base-content-muted">
              Press Save to switch providers. Agents move over on their next
              page load.
            </p>
          )}
        </div>

        {isWebPush ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="webpush-public-key">VAPID Public Key</Label>
                <Button
                  className="gap-1.5"
                  disabled={saving || generating}
                  onClick={() =>
                    savedPublicKey ? setConfirmRegenerate(true) : generateKeys()
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <KeyIcon className="size-4" />
                  {generating ? "Generating…" : "Generate keys"}
                </Button>
              </div>
              <Input
                className="font-mono text-xs"
                disabled={saving}
                id="webpush-public-key"
                onChange={(e) => setPublicKey(e.target.value)}
                value={publicKey}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="webpush-private-key">VAPID Private Key</Label>
              <SecretInput
                disabled={saving}
                hasSavedValue={hasPrivateKey}
                id="webpush-private-key"
                onChange={setPrivateKey}
                value={privateKey}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="beams-instance-id">Instance ID</Label>
              <Input
                disabled={saving}
                id="beams-instance-id"
                onChange={(e) => setInstanceId(e.target.value)}
                value={instanceId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="beams-secret-key">Secret Key</Label>
              <SecretInput
                disabled={saving}
                hasSavedValue={hasSecretKey}
                id="beams-secret-key"
                onChange={setSecretKey}
                value={secretKey}
              />
            </div>
          </div>
        )}
      </IntegrationCard>

      <Dialog onOpenChange={setConfirmRegenerate} open={confirmRegenerate}>
        <DialogContent className="rounded-xl max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-amber-100">
              <KeyIcon className="size-5 text-amber-600" />
            </div>
            <DialogTitle className="text-base-content text-center">
              Replace the VAPID keys?
            </DialogTitle>
            <DialogDescription className="text-base-content-muted text-center">
              Once saved, every agent&rsquo;s existing browser subscription
              stops working. Each agent is re-subscribed automatically the next
              time they open the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              className="flex-1 border-base-300 text-base-content rounded-md"
              onClick={() => setConfirmRegenerate(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md"
              onClick={generateKeys}
            >
              Generate new keys
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

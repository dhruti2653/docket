"use client";

import {
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  KeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { formatDateTime } from "@/lib/utils";

interface ApiKeyRow {
  createdAt: Date;
  createdByName: string;
  id: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  name: string;
  portalUrlTemplate: string | null;
  revokedAt: Date | null;
}

interface Props {
  initialKeys: ApiKeyRow[];
}

export function ApiKeysManager({ initialKeys }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [portalUrlTemplate, setPortalUrlTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const [editTarget, setEditTarget] = useState<ApiKeyRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editPortalUrlTemplate, setEditPortalUrlTemplate] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openAdd() {
    setName("");
    setPortalUrlTemplate("");
    setError(null);
    setCreatedKey(null);
    setCopied(false);
    setAddOpen(true);
  }

  function closeAdd() {
    setAddOpen(false);
    setCreatedKey(null);
    if (createdKey) {
      router.refresh();
    }
  }

  async function handleCreate() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, portalUrlTemplate }),
      });
      const data = (await res.json()) as { error?: string; rawKey?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to create key.");
        return;
      }
      setCreatedKey(data.rawKey ?? null);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(key: ApiKeyRow) {
    setEditTarget(key);
    setEditName(key.name);
    setEditPortalUrlTemplate(key.portalUrlTemplate ?? "");
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editTarget) {
      return;
    }
    setEditError(null);
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/api-keys/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          portalUrlTemplate: editPortalUrlTemplate,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditError(data.error ?? "Failed to save.");
        return;
      }
      setEditTarget(null);
      router.refresh();
    } catch {
      setEditError("Network error.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) {
      return;
    }
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
  }

  async function handleRevoke() {
    if (!revokeTarget) {
      return;
    }
    setRevoking(true);
    try {
      const res = await fetch(`/api/admin/api-keys/${revokeTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setRevoking(false);
        return;
      }
      setRevokeTarget(null);
      router.refresh();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-base-content">
            API Keys
          </h2>
          <p className="text-xs text-base-content-muted mt-0.5">
            Let external websites create tickets programmatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Button
            asChild
            className="border-base-300 text-base-content hover:bg-base-300 rounded-md gap-1.5"
            size="sm"
            variant="outline"
          >
            <a
              download
              href="/api/admin/api-keys/postman"
              title="Downloads a Postman collection pre-filled with this instance's URL"
            >
              <DownloadSimpleIcon className="size-4" />
              Postman Collection
            </a>
          </Button>
          <Button
            asChild
            className="border-base-300 text-base-content hover:bg-base-300 rounded-md gap-1.5"
            size="sm"
            variant="outline"
          >
            <Link href="/admin/api-keys/docs">
              <BookOpenIcon className="size-4" />
              View Docs
            </Link>
          </Button>
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-content rounded-md gap-1.5"
            onClick={openAdd}
            size="sm"
          >
            <PlusIcon className="size-4" />
            Create API Key
          </Button>
        </div>
      </div>

      <div className="bg-base-100 rounded-xl border border-base-300 shadow-soft overflow-hidden">
        {initialKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <KeyIcon className="size-8 text-base-content-muted mb-3" />
            <p className="text-sm font-medium text-base-content">
              No API keys yet
            </p>
            <p className="text-xs text-base-content-muted mt-1">
              Create one to let an external site submit tickets via the API.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-300 bg-base-300/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide">
                    Key
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide hidden md:table-cell">
                    Created by
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide hidden lg:table-cell">
                    Last used
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-base-content-muted uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-base-300/50">
                {initialKeys.map((k) => (
                  <tr
                    className="hover:bg-base-300/30 transition-colors"
                    key={k.id}
                  >
                    <td className="px-4 py-3 font-medium text-base-content">
                      {k.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-base-content-muted">
                      {k.keyPrefix}…
                    </td>
                    <td className="px-4 py-3 text-xs text-base-content-muted hidden md:table-cell">
                      {k.createdByName}
                    </td>
                    <td className="px-4 py-3 text-xs text-base-content-muted hidden lg:table-cell">
                      {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                          k.revokedAt
                            ? "bg-red-50 border-red-200 text-red-600"
                            : "bg-green-50 border-green-200 text-green-700"
                        }`}
                      >
                        {k.revokedAt ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          className="h-8 border-base-300 text-base-content hover:bg-base-300 rounded-md"
                          onClick={() => openEdit(k)}
                          size="sm"
                          variant="outline"
                        >
                          <PencilSimpleIcon className="size-3.5" />
                        </Button>
                        {!k.revokedAt && (
                          <Button
                            className="h-8 border-red-200 text-red-600 hover:bg-red-50 rounded-md"
                            onClick={() => setRevokeTarget(k)}
                            size="sm"
                            variant="outline"
                          >
                            <TrashIcon className="size-3.5" />
                            Revoke
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog onOpenChange={(open) => !open && closeAdd()} open={addOpen}>
        <DialogContent className="rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
          {createdKey ? (
            <>
              <DialogHeader className="pr-8">
                <DialogTitle className="text-base-content">
                  API key created
                </DialogTitle>
                <DialogDescription className="text-base-content-muted">
                  Copy this key now — it won't be shown again.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-md border border-base-300 bg-base-300 px-3 py-2">
                <code className="text-xs text-base-content break-all flex-1">
                  {createdKey}
                </code>
                <button
                  className="shrink-0 text-base-content-muted hover:text-base-content"
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? (
                    <CheckIcon className="size-4 text-green-600" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                </button>
              </div>
              <DialogFooter>
                <Button
                  className="w-full sm:w-auto sm:flex-1 bg-primary hover:bg-primary/90 text-primary-content rounded-md"
                  onClick={closeAdd}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader className="pr-8">
                <DialogTitle className="text-base-content">
                  Create API Key
                </DialogTitle>
                <DialogDescription className="text-base-content-muted">
                  Name it after where it'll be used, e.g. "Marketing site".
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label
                  className="text-xs font-medium text-base-content-muted"
                  htmlFor="api-key-name"
                >
                  Name
                </Label>
                <Input
                  className="rounded-md"
                  id="api-key-name"
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Marketing site"
                  value={name}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  className="text-xs font-medium text-base-content-muted"
                  htmlFor="api-key-portal-url"
                >
                  Customer portal URL{" "}
                  <span className="text-base-content-muted font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  className="rounded-md font-mono text-xs"
                  id="api-key-portal-url"
                  onChange={(e) => setPortalUrlTemplate(e.target.value)}
                  placeholder="https://myapp.com/support/{{ticketId}}"
                  value={portalUrlTemplate}
                />
                <p className="text-xs leading-relaxed break-words text-base-content-muted">
                  If your own site has its own support page, tickets created
                  through this key link there instead of Docket's portal.
                  Placeholders: <code>{"{{ticketId}}"}</code>,{" "}
                  <code>{"{{token}}"}</code>.
                </p>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <DialogFooter className="gap-2">
                <Button
                  className="w-full sm:w-auto sm:flex-1 border-base-300 text-base-content rounded-md"
                  disabled={saving}
                  onClick={() => setAddOpen(false)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  className="w-full sm:w-auto sm:flex-1 bg-primary hover:bg-primary/90 text-primary-content rounded-md"
                  disabled={saving || !name.trim()}
                  onClick={handleCreate}
                >
                  {saving ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        onOpenChange={(open) => !open && setEditTarget(null)}
        open={editTarget !== null}
      >
        <DialogContent className="rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base-content">
              Edit API Key
            </DialogTitle>
            <DialogDescription className="text-base-content-muted">
              The key itself never changes — only its name and portal link.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label
              className="text-xs font-medium text-base-content-muted"
              htmlFor="edit-api-key-name"
            >
              Name
            </Label>
            <Input
              className="rounded-md"
              id="edit-api-key-name"
              onChange={(e) => setEditName(e.target.value)}
              value={editName}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              className="text-xs font-medium text-base-content-muted"
              htmlFor="edit-api-key-portal-url"
            >
              Customer portal URL{" "}
              <span className="text-base-content-muted font-normal">
                (optional)
              </span>
            </Label>
            <Input
              className="rounded-md font-mono text-xs"
              id="edit-api-key-portal-url"
              onChange={(e) => setEditPortalUrlTemplate(e.target.value)}
              placeholder="https://myapp.com/support/{{ticketId}}"
              value={editPortalUrlTemplate}
            />
            <p className="text-xs leading-relaxed break-words text-base-content-muted">
              Leave blank to use Docket's own customer portal. Placeholders:{" "}
              <code>{"{{ticketId}}"}</code>, <code>{"{{token}}"}</code>.
            </p>
          </div>
          {editError && <p className="text-xs text-red-600">{editError}</p>}
          <DialogFooter className="gap-2">
            <Button
              className="w-full sm:w-auto sm:flex-1 border-base-300 text-base-content rounded-md"
              disabled={editSaving}
              onClick={() => setEditTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto sm:flex-1 bg-primary hover:bg-primary/90 text-primary-content rounded-md"
              disabled={editSaving || !editName.trim()}
              onClick={handleEditSave}
            >
              {editSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <Dialog
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        open={revokeTarget !== null}
      >
        <DialogContent className="rounded-xl max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-red-100">
              <WarningCircleIcon className="size-5 text-red-600" />
            </div>
            <DialogTitle className="text-base-content text-center">
              Revoke &ldquo;{revokeTarget?.name}&rdquo;?
            </DialogTitle>
            <DialogDescription className="text-base-content-muted text-center">
              Any integration using this key will immediately start getting 401
              errors. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              className="w-full sm:w-auto sm:flex-1 border-base-300 text-base-content rounded-md"
              disabled={revoking}
              onClick={() => setRevokeTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto sm:flex-1 bg-red-600 hover:bg-red-700 text-white rounded-md"
              disabled={revoking}
              onClick={handleRevoke}
            >
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

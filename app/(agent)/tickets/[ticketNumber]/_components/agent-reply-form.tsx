"use client";

import {
  LockSimpleIcon,
  PaperclipIcon,
  PaperPlaneTiltIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LocalDateTime } from "@/components/common/local-datetime";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/common/rich-text-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isRichTextEmpty } from "@/lib/rich-text";
import { scrollChatToBottom } from "@/lib/scroll-chat";
import { cn } from "@/lib/utils";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/zip",
  "text/plain",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Autosave fires this long after the last keystroke / internal-note toggle.
const DRAFT_SAVE_DELAY_MS = 1000;
// A failed save is retried after this long, even if the agent stops typing.
const DRAFT_RETRY_DELAY_MS = 5000;
// Browsers reject keepalive requests whose body exceeds 64 KiB.
const KEEPALIVE_BODY_LIMIT = 60_000;
const EMPTY_DRAFT_KEY = "empty";

type DraftStatus = "idle" | "saving" | "saved" | "error";

/** Identity of a draft's saveable state — compared against the last
 * successfully saved key so unchanged drafts are never re-sent. Every empty
 * composer maps to one key, so toggling "Internal note" on an empty box
 * doesn't create a draft. */
function draftKey(content: string, isInternal: boolean) {
  return isRichTextEmpty(content)
    ? EMPTY_DRAFT_KEY
    : JSON.stringify([content, isInternal]);
}

interface Props {
  cannedResponses?: { id: string; title: string; content: string }[];
  /** The agent's own saved, unsent reply for this ticket (see
   * db/schema/reply-drafts.ts) — restored into the composer on load. */
  initialDraft?: {
    content: string;
    isInternal: boolean;
    updatedAt: string;
  } | null;
  sendReplyOnEnter: boolean;
  ticketId: string;
  totalAttachments: number;
}

export function AgentReplyForm({
  ticketId,
  totalAttachments,
  cannedResponses,
  initialDraft,
  sendReplyOnEnter,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  const [isInternal, setIsInternal] = useState(
    initialDraft?.isInternal ?? false
  );
  const [content, setContent] = useState(initialDraft?.content ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const maxNewFiles = Math.max(0, 5 - totalAttachments);

  // ── Draft autosave ──
  // The reply is saved server-side per (ticket, agent) so it survives a
  // refresh, closing the tab, or coming back from another device days later.
  const [draftStatus, setDraftStatus] = useState<DraftStatus>(
    initialDraft ? "saved" : "idle"
  );
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(
    initialDraft?.updatedAt ?? null
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const lastSavedKeyRef = useRef(
    initialDraft
      ? draftKey(initialDraft.content, initialDraft.isInternal)
      : EMPTY_DRAFT_KEY
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  // Latest values for the pagehide/unmount flush, which can't read state.
  const latestRef = useRef({ content, isInternal });
  latestRef.current = { content, isInternal };

  const saveDraftRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Saves are chained, never concurrent: two PUTs in flight can land out of
  // order and leave an older version as the stored draft. Each save sends
  // whatever the composer holds when it *starts*, so a queued save never
  // writes stale text.
  const saveDraft = useCallback(() => {
    async function run() {
      const { content: c, isInternal: i } = latestRef.current;
      const key = draftKey(c, i);
      if (key === lastSavedKeyRef.current) {
        return;
      }
      setDraftStatus("saving");
      try {
        const res = await fetch(`/api/tickets/${ticketId}/draft`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: c, isInternal: i }),
        });
        if (!res.ok) {
          throw new Error("save failed");
        }
        const data = (await res.json()) as {
          draft: { updatedAt: string } | null;
        };
        lastSavedKeyRef.current = key;
        setDraftSavedAt(data.draft?.updatedAt ?? null);
        setDraftStatus(data.draft ? "saved" : "idle");
      } catch {
        setDraftStatus("error");
        // Retry on its own — otherwise nothing re-saves until the next
        // keystroke. A newer keystroke's timer takes precedence.
        if (!saveTimerRef.current) {
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            saveDraftRef.current();
          }, DRAFT_RETRY_DELAY_MS);
        }
      }
    }
    const promise = (inFlightSaveRef.current ?? Promise.resolve()).then(run);
    inFlightSaveRef.current = promise;
    promise.finally(() => {
      if (inFlightSaveRef.current === promise) {
        inFlightSaveRef.current = null;
      }
    });
    return promise;
  }, [ticketId]);
  saveDraftRef.current = saveDraft;

  /** Cancels a scheduled autosave and waits out one already on the wire, so
   * a late PUT can't land after a send/discard and resurrect the draft. */
  async function settleDraftSaves() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await inFlightSaveRef.current;
  }

  useEffect(() => {
    if (draftKey(content, isInternal) === lastSavedKeyRef.current) {
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveDraft();
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [content, isInternal, saveDraft]);

  // Flush an unsaved change immediately when the agent leaves — closing the
  // tab (pagehide) or navigating to another page/ticket (unmount). keepalive
  // lets the request outlive the page.
  useEffect(() => {
    function flush() {
      const { content: c, isInternal: i } = latestRef.current;
      const key = draftKey(c, i);
      if (key === lastSavedKeyRef.current) {
        return;
      }
      lastSavedKeyRef.current = key;
      const body = JSON.stringify({ content: c, isInternal: i });
      fetch(`/api/tickets/${ticketId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        // Over the limit a keepalive request is rejected outright; a plain one
        // still completes for in-app navigation (the page stays alive).
        keepalive: new TextEncoder().encode(body).length < KEEPALIVE_BODY_LIMIT,
      }).catch(() => {
        // Best effort — the page is going away; nothing left to report to.
      });
    }
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [ticketId]);

  async function handleDiscardDraft() {
    setDiscardOpen(false);
    await settleDraftSaves();
    try {
      const res = await fetch(`/api/tickets/${ticketId}/draft`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("discard failed");
      }
    } catch {
      toast.error("Couldn't discard the draft. Please try again.");
      return;
    }
    lastSavedKeyRef.current = EMPTY_DRAFT_KEY;
    setContent("");
    setIsInternal(false);
    setDraftSavedAt(null);
    setDraftStatus("idle");
    toast.success("Draft discarded.");
  }

  // Object URLs for image thumbnails in the compose box — created when the
  // file list changes and revoked on cleanup so they never leak.
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const map = new Map<File, string>();
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        map.set(f, URL.createObjectURL(f));
      }
    }
    setPreviews(map);
    return () => {
      for (const url of map.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [files]);

  function addFiles(newFiles: File[]) {
    const combined = [...files, ...newFiles];
    if (combined.length > maxNewFiles) {
      setError(`Only ${maxNewFiles} more file(s) allowed.`);
      return;
    }
    const oversized = combined.find((f) => f.size > MAX_FILE_SIZE);
    if (oversized) {
      setError(`"${oversized.name}" exceeds 10 MB.`);
      return;
    }
    const badType = combined.find((f) => !ALLOWED_TYPES.has(f.type));
    if (badType) {
      setError(`"${badType.name}" is not an allowed type.`);
      return;
    }
    setFiles(combined);
    setError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    addFiles(selected);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  }

  function handleEnterSubmit() {
    if (!submitting) {
      formRef.current?.requestSubmit();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Allow sending with just an attachment (no text) — only block when both
    // the message and the attachment list are empty.
    if (isRichTextEmpty(content) && files.length === 0) {
      setError("Write a message or attach a file before sending.");
      return;
    }
    setError(null);
    setSubmitting(true);
    await settleDraftSaves();
    try {
      const body = new FormData();
      body.append("content", content);
      body.append("isInternal", String(isInternal));
      for (const f of files) {
        body.append("attachments", f);
      }

      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        const msg = data.error ?? "Failed to send.";
        setError(msg);
        toast.error(msg);
        return;
      }
      const wasInternal = isInternal;
      // The comments route already deleted the server-side draft.
      lastSavedKeyRef.current = EMPTY_DRAFT_KEY;
      setDraftSavedAt(null);
      setDraftStatus("idle");
      setContent("");
      setFiles([]);
      // Reset to a public reply after every send — otherwise a toggle left on
      // from a prior internal note silently keeps sending later replies as
      // internal, so the customer never sees them and the ticket's waiting
      // state never flips to "Waiting for customer".
      setIsInternal(false);
      editorRef.current?.focus();
      toast.success(
        wasInternal ? "Internal note added." : "Reply sent to customer."
      );
      router.refresh();
      scrollChatToBottom();
    } catch {
      setError("Network error. Please try again.");
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit} ref={formRef}>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Slack-style compose box: text input on top (with its own formatting
          toolbar), a divided action bar at the bottom — attach + internal-note
          toggle on the left, send on the right. */}
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-base-100 transition-[color,border-color,box-shadow] focus-within:ring-2",
          isInternal
            ? "border-amber-200 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/40 focus-within:border-amber-400 focus-within:ring-amber-400/20"
            : "border-base-300 focus-within:border-primary focus-within:ring-primary/20"
        )}
      >
        <RichTextEditor
          cannedResponses={cannedResponses}
          className="rounded-none border-0 bg-transparent focus-within:ring-0"
          compact
          disabled={submitting}
          onChange={setContent}
          onFilesDropped={maxNewFiles > 0 ? addFiles : undefined}
          onSubmit={handleEnterSubmit}
          placeholder={
            isInternal
              ? "Write an internal note (only visible to agents)…"
              : "Write a reply to the customer…"
          }
          ref={editorRef}
          sendOnEnter={sendReplyOnEnter}
          tone={isInternal ? "warning" : "default"}
          value={content}
        />

        {/* Uploaded files — thumbnails inside the box (Slack-style): image
            previews for images, a compact icon card for everything else. */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {files.map((f, i) => {
              const preview = previews.get(f);
              return (
                <div
                  className="group relative"
                  key={`${f.name}-${f.size}-${f.lastModified}`}
                >
                  {preview ? (
                    // biome-ignore lint/performance/noImgElement: local object-URL preview of a not-yet-uploaded file, not a remote asset
                    <img
                      alt={f.name}
                      className="size-16 rounded-lg border border-base-300 object-cover"
                      src={preview}
                    />
                  ) : (
                    <div className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-base-300 bg-base-300 px-1.5 text-center">
                      <PaperclipIcon className="size-4 shrink-0 text-base-content-muted" />
                      <span className="w-full truncate text-2xs text-base-content-muted">
                        {f.name}
                      </span>
                    </div>
                  )}
                  <button
                    aria-label={`Remove ${f.name}`}
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-base-content text-base-200 shadow-sm transition-transform hover:scale-110"
                    onClick={() => removeFile(i)}
                    type="button"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom action bar */}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {/* Attach */}
            <label
              className={cn(
                "flex size-8 items-center justify-center rounded-md transition-colors",
                maxNewFiles > 0 && !submitting
                  ? "text-base-content hover:bg-base-300 cursor-pointer"
                  : "text-base-content-muted/40 cursor-not-allowed"
              )}
              title={
                maxNewFiles > 0 ? "Attach file" : "Attachment limit reached"
              }
            >
              <PaperclipIcon className="size-4" />
              <input
                accept=".jpg,.jpeg,.png,.pdf,.zip,.txt"
                className="hidden"
                disabled={submitting || maxNewFiles === 0}
                multiple
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />
            </label>

            {/* Internal-note toggle */}
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                isInternal
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/70 dark:text-amber-100"
                  : "text-base-content hover:bg-base-300"
              )}
              onClick={() => setIsInternal((v) => !v)}
              onMouseDown={(e) => e.preventDefault()}
              title="Toggle internal note — only visible to agents"
              type="button"
            >
              <LockSimpleIcon className="size-3.5" />
              Internal note
            </button>

            {/* Draft state + discard */}
            {(draftStatus !== "idle" || !isRichTextEmpty(content)) && (
              <div className="ml-1 flex min-w-0 items-center gap-0.5">
                <span
                  aria-live="polite"
                  className={cn(
                    "truncate text-xs",
                    draftStatus === "error"
                      ? "text-red-600"
                      : "text-base-content-muted"
                  )}
                >
                  {draftStatus === "saving" && "Saving draft…"}
                  {draftStatus === "error" && "Couldn't save draft"}
                  {draftStatus === "saved" && (
                    <>
                      Draft saved · <LocalDateTime date={draftSavedAt} />
                    </>
                  )}
                </span>
                <button
                  aria-label="Discard draft"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-base-content-muted transition-colors hover:bg-base-300 hover:text-red-600 disabled:opacity-40"
                  disabled={submitting}
                  onClick={() => setDiscardOpen(true)}
                  onMouseDown={(e) => e.preventDefault()}
                  title="Discard draft"
                  type="button"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Send */}
          <Button
            className={cn(
              "size-8 shrink-0 rounded-lg p-0",
              isInternal
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-primary hover:bg-primary/90 text-primary-content"
            )}
            disabled={
              submitting || (isRichTextEmpty(content) && files.length === 0)
            }
            title={isInternal ? "Add note" : "Send reply"}
            type="submit"
          >
            <PaperPlaneTiltIcon className="size-4" weight="fill" />
          </Button>
        </div>
      </div>

      {/* Discard-draft confirmation */}
      <Dialog onOpenChange={setDiscardOpen} open={discardOpen}>
        <DialogContent className="rounded-xl max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-red-100">
              <TrashIcon className="size-5 text-red-600" />
            </div>
            <DialogTitle className="text-base-content text-center">
              Discard this draft?
            </DialogTitle>
            <DialogDescription className="text-base-content-muted text-center">
              Your unsent reply will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              className="flex-1 border-base-300 text-base-content rounded-md"
              onClick={() => setDiscardOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-md"
              onClick={handleDiscardDraft}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

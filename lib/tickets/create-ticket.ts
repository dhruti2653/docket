import { createId } from "@paralleldrive/cuid2";
import { and, eq, or } from "drizzle-orm";
import { ADMIN_ROLE, AGENT_ROLE } from "@/config/platform";
import { ticketActivity, ticketAttachments, tickets, user } from "@/db/schema";
import {
  getCustomFields,
  setCustomFieldValues,
  validateCustomFieldInput,
} from "@/lib/custom-fields";
import { findOrCreateCustomer } from "@/lib/customers";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { ticketCreatedTemplate } from "@/lib/email/templates/ticket-created";
import { env } from "@/lib/env";
import { createNotifications } from "@/lib/notifications";
import { publishPushToUsers } from "@/lib/push";
import { publishTicketCreated } from "@/lib/realtime";
import { richTextToPlainText } from "@/lib/rich-text";
import { storage } from "@/lib/storage";
import {
  getDefaultPriority,
  getDefaultStatus,
  getTicketCategories,
  getTicketPriorities,
} from "@/lib/ticket-config";
import { resolveTicketPortalUrl } from "@/lib/tickets/portal-url";
import {
  dispatchWebhookEvent,
  ticketPayloadData,
} from "@/lib/webhooks/dispatch";

export interface TicketSubmissionAttachment {
  filename: string;
  fileSize: number;
  id: string;
  mimeType: string;
  storageKey: string;
}

export interface TicketSubmission {
  /** Required when source is "api" — used for activity attribution. */
  apiKeyId?: string;
  apiKeyName?: string;
  /** Already-uploaded files (the caller owns the upload step — this
   * function only inserts the DB rows and rolls storage back on failure). */
  attachments?: TicketSubmissionAttachment[];
  category: string;
  /** Optional `{ [field.key]: rawValue }` map — validated against the
   * admin-defined custom fields (see lib/custom-fields.ts). */
  customFields?: Record<string, unknown>;
  description: string;
  email: string;
  /** Pre-generated ticket id — needed by callers (the portal route) that
   * upload attachments to a `tickets/{id}/...` storage key *before* calling
   * this function. Generated internally when omitted. */
  id?: string;
  name: string;
  /** Optional — falls back to the platform's default priority when omitted. */
  priority?: string;
  source: "portal" | "api";
  subject: string;
}

export type CreateTicketResult =
  | {
      ok: true;
      id: string;
      ticketNumber: number;
      customerToken: string;
      status: string;
      portalUrl: string;
    }
  | { ok: false; error: string; httpStatus: number };

interface ValidatedFields {
  category: string;
  customFieldValues: Array<{ fieldId: string; value: string | null }>;
  description: string;
  email: string;
  name: string;
  priority: string;
  status: string;
  subject: string;
}

type ValidationResult =
  | { ok: true; fields: ValidatedFields }
  | { ok: false; error: string; httpStatus: number };

/** Field-format and slug validation only, no DB writes — exposed separately so a
 * caller doing I/O first (the portal uploads attachments before creating) isn't
 * left discovering "invalid category" with files already in storage.
 * `description` must already be Tiptap JSON; its length is checked flattened. */
export async function validateTicketSubmission(input: {
  name: string;
  email: string;
  subject: string;
  description: string;
  category: string;
  priority?: string;
  customFields?: Record<string, unknown>;
}): Promise<ValidationResult> {
  const name = input.name.trim();
  const email = input.email.trim();
  const subject = input.subject.trim();
  const description = input.description;
  const descriptionText = richTextToPlainText(description).trim();
  const category = input.category.trim();

  if (!name || name.length < 2 || name.length > 100) {
    return {
      ok: false,
      error: "Name must be 2–100 characters.",
      httpStatus: 400,
    };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Invalid email address.", httpStatus: 400 };
  }
  if (!subject || subject.length < 5 || subject.length > 200) {
    return {
      ok: false,
      error: "Subject must be 5–200 characters.",
      httpStatus: 400,
    };
  }
  if (
    !descriptionText ||
    descriptionText.length < 10 ||
    descriptionText.length > 5000
  ) {
    return {
      ok: false,
      error: "Description must be 10–5000 characters.",
      httpStatus: 400,
    };
  }

  const [
    validCategories,
    validPriorities,
    defaultStatus,
    defaultPriority,
    customFields,
  ] = await Promise.all([
    getTicketCategories(),
    getTicketPriorities(),
    getDefaultStatus(),
    getDefaultPriority(),
    getCustomFields(),
  ]);

  if (!validCategories.some((c) => c.slug === category)) {
    return { ok: false, error: "Invalid category.", httpStatus: 400 };
  }

  let priority = defaultPriority?.slug ?? "normal";
  if (input.priority) {
    if (!validPriorities.some((p) => p.slug === input.priority)) {
      return { ok: false, error: "Invalid priority.", httpStatus: 400 };
    }
    priority = input.priority;
  }

  // `partial: true` when the caller never sent customFields at all (the portal
  // has no UI for them). Required fields are enforced only when a `customFields`
  // object arrives, so adding one can't retroactively break existing callers.
  const validatedCustomFields = validateCustomFieldInput(
    customFields,
    input.customFields,
    { partial: input.customFields === undefined }
  );
  if (!validatedCustomFields.ok) {
    return validatedCustomFields;
  }

  return {
    ok: true,
    fields: {
      name,
      email,
      subject,
      description,
      category,
      priority,
      status: defaultStatus?.slug ?? "open",
      customFieldValues: validatedCustomFields.values,
    },
  };
}

/** Validates and creates a ticket plus every side effect (confirmation email,
 * agent notifications, realtime refresh). Shared by the customer portal and the
 * public API so rules and notifications can't drift between the two. */
export async function createTicketFromSubmission(
  input: TicketSubmission
): Promise<CreateTicketResult> {
  const validated = await validateTicketSubmission(input);
  if (!validated.ok) {
    return validated;
  }
  const {
    name,
    email,
    subject,
    description,
    category,
    priority,
    status,
    customFieldValues,
  } = validated.fields;

  const ticketId = input.id ?? createId();
  const customerToken = createId();
  const now = new Date();
  const attachments = input.attachments ?? [];

  try {
    const customer = await findOrCreateCustomer(name, email);
    const [inserted] = await db
      .insert(tickets)
      .values({
        id: ticketId,
        subject,
        description,
        category,
        status,
        priority,
        customerId: customer.id,
        customerToken,
        source: input.source,
        apiKeyId: input.apiKeyId,
        // A brand-new ticket is awaiting the team's first reply — the SLA
        // response clock starts ticking from creation (see lib/sla.ts).
        awaitingReply: true,
        pendingReplies: 1,
        waitingSince: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ ticketNumber: tickets.ticketNumber });

    if (customFieldValues.length > 0) {
      await setCustomFieldValues(ticketId, customFieldValues);
    }

    if (attachments.length > 0) {
      await db.insert(ticketAttachments).values(
        attachments.map((a) => ({
          id: a.id,
          ticketId,
          filename: a.filename,
          storageKey: a.storageKey,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          uploadedByName: name,
          uploadedByRole: "customer",
          createdAt: now,
        }))
      );
    }

    const isApi = input.source === "api";
    await db.insert(ticketActivity).values({
      id: createId(),
      ticketId,
      actorName: isApi ? `API: ${input.apiKeyName}` : name,
      actorRole: isApi ? "api" : "customer",
      action: "ticket_created",
      createdAt: now,
    });

    // Enqueue ticket.created email (non-blocking)
    const ticketUrl = await resolveTicketPortalUrl(
      ticketId,
      customerToken,
      input.apiKeyId ?? null
    );
    const myTicketsUrl = `${env.NEXT_PUBLIC_APP_URL}/my-tickets`;
    ticketCreatedTemplate({
      customerName: name,
      ticketNumber: inserted.ticketNumber,
      ticketSubject: subject,
      ticketUrl,
      myTicketsUrl,
    })
      .then(({ subject: emailSubject, html, text }) =>
        enqueueEmail({
          to: email,
          subject: emailSubject,
          html,
          text,
          category: "ticket",
        })
      )
      .catch((err) => console.error("[ticket.created email]", err));

    // Notify agents in-app + push — a brand-new ticket has no assigned
    // agent yet, so every active agent/admin gets pinged.
    const agents = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          or(eq(user.role, AGENT_ROLE), eq(user.role, ADMIN_ROLE)),
          eq(user.banned, false)
        )
      );
    const recipientIds = agents.map((a) => a.id);
    const notifTitle = `New ticket #${inserted.ticketNumber} from ${name}`;

    await createNotifications(recipientIds, {
      type: "ticket_created",
      title: notifTitle,
      body: subject,
      ticketId,
      ticketNumber: inserted.ticketNumber,
    }).catch((err) => console.error("[notification.ticket_created]", err));

    await publishPushToUsers(recipientIds, {
      title: notifTitle,
      body: subject,
      deepLink: `${env.NEXT_PUBLIC_APP_URL}/tickets/${inserted.ticketNumber}`,
      tag: `ticket-${inserted.ticketNumber}`,
    }).catch((err) => console.error("[push.ticket_created]", err));

    // Live-refresh any agent currently viewing the ticket list (no-op unless
    // Pusher Channels is configured).
    await publishTicketCreated().catch((err) =>
      console.error("[realtime.ticket_created]", err)
    );

    // Notify any configured outbound webhooks (no-op if none are configured).
    await dispatchWebhookEvent("ticket.created", "ticket", ticketId, {
      ticket: ticketPayloadData({
        id: ticketId,
        ticketNumber: inserted.ticketNumber,
        subject,
        status,
        priority,
        category,
        customerName: name,
        customerEmail: email,
        createdAt: now,
        updatedAt: now,
      }),
    }).catch((err) => console.error("[webhook.ticket_created]", err));

    return {
      ok: true,
      id: ticketId,
      ticketNumber: inserted.ticketNumber,
      customerToken,
      status,
      portalUrl: ticketUrl,
    };
  } catch (err) {
    for (const a of attachments) {
      await storage.delete(a.storageKey).catch(() => undefined);
    }
    console.error("[createTicketFromSubmission]", err);
    return { ok: false, error: "Failed to create ticket.", httpStatus: 500 };
  }
}

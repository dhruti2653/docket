import {
  ChatCircleIcon,
  ClockIcon,
  TicketIcon,
} from "@phosphor-icons/react/dist/ssr";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BrandMark } from "@/components/common/brand-mark";
import { LocalDateTime } from "@/components/common/local-datetime";
import { RichTextContent } from "@/components/common/rich-text-content";
import { TicketAttachments } from "@/components/common/ticket-attachments";
import {
  customers,
  ticketActivity,
  ticketAttachments,
  ticketComments,
  tickets,
} from "@/db/schema";
import { signEmailToken } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  getPlatformSettings,
  resolveBrandName,
  resolveLogoUrl,
} from "@/lib/settings";
import { storage } from "@/lib/storage";
import { getTicketCategories, getTicketStatuses } from "@/lib/ticket-config";
import { COLOR_BADGE } from "@/lib/tickets";
import { resolveCustomerTicket } from "@/lib/tickets/merge";
import { getInitials } from "@/lib/utils";
import { ReplyForm } from "./reply-form";
import { TicketActions } from "./ticket-actions";
import { TicketRealtime } from "./ticket-realtime";

interface Props {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: Props) {
  const { ticketId } = await params;
  const { token } = await searchParams;

  if (!token) {
    notFound();
  }

  // An old link to a merged ticket lands on the ticket it was merged into
  // (same customer, so handing over that ticket's token is safe).
  const access = await resolveCustomerTicket(ticketId, token);
  if (access?.merged) {
    redirect(`/ticket/${access.ticketId}?token=${access.token}`);
  }

  // Validate ticket + token together
  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      description: tickets.description,
      category: tickets.category,
      status: tickets.status,
      priority: tickets.priority,
      customerId: tickets.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      customerToken: tickets.customerToken,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .innerJoin(customers, eq(tickets.customerId, customers.id))
    .where(and(eq(tickets.id, ticketId), eq(tickets.customerToken, token)))
    .limit(1);

  if (!ticket) {
    notFound();
  }

  const [statuses, categories, settings] = await Promise.all([
    getTicketStatuses(),
    getTicketCategories(),
    getPlatformSettings(),
  ]);
  const brandName = resolveBrandName(settings.brandName);
  const logoUrl = resolveLogoUrl(settings.logoKey);

  const statusMap = Object.fromEntries(statuses.map((s) => [s.slug, s]));
  const categoryMap = Object.fromEntries(categories.map((c) => [c.slug, c]));

  // The customer's other tickets (same email) so they can jump between them.
  // Holding a valid token for this ticket already proves access to this email's
  // tickets in our customer-access model, so exposing siblings here is safe.
  const siblingTickets = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      customerToken: tickets.customerToken,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.customerId, ticket.customerId),
        isNull(tickets.mergedIntoTicketId)
      )
    )
    .orderBy(desc(tickets.createdAt));

  const openTickets = siblingTickets.filter(
    (t) => !(statusMap[t.status]?.isClosedState ?? false)
  );
  const hasOtherOpen = openTickets.some((t) => t.id !== ticket.id);

  // Fetch public comments (exclude internal notes)
  const comments = await db
    .select()
    .from(ticketComments)
    .where(
      and(
        eq(ticketComments.ticketId, ticketId),
        eq(ticketComments.isInternal, false)
      )
    )
    .orderBy(asc(ticketComments.createdAt));

  // Fetch all attachments for this ticket
  const attachments = await db
    .select()
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, ticketId));

  // Ticket-level attachments (not linked to a comment)
  const ticketLevelAttachments = attachments.filter((a) => !a.commentId);

  // Map commentId → attachments
  const attachmentsByComment = new Map<string, typeof attachments>();
  for (const a of attachments) {
    if (a.commentId) {
      if (!attachmentsByComment.has(a.commentId)) {
        attachmentsByComment.set(a.commentId, []);
      }
      attachmentsByComment.get(a.commentId)!.push(a);
    }
  }

  // Simplified activity (status changes only — no internal note events)
  const activity = await db
    .select()
    .from(ticketActivity)
    .where(and(eq(ticketActivity.ticketId, ticketId)))
    .orderBy(asc(ticketActivity.createdAt));

  const visibleActivity = activity.filter((a) =>
    [
      "status_changed",
      "ticket_closed",
      "ticket_reopened",
      "ticket_created",
    ].includes(a.action)
  );

  const isOpen = !(statusMap[ticket.status]?.isClosedState ?? false);
  const totalAttachments = attachments.length;

  return (
    <div className="min-h-screen bg-public">
      <TicketRealtime ticketId={ticket.id} token={token} />
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-sand sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link className="flex items-center gap-2 sm:gap-2.5 min-w-0" href="/">
            <BrandMark
              fallbackIcon={
                <div className="size-7 rounded-md bg-bark flex items-center justify-center shrink-0">
                  <TicketIcon className="size-4 text-cream" weight="fill" />
                </div>
              }
              imgClassName="h-7 w-auto max-w-40 object-contain"
              logoUrl={logoUrl}
              name={brandName}
              textClassName="font-semibold text-bark text-sm truncate"
            />
          </Link>
          <nav className="flex gap-3 sm:gap-4 text-sm shrink-0">
            <Link
              className="text-stone hover:text-bark transition-colors hidden sm:inline"
              href="/submit"
            >
              Submit a Ticket
            </Link>
            <Link
              className="text-stone hover:text-bark transition-colors"
              href="/my-tickets"
            >
              My Tickets
            </Link>
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-6">
        {/* Sidebar: the customer's other open tickets */}
        {hasOtherOpen && (
          <aside className="lg:w-72 shrink-0 space-y-2 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <h2 className="text-2xs font-medium text-stone uppercase tracking-wider px-1">
              Your open tickets
            </h2>
            <div className="bg-white rounded-xl border border-sand shadow-soft overflow-hidden divide-y divide-sand">
              {openTickets.map((t) => {
                const active = t.id === ticket.id;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`block px-4 py-3 transition-colors ${
                      active
                        ? "bg-cream border-l-2 border-bark"
                        : "hover:bg-cream/40"
                    }`}
                    href={`/ticket/${t.id}?token=${t.customerToken}`}
                    key={t.id}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-2xs font-medium text-stone">
                        #{t.ticketNumber}
                      </span>
                      <span
                        className={`ml-auto inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-medium ${
                          COLOR_BADGE[statusMap[t.status]?.color ?? "slate"] ??
                          ""
                        }`}
                      >
                        {statusMap[t.status]?.label ?? t.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-bark truncate">
                      {t.subject}
                    </p>
                  </Link>
                );
              })}
            </div>
            <Link
              className="block text-xs text-stone hover:text-bark px-1 pt-1 transition-colors"
              href={`/my-tickets/${signEmailToken(ticket.customerEmail)}`}
            >
              View all my tickets →
            </Link>
          </aside>
        )}

        <main className="flex-1 min-w-0 space-y-6">
          {/* Ticket header */}
          <div className="bg-white rounded-xl border border-sand shadow-soft p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-stone">
                    #{ticket.ticketNumber}
                  </span>
                  <span className="text-stone text-xs">·</span>
                  <span className="text-xs text-stone">
                    {categoryMap[ticket.category]?.label ?? ticket.category}
                  </span>
                </div>
                <h1 className="text-xl font-semibold text-bark leading-snug wrap-break-word">
                  {ticket.subject}
                </h1>
                <p className="text-xs text-stone mt-1">
                  Submitted by {ticket.customerName} ·{" "}
                  <LocalDateTime date={ticket.createdAt} />
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${COLOR_BADGE[statusMap[ticket.status]?.color ?? "slate"] ?? ""}`}
                >
                  {statusMap[ticket.status]?.label ?? ticket.status}
                </span>
                <TicketActions
                  isClosed={!isOpen}
                  ticketId={ticket.id}
                  token={token}
                />
              </div>
            </div>
          </div>

          {/* Original description — your first message (right, like a sent chat bubble) */}
          <div className="flex justify-end">
            <div className="max-w-[92%] sm:max-w-[85%] bg-cream rounded-xl border border-sand p-3.5 sm:p-4">
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-bark">You</span>
                  <span className="text-xs text-stone ml-2">
                    <LocalDateTime date={ticket.createdAt} />
                  </span>
                </div>
                <div className="size-7 rounded-full bg-bark text-cream flex items-center justify-center text-xs font-medium shrink-0 ml-auto">
                  {getInitials(ticket.customerName)}
                </div>
              </div>
              {!isRichTextEmpty(ticket.description) && (
                <RichTextContent content={ticket.description} />
              )}

              {ticketLevelAttachments.length > 0 && (
                <div
                  className={
                    isRichTextEmpty(ticket.description)
                      ? ""
                      : "mt-4 pt-4 border-t border-sand"
                  }
                >
                  <TicketAttachments
                    items={ticketLevelAttachments.map((a) => ({
                      id: a.id,
                      url: storage.url(a.storageKey),
                      filename: a.filename,
                      mimeType: a.mimeType,
                      fileSize: a.fileSize,
                    }))}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Comments thread — support on the left, your replies on the right */}
          {comments.length > 0 && (
            <div className="space-y-4">
              {comments.map((comment) => {
                const isAgent =
                  comment.authorRole === "agent" ||
                  comment.authorRole === "admin";
                const commentAttachments =
                  attachmentsByComment.get(comment.id) ?? [];
                return (
                  <div
                    className={`flex ${isAgent ? "justify-start" : "justify-end"}`}
                    key={comment.id}
                  >
                    <div
                      className={`max-w-[92%] sm:max-w-[85%] rounded-xl border p-3.5 sm:p-4 ${
                        isAgent
                          ? "bg-white border-sand"
                          : "bg-cream border-sand"
                      }`}
                    >
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-2">
                        {isAgent && (
                          <div className="size-7 rounded-full bg-stone text-white flex items-center justify-center text-xs font-medium shrink-0">
                            S
                          </div>
                        )}
                        <div className={isAgent ? "" : "ml-auto text-right"}>
                          <span className="text-sm font-medium text-bark">
                            {isAgent ? "Support Team" : "You"}
                          </span>
                          <span className="text-xs text-stone mx-2">
                            <LocalDateTime date={comment.createdAt} />
                          </span>
                        </div>
                        {!isAgent && (
                          <div className="size-7 rounded-full bg-bark text-cream flex items-center justify-center text-xs font-medium shrink-0">
                            {getInitials(comment.authorName)}
                          </div>
                        )}
                      </div>
                      {!isRichTextEmpty(comment.content) && (
                        <RichTextContent content={comment.content} />
                      )}

                      {commentAttachments.length > 0 && (
                        <div
                          className={
                            isRichTextEmpty(comment.content)
                              ? ""
                              : "mt-3 pt-3 border-t border-sand"
                          }
                        >
                          <TicketAttachments
                            items={commentAttachments.map((a) => ({
                              id: a.id,
                              url: storage.url(a.storageKey),
                              filename: a.filename,
                              mimeType: a.mimeType,
                              fileSize: a.fileSize,
                            }))}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Activity timeline */}
          {visibleActivity.length > 1 && (
            <div className="bg-white rounded-xl border border-sand shadow-soft p-5">
              <h2 className="text-sm font-medium text-bark mb-3 flex items-center gap-1.5">
                <ClockIcon className="size-4 text-stone" />
                Activity
              </h2>
              <div className="space-y-2">
                {visibleActivity.map((a) => {
                  let label = "";
                  if (a.action === "ticket_created") {
                    label = "Ticket submitted";
                  } else if (a.action === "ticket_closed") {
                    label = "Ticket closed";
                  } else if (a.action === "ticket_reopened") {
                    label = "Ticket reopened";
                  } else if (a.action === "status_changed") {
                    const m = a.metadata as {
                      from?: string;
                      to?: string;
                    } | null;
                    label = `Status changed from ${statusMap[m?.from ?? ""]?.label ?? m?.from} to ${statusMap[m?.to ?? ""]?.label ?? m?.to}`;
                  }
                  if (!label) {
                    return null;
                  }
                  return (
                    <div
                      className="flex items-center gap-2 text-xs text-stone"
                      key={a.id}
                    >
                      <span className="size-1.5 rounded-full bg-sand shrink-0" />
                      <span>{label}</span>
                      <span className="ml-auto shrink-0">
                        <LocalDateTime date={a.createdAt} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reply form or closed notice */}
          {isOpen ? (
            <ReplyForm
              ticketId={ticket.id}
              token={token}
              totalAttachments={totalAttachments}
            />
          ) : (
            <div className="bg-white rounded-xl border border-sand shadow-soft p-6 text-center">
              <ChatCircleIcon className="size-8 text-sand mx-auto mb-2" />
              <p className="text-sm text-stone">This ticket is closed.</p>
              <p className="text-xs text-stone mt-0.5">
                Reopen it above if you need further assistance.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

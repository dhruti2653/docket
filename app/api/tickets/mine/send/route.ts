import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { customers, tickets } from "@/db/schema";
import { signEmailToken } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { myTicketsListTemplate } from "@/lib/email/templates/my-tickets-list";
import { env } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  let body: { email?: string } = {};
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  const [byIp, byEmail] = await Promise.all([
    checkRateLimit({
      action: "my_tickets_send_ip",
      key: getClientIp(request),
      limit: 5,
      windowMinutes: 10,
    }),
    checkRateLimit({
      action: "my_tickets_send_email",
      key: email,
      limit: 5,
      windowMinutes: 10,
    }),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  // Fetch tickets for this email
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, email))
    .limit(1);
  const customerTickets = customer
    ? await db
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          subject: tickets.subject,
          status: tickets.status,
          customerToken: tickets.customerToken,
        })
        .from(tickets)
        // Same set the linked My Tickets page shows — merged tickets hidden.
        .where(
          and(
            eq(tickets.customerId, customer.id),
            isNull(tickets.mergedIntoTicketId)
          )
        )
    : [];

  // Always respond the same way regardless of whether tickets exist — only
  // send an email when there's something to show (prevents email enumeration).
  if (customerTickets.length > 0) {
    const listUrl = `${env.NEXT_PUBLIC_APP_URL}/my-tickets/${signEmailToken(email)}`;
    myTicketsListTemplate({ listUrl, ticketCount: customerTickets.length })
      .then(({ subject, html, text }) =>
        enqueueEmail({
          to: email,
          subject,
          html,
          text,
        })
      )
      .catch((err) => console.error("[my-tickets email]", err));
  }

  return NextResponse.json({ ok: true });
}

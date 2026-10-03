import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { customers } from "@/db/schema/customers";
import { ticketStatuses } from "@/db/schema/ticket-config";
import { tickets } from "@/db/schema/tickets";
import { db } from "@/lib/db";

export type Customer = typeof customers.$inferSelect;

/** Looks up a customer by normalized email, creating one on their first ticket.
 * Uses INSERT ... ON CONFLICT DO NOTHING rather than select-then-insert, so two
 * concurrent submissions from one new email can't race into a constraint crash. */
export async function findOrCreateCustomer(
  name: string,
  email: string
): Promise<Customer> {
  const normalizedEmail = email.trim().toLowerCase();

  const [created] = await db
    .insert(customers)
    .values({ name, email: normalizedEmail })
    .onConflictDoNothing({ target: customers.email })
    .returning();
  if (created) {
    return created;
  }

  const [existing] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, normalizedEmail))
    .limit(1);
  if (!existing) {
    throw new Error(`Failed to find or create customer for ${normalizedEmail}`);
  }
  return existing;
}

export interface CustomerTicketSummary {
  createdAt: Date;
  id: string;
  status: string;
  subject: string;
  ticketNumber: number;
}

export interface CustomerFrequencyPoint {
  count: number;
  label: string;
  month: string;
}

const FREQUENCY_MONTHS = 12;

async function getCustomerFrequency(
  customerId: string
): Promise<CustomerFrequencyPoint[]> {
  const now = new Date();
  const months: { month: string; label: string }[] = [];
  for (let i = FREQUENCY_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "short" }),
    });
  }
  const rangeStart = new Date(
    now.getFullYear(),
    now.getMonth() - (FREQUENCY_MONTHS - 1),
    1
  );

  const monthExpr = sql<string>`to_char(${tickets.createdAt}, 'YYYY-MM')`;
  const rows = await db
    .select({ month: monthExpr, c: count() })
    .from(tickets)
    .where(
      and(
        eq(tickets.customerId, customerId),
        gte(tickets.createdAt, rangeStart)
      )
    )
    .groupBy(monthExpr);

  const countByMonth = new Map(rows.map((r) => [r.month, Number(r.c)]));
  return months.map((m) => ({ ...m, count: countByMonth.get(m.month) ?? 0 }));
}

export interface CustomerProfile {
  closedTickets: CustomerTicketSummary[];
  email: string;
  frequency: CustomerFrequencyPoint[];
  id: string;
  name: string;
  note: string | null;
  openTickets: CustomerTicketSummary[];
}

export async function getCustomerProfile(
  customerId: string
): Promise<CustomerProfile | null> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) {
    return null;
  }

  const [rows, frequency] = await Promise.all([
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        createdAt: tickets.createdAt,
        isClosedState: ticketStatuses.isClosedState,
      })
      .from(tickets)
      .leftJoin(ticketStatuses, eq(tickets.status, ticketStatuses.slug))
      .where(
        and(
          eq(tickets.customerId, customerId),
          isNull(tickets.mergedIntoTicketId)
        )
      )
      .orderBy(desc(tickets.createdAt)),
    getCustomerFrequency(customerId),
  ]);

  const openTickets: CustomerTicketSummary[] = [];
  const closedTickets: CustomerTicketSummary[] = [];
  for (const r of rows) {
    const summary: CustomerTicketSummary = {
      id: r.id,
      ticketNumber: r.ticketNumber,
      subject: r.subject,
      status: r.status,
      createdAt: r.createdAt,
    };
    (r.isClosedState ? closedTickets : openTickets).push(summary);
  }

  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    note: customer.note,
    openTickets,
    closedTickets,
    frequency,
  };
}

export async function updateCustomerNote(
  customerId: string,
  note: string
): Promise<Customer | null> {
  const [updated] = await db
    .update(customers)
    .set({ note, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning();
  return updated ?? null;
}

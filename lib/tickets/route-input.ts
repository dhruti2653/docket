// Request-body helpers for the agent ticket routes (merge / split / links).

/** Largest value a `serial` (int4) ticket number can hold — anything above
 * would make Postgres throw "out of range" instead of matching nothing. */
const MAX_TICKET_NUMBER = 2_147_483_647;

/** Parses a JSON object body; null for invalid JSON or a non-object (`null`,
 * arrays, primitives) so callers can answer 400 instead of crashing on
 * `body.x`. */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A positive int4 ticket number from user input ("1042", 1042, "#1042"), or null. */
export function parseTicketNumber(value: unknown): number | null {
  const n =
    typeof value === "string"
      ? Number(value.trim().replace(/^#/, ""))
      : Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_TICKET_NUMBER ? n : null;
}

/** Postgres unique-violation, unwrapping Drizzle's query-error wrapper. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

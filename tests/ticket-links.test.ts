import { describe, expect, it } from "vitest";
import {
  isTicketLinkType,
  TICKET_LINK_TYPES,
  ticketLinkLabel,
} from "@/lib/tickets/link-types";
import { ticketLinkKey } from "@/lib/tickets/links";
import {
  isUniqueViolation,
  parseTicketNumber,
  readJsonObject,
} from "@/lib/tickets/route-input";

describe("ticketLinkLabel", () => {
  it("reads directional links from each end", () => {
    expect(ticketLinkLabel("blocks", "outgoing")).toBe("Blocks");
    expect(ticketLinkLabel("blocks", "incoming")).toBe("Blocked by");
    expect(ticketLinkLabel("duplicate_of", "outgoing")).toBe("Duplicate of");
    expect(ticketLinkLabel("duplicate_of", "incoming")).toBe("Duplicated by");
  });

  it("reads related_to the same from both ends", () => {
    expect(ticketLinkLabel("related_to", "outgoing")).toBe("Related to");
    expect(ticketLinkLabel("related_to", "incoming")).toBe("Related to");
  });
});

describe("isTicketLinkType", () => {
  it("accepts every known type", () => {
    for (const type of TICKET_LINK_TYPES) {
      expect(isTicketLinkType(type)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const value of ["blocked_by", "", null, undefined, 1, {}]) {
      expect(isTicketLinkType(value)).toBe(false);
    }
  });
});

describe("ticketLinkKey", () => {
  it("is the same in both directions, so reverse duplicates are caught", () => {
    expect(
      ticketLinkKey({ ticketId: "a", linkedTicketId: "b", type: "blocks" })
    ).toBe(
      ticketLinkKey({ ticketId: "b", linkedTicketId: "a", type: "blocks" })
    );
  });

  it("differs by type", () => {
    expect(
      ticketLinkKey({ ticketId: "a", linkedTicketId: "b", type: "blocks" })
    ).not.toBe(
      ticketLinkKey({ ticketId: "a", linkedTicketId: "b", type: "related_to" })
    );
  });
});

describe("parseTicketNumber", () => {
  it("accepts numbers and numeric strings, with or without #", () => {
    expect(parseTicketNumber(1042)).toBe(1042);
    expect(parseTicketNumber("1042")).toBe(1042);
    expect(parseTicketNumber(" #1042 ")).toBe(1042);
    expect(parseTicketNumber(2_147_483_647)).toBe(2_147_483_647);
  });

  it("rejects non-positive, fractional, non-numeric and int4-overflowing input", () => {
    for (const value of [
      0,
      -1,
      1.5,
      "abc",
      "",
      null,
      undefined,
      {},
      2_147_483_648,
      "99999999999",
    ]) {
      expect(parseTicketNumber(value)).toBeNull();
    }
  });
});

describe("readJsonObject", () => {
  const req = (body: string) =>
    new Request("http://test.local", { method: "POST", body });

  it("returns a JSON object body", async () => {
    expect(await readJsonObject(req('{"a":1}'))).toEqual({ a: 1 });
  });

  it("returns null for null, arrays, primitives and invalid JSON", async () => {
    for (const body of ["null", "[1]", "42", '"x"', "{not json"]) {
      expect(await readJsonObject(req(body))).toBeNull();
    }
  });
});

describe("isUniqueViolation", () => {
  it("matches a Postgres 23505, bare or wrapped in Drizzle's error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

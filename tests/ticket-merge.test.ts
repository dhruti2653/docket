import { describe, expect, it } from "vitest";
import { countPendingReplies } from "@/lib/tickets/thread-state";

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
const customer = (minutes: number) => ({
  authorRole: "customer",
  createdAt: t(minutes),
});
const agent = (minutes: number) => ({
  authorRole: "agent",
  createdAt: t(minutes),
});

describe("countPendingReplies", () => {
  it("counts the description alone as one pending message", () => {
    expect(countPendingReplies(t(0), [])).toBe(1);
  });

  it("resets to zero after a public agent reply", () => {
    expect(countPendingReplies(t(0), [customer(1), agent(2)])).toBe(0);
  });

  it("counts customer messages after the last agent reply", () => {
    expect(
      countPendingReplies(t(0), [agent(1), customer(2), customer(3)])
    ).toBe(2);
  });

  it("slots the description in by time, not first — merged-in older messages", () => {
    // Older ticket merged into a newer one: its back-dated thread (customer,
    // then agent reply) predates the target's own description, which is the
    // newest message and still unanswered.
    expect(countPendingReplies(t(10), [customer(0), agent(5)])).toBe(1);
  });

  it("is unaffected by input order", () => {
    expect(countPendingReplies(t(0), [customer(3), agent(1)])).toBe(1);
  });
});

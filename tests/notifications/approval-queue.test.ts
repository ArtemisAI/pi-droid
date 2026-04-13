import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApprovalQueue } from "../../src/notifications/approval-queue.js";

describe("ApprovalQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves approve/deny decisions", () => {
    const queue = new ApprovalQueue();
    const id = queue.enqueue({ prompt: "Like Alex?" }, 5);

    const result = queue.resolve(id, "approve");
    expect(result).toEqual({
      id,
      decision: "approve",
      source: "channel_callback",
      metadata: undefined,
    });
    expect(queue.getPendingCount()).toBe(0);
  });

  it("expires pending approvals to timeout decisions", () => {
    const queue = new ApprovalQueue();
    queue.enqueue({ prompt: "Like Riley?" }, 1);
    vi.advanceTimersByTime(60_000);

    const expired = queue.expire();
    expect(expired).toHaveLength(1);
    expect(expired[0].decision).toBe("timeout");
    expect(queue.getPendingCount()).toBe(0);
  });
});

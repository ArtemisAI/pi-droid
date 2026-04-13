import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramChannel } from "../../src/notifications/telegram.js";

describe("TelegramChannel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates approval messages and resolves callback decisions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: [
            {
              update_id: 10,
              callback_query: {
                id: "cb-1",
                data: "approve:approval-1",
                message: { chat: { id: 123 } },
              },
            },
            {
              update_id: 11,
              message: { chat: { id: 123 }, text: "/pause" },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: true }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const channel = new TelegramChannel({ botToken: "token", chatId: "123", timeoutMinutes: 5 });
    const id = await channel.requestApproval({ id: "approval-1", prompt: "Like Sam?", score: 0.87 });
    expect(id).toBe("approval-1");

    const result = await channel.poll();
    expect(result.approvals).toEqual([
      { id: "approval-1", decision: "approve", source: "channel_callback", metadata: undefined },
    ]);
    expect(result.commands).toEqual([{ command: "pause", args: [], raw: "/pause" }]);
  });

  it("auto-skips timed out approvals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 2 } }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const channel = new TelegramChannel({ botToken: "token", chatId: "123", timeoutMinutes: 1 });
    await channel.requestApproval({ id: "approval-timeout", prompt: "Like Kim?" });
    vi.advanceTimersByTime(60_000);

    const result = await channel.poll();
    expect(result.approvals).toEqual([
      { id: "approval-timeout", decision: "timeout", source: "timeout", metadata: undefined },
    ]);
  });
});

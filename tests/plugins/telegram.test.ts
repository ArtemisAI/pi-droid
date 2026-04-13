import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const sendMessage = vi.fn();
const sendSummary = vi.fn();
const sendScreenshot = vi.fn();
const requestApproval = vi.fn();
const poll = vi.fn();
const getPendingApprovals = vi.fn();

vi.mock("../../src/notifications/telegram.js", () => ({
  TelegramChannel: vi.fn().mockImplementation(() => ({
    sendMessage,
    sendSummary,
    sendScreenshot,
    requestApproval,
    poll,
    getPendingApprovals,
  })),
}));

import { TelegramPlugin } from "../../src/plugins/telegram.js";

describe("TelegramPlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_CHAT_ID = "123";
    requestApproval.mockResolvedValue("approval-123");
    poll.mockResolvedValue({ approvals: [], commands: [] });
    getPendingApprovals.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it("marks external-facing telegram capabilities as requiring approval", () => {
    const plugin = new TelegramPlugin();
    const map = new Map(plugin.getCapabilities().map((cap) => [cap.name, cap.requiresApproval]));
    expect(map.get("telegram.notify")).toBe(true);
    expect(map.get("telegram.summary")).toBe(true);
    expect(map.get("telegram.screenshot")).toBe(true);
    expect(map.get("telegram.request_approval")).toBe(true);
  });

  it("returns an error for non-status actions when channel is not initialized", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const plugin = new TelegramPlugin();
    await plugin.initialize({});
    const result = await plugin.execute("telegram.notify", { text: "hello" });
    expect(result).toEqual({ success: false, error: "Telegram is not configured" });
  });

  it("dispatches execute actions to the underlying channel", async () => {
    const plugin = new TelegramPlugin();
    await plugin.initialize({});

    await plugin.execute("telegram.notify", { text: "hello" });
    expect(sendMessage).toHaveBeenCalledWith("hello");

    await plugin.execute("telegram.summary", { summary: { profiles_seen: 1, likes_sent: 2 } });
    expect(sendSummary).toHaveBeenCalledWith({ profiles_seen: 1, likes_sent: 2 });

    await plugin.execute("telegram.screenshot", { photo_path: "/tmp/a.png", caption: "cap" });
    expect(sendScreenshot).toHaveBeenCalledWith({ photoPath: "/tmp/a.png", caption: "cap" });

    const approvalResult = await plugin.execute("telegram.request_approval", { prompt: "Like Sam?", score: 0.7 });
    expect(requestApproval).toHaveBeenCalled();
    expect(approvalResult).toEqual({ success: true, data: { approval_id: "approval-123" } });

    poll.mockResolvedValueOnce({ approvals: [{ id: "1", decision: "approve", source: "channel_callback" }], commands: [{ command: "pause", args: [], raw: "/pause" }] });
    const pollResult = await plugin.execute("telegram.poll", {});
    expect(poll).toHaveBeenCalledTimes(1);
    expect(pollResult.success).toBe(true);
  });

  it("rate-limits heartbeat polling", async () => {
    const plugin = new TelegramPlugin();
    await plugin.initialize({ heartbeat_poll_interval_ms: 5000 });

    await plugin.onHeartbeat();
    await plugin.onHeartbeat();
    expect(poll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    await plugin.onHeartbeat();
    expect(poll).toHaveBeenCalledTimes(2);
  });
});

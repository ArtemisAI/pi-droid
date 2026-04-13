import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(async () => ""),
  adb: vi.fn(async () => ""),
}));

import { adbShell } from "../../src/adb/exec.js";
import {
  readNotifications,
  getClipboard,
  setClipboard,
  sendIntent,
  openUrl,
  makeCall,
  sendSms,
  shareText,
} from "../../src/adb/intents.js";

const mockAdbShell = vi.mocked(adbShell);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── readNotifications ───────────────────────────────────────────────

describe("readNotifications()", () => {
  it("parses dumpsys notification output with multiple records", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "Some preamble text",
        "NotificationRecord(com.whatsapp 0x1234 user 0",
        "  postTime=1700000000000",
        "  android.title=String (John)",
        "  android.text=String (Hey there!)",
        "NotificationRecord(com.slack 0x5678 user 0",
        "  postTime=1700000001000",
        "  android.title=String (General)",
        "  android.text=String (New message in #general)",
      ].join("\n"),
    );

    const notifs = await readNotifications();
    expect(notifs).toHaveLength(2);

    expect(notifs[0]).toEqual({
      packageName: "com.whatsapp",
      title: "John",
      text: "Hey there!",
      time: "1700000000000",
    });

    expect(notifs[1]).toEqual({
      packageName: "com.slack",
      title: "General",
      text: "New message in #general",
      time: "1700000001000",
    });
  });

  it("returns empty array when no notifications", async () => {
    mockAdbShell.mockResolvedValue("No notifications posted\n");
    const notifs = await readNotifications();
    expect(notifs).toHaveLength(0);
  });

  it("handles missing title and text gracefully", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "NotificationRecord(com.example 0xabcd user 0",
        "  postTime=1700000002000",
      ].join("\n"),
    );

    const notifs = await readNotifications();
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe("");
    expect(notifs[0].text).toBe("");
    expect(notifs[0].packageName).toBe("com.example");
  });

  it("handles missing postTime", async () => {
    mockAdbShell.mockResolvedValue(
      [
        "NotificationRecord(com.example 0xabcd user 0",
        "  android.title=String (Title)",
      ].join("\n"),
    );

    const notifs = await readNotifications();
    expect(notifs).toHaveLength(1);
    expect(notifs[0].time).toBe("0");
  });

  it("passes serial option to adbShell", async () => {
    mockAdbShell.mockResolvedValue("");
    await readNotifications({ serial: "DEV1" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "dumpsys notification --noredact",
      expect.objectContaining({ serial: "DEV1" }),
    );
  });
});

// ── getClipboard ────────────────────────────────────────────────────

describe("getClipboard()", () => {
  it("parses hex dump from service call output", async () => {
    mockAdbShell.mockResolvedValue(
      "Result: Parcel(00000000 00000001 'h.e.' 'l.l.')",
    );
    const result = await getClipboard();
    expect(result).toBe("hell");
  });

  it("returns empty string when clipboard is empty", async () => {
    mockAdbShell.mockResolvedValue("Result: Parcel(00000000 00000000)");
    const result = await getClipboard();
    expect(result).toBe("");
  });

  it("returns empty string on error", async () => {
    mockAdbShell.mockRejectedValue(new Error("device offline"));
    const result = await getClipboard();
    expect(result).toBe("");
  });

  it("uses service call clipboard command", async () => {
    mockAdbShell.mockResolvedValue("");
    await getClipboard({ serial: "XYZ" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "service call clipboard 2 i32 1 i32 0",
      expect.objectContaining({ serial: "XYZ" }),
    );
  });
});

// ── setClipboard ────────────────────────────────────────────────────

describe("setClipboard()", () => {
  it("sends am broadcast with text", async () => {
    mockAdbShell.mockResolvedValue("");
    await setClipboard("hello world");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am broadcast -a clipper.set -e text 'hello world'",
      expect.any(Object),
    );
  });

  it("escapes single quotes in text", async () => {
    mockAdbShell.mockResolvedValue("");
    await setClipboard("it's a test");
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.stringContaining("it'\\''s a test"),
      expect.any(Object),
    );
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("");
    await setClipboard("text", { serial: "ABC" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ serial: "ABC" }),
    );
  });
});

// ── sendIntent ──────────────────────────────────────────────────────

describe("sendIntent()", () => {
  it("uses am start by default", async () => {
    mockAdbShell.mockResolvedValue("Starting: Intent { act=test.ACTION }");
    const result = await sendIntent("test.ACTION");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am start -a 'test.ACTION'",
      expect.any(Object),
    );
    expect(result).toContain("Starting");
  });

  it("uses am broadcast when broadcast option is true", async () => {
    mockAdbShell.mockResolvedValue("Broadcasting: Intent { act=test.ACTION }");
    await sendIntent("test.ACTION", {}, { broadcast: true });
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am broadcast -a 'test.ACTION'",
      expect.any(Object),
    );
  });

  it("includes extras in the command", async () => {
    mockAdbShell.mockResolvedValue("");
    await sendIntent("test.ACTION", { key1: "val1", key2: "val2" });
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("--es 'key1' 'val1'");
    expect(call).toContain("--es 'key2' 'val2'");
  });

  it("escapes single quotes in extra values", async () => {
    mockAdbShell.mockResolvedValue("");
    await sendIntent("test.ACTION", { msg: "it's fine" });
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("it'\\''s fine");
  });

  it("works with no extras", async () => {
    mockAdbShell.mockResolvedValue("");
    await sendIntent("android.intent.action.MAIN");
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toBe("am start -a 'android.intent.action.MAIN'");
  });
});

// ── openUrl ─────────────────────────────────────────────────────────

describe("openUrl()", () => {
  it("constructs correct VIEW intent with URL", async () => {
    mockAdbShell.mockResolvedValue("");
    await openUrl("https://example.com");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am start -a android.intent.action.VIEW -d 'https://example.com'",
      expect.any(Object),
    );
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("");
    await openUrl("https://example.com", { serial: "S9" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ serial: "S9" }),
    );
  });
});

// ── makeCall ────────────────────────────────────────────────────────

describe("makeCall()", () => {
  it("constructs correct DIAL intent", async () => {
    mockAdbShell.mockResolvedValue("");
    await makeCall("+15551234567");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am start -a android.intent.action.DIAL -d 'tel:+15551234567'",
      expect.any(Object),
    );
  });

  it("passes serial option", async () => {
    mockAdbShell.mockResolvedValue("");
    await makeCall("911", { serial: "DEV" });
    expect(mockAdbShell).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ serial: "DEV" }),
    );
  });
});

// ── sendSms ─────────────────────────────────────────────────────────

describe("sendSms()", () => {
  it("constructs correct SENDTO intent with number and body", async () => {
    mockAdbShell.mockResolvedValue("");
    await sendSms("+15551234567", "Hello there");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am start -a android.intent.action.SENDTO -d 'sms:+15551234567' --es sms_body 'Hello there'",
      expect.any(Object),
    );
  });

  it("escapes single quotes in message", async () => {
    mockAdbShell.mockResolvedValue("");
    await sendSms("555", "it's a message");
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("it'\\''s a message");
  });
});

// ── shareText ───────────────────────────────────────────────────────

describe("shareText()", () => {
  it("constructs correct SEND intent with text", async () => {
    mockAdbShell.mockResolvedValue("");
    await shareText("Check this out");
    expect(mockAdbShell).toHaveBeenCalledWith(
      "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'Check this out'",
      expect.any(Object),
    );
  });

  it("escapes single quotes in shared text", async () => {
    mockAdbShell.mockResolvedValue("");
    await shareText("it's cool");
    const call = mockAdbShell.mock.calls[0][0] as string;
    expect(call).toContain("it'\\''s cool");
  });
});

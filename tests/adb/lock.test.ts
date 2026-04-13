import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/adb/exec.js", () => ({
  adbShell: vi.fn(),
}));

import { adbShell } from "../../src/adb/exec.js";
import { getLockStatus, clearLock, setPattern, setPin } from "../../src/adb/lock.js";

const mockAdbShell = vi.mocked(adbShell);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLockStatus()", () => {
  it("reports no lock when verify with empty credential succeeds", async () => {
    mockAdbShell
      .mockResolvedValueOnce("")  // get-disabled
      .mockResolvedValueOnce("Lock credential verified successfully");  // verify

    const status = await getLockStatus();
    expect(status.isSecure).toBe(false);
    expect(status.hasPattern).toBe(false);
  });

  it("reports locked when verify with empty credential fails", async () => {
    mockAdbShell
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("Lock credential verification failed");

    const status = await getLockStatus();
    expect(status.isSecure).toBe(true);
    expect(status.hasPattern).toBe(true);
  });
});

describe("clearLock()", () => {
  it("returns success when locksettings clear succeeds", async () => {
    mockAdbShell.mockResolvedValue("Lock credential cleared");
    const result = await clearLock("1,2,5,8,9");
    expect(result.success).toBe(true);
    expect(mockAdbShell).toHaveBeenCalledWith("locksettings clear --old '1,2,5,8,9'", expect.anything());
  });

  it("returns failure when locksettings clear fails", async () => {
    mockAdbShell.mockResolvedValue("Error: failed to clear");
    const result = await clearLock("wrong");
    expect(result.success).toBe(false);
  });

  it("handles adbShell exceptions", async () => {
    mockAdbShell.mockRejectedValue(new Error("device offline"));
    const result = await clearLock("1,2,3");
    expect(result.success).toBe(false);
    expect(result.message).toContain("device offline");
  });
});

describe("setPattern()", () => {
  it("returns success when pattern is set", async () => {
    mockAdbShell.mockResolvedValue("Pattern set");
    const result = await setPattern("0,1,2,5,8");
    expect(result.success).toBe(true);
    expect(mockAdbShell).toHaveBeenCalledWith("locksettings set-pattern '0,1,2,5,8'", expect.anything());
  });

  it("rejects invalid pattern with digit 9", async () => {
    const result = await setPattern("1,2,5,8,9");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid pattern");
  });

  it("rejects pattern with fewer than 4 dots", async () => {
    const result = await setPattern("1,2,3");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid pattern");
  });
});

describe("setPin()", () => {
  it("returns success when PIN is set", async () => {
    mockAdbShell.mockResolvedValue("Pin set");
    const result = await setPin("1234");
    expect(result.success).toBe(true);
    expect(mockAdbShell).toHaveBeenCalledWith("locksettings set-pin '1234'", expect.anything());
  });
});

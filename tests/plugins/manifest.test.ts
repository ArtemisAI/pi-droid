import { describe, it, expect } from "vitest";
import { isCoreVersionCompatible, validatePluginManifest } from "../../src/plugins/manifest.js";

describe("validatePluginManifest()", () => {
  it("accepts valid manifest", () => {
    const result = validatePluginManifest({
      schemaVersion: "1.0",
      name: "calendar",
      packageName: "@pi-droid/plugin-calendar",
      version: "1.2.3",
      displayName: "Calendar Plugin",
      description: "Calendar automation",
      requiredCoreVersion: ">=0.1.0",
      targetApps: ["com.google.android.calendar"],
      tools: [{ name: "calendar.open", description: "Open app", requiresApproval: false }],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = validatePluginManifest({
      schemaVersion: "1.0",
      name: "broken",
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("isCoreVersionCompatible()", () => {
  it("supports >= ranges", () => {
    expect(isCoreVersionCompatible("0.2.0", ">=0.1.0")).toBe(true);
    expect(isCoreVersionCompatible("0.0.9", ">=0.1.0")).toBe(false);
  });

  it("supports caret ranges", () => {
    expect(isCoreVersionCompatible("0.1.5", "^0.1.0")).toBe(true);
    expect(isCoreVersionCompatible("0.2.0", "^0.1.0")).toBe(false);
  });

  it("supports exact versions", () => {
    expect(isCoreVersionCompatible("0.1.0", "0.1.0")).toBe(true);
    expect(isCoreVersionCompatible("0.1.1", "0.1.0")).toBe(false);
  });
});

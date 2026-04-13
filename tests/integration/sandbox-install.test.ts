/**
 * Integration test: sandbox install verification.
 *
 * Simulates `pi install npm:@artemisai/pi-droid` by running npm pack,
 * installing into a sandbox, and verifying the package installs cleanly.
 *
 * Note: The pi extension loader discovers extensions via its own internal
 * resolution logic which differs between dev (jiti + TypeScript) and
 * production (compiled JS). Full extension loading is tested by
 * extension-load.test.ts using the source entry point.
 *
 * This test verifies the npm package artifact is valid.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync, copyFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_DIR = join(import.meta.dirname, "../..");

beforeAll(() => {
  // Ensure dist/ is fresh before packing
  execSync("npm run build", { cwd: PACKAGE_DIR, stdio: "pipe" });
});

describe("Sandbox install verification", () => {
  it("npm pack produces a valid tarball", () => {
    const output = execSync("npm pack --dry-run --json 2>/dev/null || npm pack --dry-run", {
      cwd: PACKAGE_DIR,
      encoding: "utf-8",
    });
    // Verify key files are present
    expect(output).toContain("dist/index.js");
    expect(output).toContain("dist/index.d.ts");
    expect(output).toContain("LICENSE");
    expect(output).toContain("README.md");
    expect(output).toContain("config/default.json");
    // Skills included
    expect(output).toContain("skills/android-screen/SKILL.md");
    expect(output).toContain("skills/android-interact/SKILL.md");
    expect(output).toContain("skills/android-automate/SKILL.md");
    expect(output).toContain("skills/android-plugin/SKILL.md");
    // Excluded: flows, tests, src, debug artifacts
    expect(output).not.toContain("dist/flows/");
    expect(output).not.toContain("src/");
    expect(output).not.toContain("tests/");
    expect(output).not.toContain(".claude/");
    expect(output).not.toContain(".png");
  });

  it("installs cleanly in a sandbox", () => {
    // Pack
    const tarball = execSync("npm pack", {
      cwd: PACKAGE_DIR,
      encoding: "utf-8",
    }).trim().split("\n").pop()!.trim();
    const tarballPath = join(PACKAGE_DIR, tarball);

    const sandbox = mkdtempSync(join(tmpdir(), "pi-droid-sandbox-"));
    try {
      // Copy tarball to sandbox
      copyFileSync(tarballPath, join(sandbox, tarball));

      // Create minimal package.json
      writeFileSync(join(sandbox, "package.json"), JSON.stringify({
        name: "test-sandbox",
        private: true,
        type: "module",
        dependencies: { "@artemisai/pi-droid": `file:./${tarball}` },
      }));

      // Install
      execSync("npm install", { cwd: sandbox, stdio: "pipe" });

      // Verify installed
      const pkgDir = join(sandbox, "node_modules/@artemisai/pi-droid");
      expect(existsSync(pkgDir)).toBe(true);
      expect(existsSync(join(pkgDir, "dist/index.js"))).toBe(true);
      expect(existsSync(join(pkgDir, "dist/index.d.ts"))).toBe(true);
      expect(existsSync(join(pkgDir, "skills/android-screen/SKILL.md"))).toBe(true);

      // Verify pi manifest
      const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
      expect(pkg.pi.extensions).toContain("./dist/index.js");
      expect(pkg.pi.skills).toContain("./skills");

      // Verify no flows leaked
      expect(existsSync(join(pkgDir, "dist/flows"))).toBe(false);

      // Verify no personal data
      const configContent = readFileSync(join(pkgDir, "config/default.json"), "utf-8");
      expect(configContent).not.toContain("hinge");
      expect(configContent).not.toContain("1440");
      expect(configContent).not.toContain("2960");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
      if (existsSync(tarballPath)) rmSync(tarballPath);
    }
  }, 60_000);
});

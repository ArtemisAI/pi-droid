import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import type { PluginCapability } from "../../src/plugins/interface.js";
import { CliPlugin, type CliPluginConfig, type CommandMapping } from "../../src/plugins/cli-plugin.js";

const mockExecFile = vi.mocked(execFile);

const CAPABILITIES: PluginCapability[] = [
  { name: "demo.ping", description: "Ping", requiresApproval: false },
];

const COMMAND_MAP: Record<string, CommandMapping> = {
  "demo.ping": { command: "ping" },
};

class DemoPlugin extends CliPlugin {
  readonly name = "demo";
  readonly displayName = "Demo";
  readonly targetApps = ["com.demo"];

  constructor(config: CliPluginConfig = { cli_command: "demo-cli" }) {
    super(config, CAPABILITIES, COMMAND_MAP);
  }

  async runHeartbeatLikeFlow() {
    return this.runWithBudget(async () => {
      const first = await this.execute("demo.ping", {});
      if (!first.success) return first;
      return this.execute("demo.ping", {});
    });
  }
}

function mockStdout(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const cb = typeof _opts === "function" ? _opts : callback;
    if (cb) cb(null, { stdout, stderr: "" });
    return {} as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CliPlugin budget enforcement", () => {
  it("does not enforce budget when task_budget is not configured", async () => {
    mockStdout('{"ok":true}');
    const plugin = new DemoPlugin({ cli_command: "demo-cli" });

    for (let i = 0; i < 55; i++) {
      const result = await plugin.execute("demo.ping", {});
      expect(result.success).toBe(true);
      expect(result.budget).toBeUndefined();
    }
  });

  it("attaches budget report to successful execute results", async () => {
    mockStdout('{"ok":true}');
    const plugin = new DemoPlugin({ cli_command: "demo-cli", task_budget: { stepLimit: 5, timeLimitMs: 60000 } });

    const result = await plugin.execute("demo.ping", {});

    expect(result.success).toBe(true);
    expect(result.budget).toMatchObject({ stepsUsed: 1, stepLimit: 5, timeLimit: 60000 });
  });

  it("returns structured budget_exceeded when step limit is exceeded", async () => {
    mockStdout('{"ok":true}');
    const plugin = new DemoPlugin({ cli_command: "demo-cli", task_budget: { stepLimit: 1, timeLimitMs: 60000 } });

    const result = await plugin.runHeartbeatLikeFlow();

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ code: "budget_exceeded", action: "demo.ping" });
    expect(result.budget).toMatchObject({ stepsUsed: 1, stepLimit: 1 });
  });
});

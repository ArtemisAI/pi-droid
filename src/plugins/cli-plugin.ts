/**
 * Generic CLI plugin — wraps any JSON-outputting CLI tool as a pi-droid plugin.
 * Subclasses just define the command mapping and capabilities.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTaskBudget, type TaskBudgetTracker } from "../adb/task-budget.js";
import type {
  PiDroidPlugin,
  PluginCapability,
  PluginStatus,
  PluginActionResult,
  PluginTaskBudgetConfig,
} from "./interface.js";

const exec = promisify(execFile);

export interface CommandMapping {
  /** CLI subcommand string (e.g., "myapp scrape", "adb status") */
  command: string;
  /** Build CLI args from action params. Defaults to no args. */
  args?: (params: Record<string, unknown>) => string[];
  /** Build a logEntry from the result data. If omitted, no logEntry is attached. */
  logEntry?: (params: Record<string, unknown>, data: Record<string, unknown>) => PluginActionResult["logEntry"];
}

export interface CliPluginConfig {
  /** CLI binary name or path (e.g., "weather-cli") */
  cli_command: string;
  /** Per-run automation budget */
  task_budget?: PluginTaskBudgetConfig;
  /** Additional plugin-specific config — subclasses can extend */
  [key: string]: unknown;
}

export abstract class CliPlugin implements PiDroidPlugin {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly targetApps: string[];

  protected config: CliPluginConfig = { cli_command: "" };
  private readonly capabilities: PluginCapability[];
  private readonly commandMap: Record<string, CommandMapping>;
  private activeBudget: TaskBudgetTracker | null = null;

  constructor(
    defaultConfig: CliPluginConfig,
    capabilities: PluginCapability[],
    commandMap: Record<string, CommandMapping>,
  ) {
    this.config = defaultConfig;
    this.capabilities = capabilities;
    this.commandMap = commandMap;
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = { ...this.config, ...config } as CliPluginConfig;
  }

  getCapabilities(): PluginCapability[] {
    return this.capabilities;
  }

  protected async runWithBudget<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeBudget || !this.config.task_budget) {
      return await fn();
    }

    const previousBudget = this.activeBudget;
    this.activeBudget = createTaskBudget(this.config.task_budget);
    try {
      return await fn();
    } finally {
      this.activeBudget = previousBudget;
    }
  }

  private getOrCreateBudget(): TaskBudgetTracker | null {
    if (this.activeBudget) {
      return this.activeBudget;
    }
    if (!this.config.task_budget) {
      return null;
    }
    return createTaskBudget(this.config.task_budget);
  }

  private budgetExceededResult(action: string, budget: TaskBudgetTracker): PluginActionResult {
    return {
      success: false,
      error: `Task budget exceeded before action: ${action}`,
      data: {
        code: "budget_exceeded",
        action,
      },
      budget: budget.report(),
    };
  }

  private withBudget(result: PluginActionResult, budget: TaskBudgetTracker): PluginActionResult {
    return { ...result, budget: budget.report() };
  }

  /**
   * Execute a CLI subcommand and parse the JSON response.
   * Tries stdout first, then stderr (some tools put error JSON there).
   */
  protected async runCli(command: string, args: string[] = []): Promise<Record<string, unknown>> {
    const fullArgs = command.split(" ").concat(args);
    try {
      const { stdout } = await exec(this.config.cli_command, fullArgs, {
        timeout: 60_000,
        env: { ...process.env },
      });
      return JSON.parse(stdout.trim());
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      const stderr = error.stderr ?? "";
      try {
        return JSON.parse(stderr.trim());
      } catch {
        throw new Error(`CLI failed: ${stderr || error.message}`);
      }
    }
  }

  /**
   * Default execute — looks up the action in the command map and runs it.
   * Subclasses can override for custom actions.
   */
  async execute(action: string, params: Record<string, unknown>): Promise<PluginActionResult> {
    const mapping = this.commandMap[action];
    if (!mapping) {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const budget = this.getOrCreateBudget();
    if (budget?.exceeded()) {
      return this.budgetExceededResult(action, budget);
    }
    budget?.tick();

    try {
      const args = mapping.args ? mapping.args(params) : [];
      const data = await this.runCli(mapping.command, args);
      const logEntry = mapping.logEntry ? mapping.logEntry(params, data) : undefined;
      if (!budget) {
        return { success: true, data, logEntry };
      }
      return this.withBudget({ success: true, data, logEntry }, budget);
    } catch (err) {
      const failure: PluginActionResult = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      if (!budget) {
        return failure;
      }
      return this.withBudget(failure, budget);
    }
  }

  /** Override in subclasses for custom status logic. */
  async getStatus(): Promise<PluginStatus> {
    return { ready: true, message: `${this.displayName} plugin loaded` };
  }

  /** Override in subclasses for autonomous heartbeat behavior. */
  async onHeartbeat(): Promise<PluginActionResult | null> {
    return null;
  }

  async destroy(): Promise<void> {
    // Default no-op — subclasses can override.
  }
}

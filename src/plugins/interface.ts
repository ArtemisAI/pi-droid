/**
 * Pi-Droid Plugin Interface
 *
 * Plugins are independent modules that handle automation for specific apps.
 * Each plugin wraps an external CLI tool or API and exposes a standard interface
 * for the agent to discover capabilities, execute actions, and respond to heartbeats.
 */

import type { TaskBudgetConfig, TaskBudgetReport } from "../adb/types.js";

export type PluginTaskBudgetConfig = TaskBudgetConfig;
export type PluginTaskBudgetReport = TaskBudgetReport;

export interface PluginCapability {
  /** Unique action name (e.g., "myapp.scrape", "weather.fetch") */
  name: string;
  /** Human-readable description for LLM tool registration */
  description: string;
  /** Whether this action requires human approval before execution */
  requiresApproval: boolean;
  /** JSON schema for parameters (TypeBox compatible) */
  parameters?: Record<string, unknown>;
}

export interface PluginStatus {
  /** Is the plugin ready to operate? */
  ready: boolean;
  /** Human-readable status message */
  message: string;
  /** Rate limit info if applicable */
  rateLimit?: {
    remaining: number;
    limit: number;
    resetsAt?: string;
  };
  /** Plugin-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface PluginActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  budget?: PluginTaskBudgetReport;
  /** Actions that should be logged for training */
  logEntry?: {
    actionType: string;
    details: Record<string, unknown>;
    screenshotPath?: string;
    uiDumpPath?: string;
  };
}

export interface PiDroidPlugin {
  /** Unique plugin identifier */
  readonly name: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Android package names this plugin automates */
  readonly targetApps: string[];

  /** Called once when the plugin is loaded */
  initialize(config: Record<string, unknown>): Promise<void>;

  /** Returns all capabilities this plugin offers */
  getCapabilities(): PluginCapability[];

  /** Returns current plugin status (rate limits, device state, etc.) */
  getStatus(): Promise<PluginStatus>;

  /** Execute a named action with parameters */
  execute(action: string, params: Record<string, unknown>): Promise<PluginActionResult>;

  /** Called on each heartbeat cycle — plugin decides what to do autonomously */
  onHeartbeat(): Promise<PluginActionResult | null>;

  /** Graceful shutdown */
  destroy(): Promise<void>;
}

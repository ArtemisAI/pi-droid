import { TelegramChannel } from "../notifications/telegram.js";
import type { ParsedCommand } from "../notifications/interface.js";
import type { PiDroidPlugin, PluginActionResult, PluginCapability, PluginStatus } from "./interface.js";

interface TelegramPluginConfig {
  bot_token?: string;
  chat_id?: string;
  timeout_minutes?: number;
  heartbeat_poll_interval_ms?: number;
  allowed_commands?: string[];
}

const CAPABILITIES: PluginCapability[] = [
  {
    name: "telegram.status",
    description: "Get Telegram integration status, pending approvals, and queued commands",
    requiresApproval: false,
  },
  {
    name: "telegram.notify",
    description: "Send a Telegram notification message",
    requiresApproval: true,
    parameters: { text: "string" },
  },
  {
    name: "telegram.summary",
    description: "Send a summary message with key/value fields",
    requiresApproval: true,
    parameters: { summary: "object" },
  },
  {
    name: "telegram.screenshot",
    description: "Forward an annotated screenshot to Telegram",
    requiresApproval: true,
    parameters: { photo_path: "string", caption: "string?" },
  },
  {
    name: "telegram.request_approval",
    description: "Send an approval request with Approve/Deny inline buttons",
    requiresApproval: true,
    parameters: { prompt: "string", score: "number?", timeout_minutes: "number?", metadata: "object?" },
  },
  {
    name: "telegram.poll",
    description: "Poll Telegram updates for approval decisions and manual override commands",
    requiresApproval: false,
  },
];

export class TelegramPlugin implements PiDroidPlugin {
  readonly name = "telegram";
  readonly displayName = "Telegram HITL";
  readonly targetApps = ["org.telegram.messenger"];

  private channel: TelegramChannel | null = null;
  private paused = false;
  private commands: ParsedCommand[] = [];
  private heartbeatPollIntervalMs = 5000;
  private lastHeartbeatPollAt = 0;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const cfg = config as TelegramPluginConfig;
    const botToken = cfg.bot_token ?? process.env.TELEGRAM_BOT_TOKEN;
    const chatId = cfg.chat_id ?? process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) return;

    this.channel = new TelegramChannel({
      botToken: String(botToken),
      chatId: String(chatId),
      timeoutMinutes: cfg.timeout_minutes,
      allowedCommands: cfg.allowed_commands ?? ["like", "skip", "status", "pause", "resume"],
    });
    this.heartbeatPollIntervalMs = Number(cfg.heartbeat_poll_interval_ms ?? 5000);
  }

  getCapabilities(): PluginCapability[] {
    return CAPABILITIES;
  }

  async getStatus(): Promise<PluginStatus> {
    if (!this.channel) {
      return {
        ready: false,
        message: "Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID or plugin config)",
      };
    }
    return {
      ready: true,
      message: this.paused ? "Telegram connected (paused)" : "Telegram connected",
      metadata: {
        paused: this.paused,
        pendingApprovals: this.channel.getPendingApprovals(),
        queuedCommands: this.commands.length,
      },
    };
  }

  async execute(action: string, params: Record<string, unknown>): Promise<PluginActionResult> {
    if (action === "telegram.status") {
      const status = await this.getStatus();
      return { success: true, data: { ...status } };
    }

    if (!this.channel) {
      return { success: false, error: "Telegram is not configured" };
    }

    try {
      if (action === "telegram.notify") {
        await this.channel.sendMessage(String(params.text ?? ""));
        return { success: true, data: { sent: true } };
      }

      if (action === "telegram.summary") {
        const summary =
          (params.summary as Record<string, unknown>) ??
          {
            profiles_seen: params.profiles_seen,
            likes_sent: params.likes_sent,
            matches_gained: params.matches_gained,
          };
        await this.channel.sendSummary(summary);
        return { success: true, data: { sent: true } };
      }

      if (action === "telegram.screenshot") {
        await this.channel.sendScreenshot({
          photoPath: String(params.photo_path ?? ""),
          caption: params.caption ? String(params.caption) : undefined,
        });
        return { success: true, data: { sent: true } };
      }

      if (action === "telegram.request_approval") {
        const id = await this.channel.requestApproval({
          prompt: String(params.prompt ?? ""),
          score: params.score !== undefined ? Number(params.score) : undefined,
          timeoutMinutes: params.timeout_minutes !== undefined ? Number(params.timeout_minutes) : undefined,
          metadata: (params.metadata as Record<string, unknown>) ?? undefined,
        });
        return { success: true, data: { approval_id: id } };
      }

      if (action === "telegram.poll") {
        const pollResult = await this.channel.poll();
        this.commands.push(...pollResult.commands);
        this.applyControlCommands(pollResult.commands);
        return {
          success: true,
          data: {
            paused: this.paused,
            approvals: pollResult.approvals,
            commands: pollResult.commands,
          },
        };
      }

      return { success: false, error: `Unknown action: ${action}` };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async onHeartbeat(): Promise<PluginActionResult | null> {
    if (!this.channel || this.paused) return null;
    const now = Date.now();
    if (now - this.lastHeartbeatPollAt < this.heartbeatPollIntervalMs) return null;
    this.lastHeartbeatPollAt = now;
    return this.execute("telegram.poll", {});
  }

  async destroy(): Promise<void> {}

  private applyControlCommands(commands: ParsedCommand[]): void {
    for (const command of commands) {
      if (command.command === "pause") this.paused = true;
      if (command.command === "resume") this.paused = false;
    }
  }
}

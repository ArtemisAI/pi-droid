export type ApprovalDecision = "approve" | "deny" | "timeout";

export interface ApprovalRequest {
  id?: string;
  prompt: string;
  score?: number;
  timeoutMinutes?: number;
  metadata?: Record<string, unknown>;
}

export interface ApprovalResult {
  id: string;
  decision: ApprovalDecision;
  source: "channel_callback" | "timeout";
  metadata?: Record<string, unknown>;
}

export type ManualOverrideCommand = string;

export interface ParsedCommand {
  command: ManualOverrideCommand;
  args: string[];
  raw: string;
}

export interface NotificationChannel {
  sendMessage(text: string): Promise<void>;
  sendSummary(summary: Record<string, unknown>): Promise<void>;
  sendScreenshot(input: { photoPath: string; caption?: string }): Promise<void>;
  requestApproval(request: ApprovalRequest): Promise<string>;
  poll(): Promise<{
    approvals: ApprovalResult[];
    commands: ParsedCommand[];
  }>;
}

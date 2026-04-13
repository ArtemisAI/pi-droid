import type { TaskBudget, TaskBudgetConfig, TaskBudgetReport } from "./types.js";

export const DEFAULT_TASK_BUDGET: Readonly<Required<TaskBudgetConfig>> = {
  stepLimit: 50,
  timeLimitMs: 5 * 60 * 1000,
};

export class TaskBudgetTracker implements TaskBudget {
  readonly steps: { used: number; limit: number };
  readonly time: { startedAt: number; limitMs: number };

  constructor(config: TaskBudgetConfig = {}) {
    this.steps = { used: 0, limit: config.stepLimit ?? DEFAULT_TASK_BUDGET.stepLimit };
    this.time = { startedAt: Date.now(), limitMs: config.timeLimitMs ?? DEFAULT_TASK_BUDGET.timeLimitMs };
  }

  exceeded(): boolean {
    return this.steps.used >= this.steps.limit || Date.now() - this.time.startedAt >= this.time.limitMs;
  }

  tick(): void {
    this.steps.used += 1;
  }

  report(): TaskBudgetReport {
    return {
      stepsUsed: this.steps.used,
      stepLimit: this.steps.limit,
      timeElapsed: Date.now() - this.time.startedAt,
      timeLimit: this.time.limitMs,
    };
  }
}

export function createTaskBudget(config: TaskBudgetConfig = {}): TaskBudgetTracker {
  return new TaskBudgetTracker(config);
}


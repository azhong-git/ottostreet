import cron, { type ScheduledTask } from "node-cron";
import {
  missingCapabilities,
  type ProviderRegistry,
  type SignalSkill,
  type SkillContext,
} from "@ottostreet/core";
import type { Store } from "./db.js";

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private running = new Set<string>();

  constructor(
    private readonly skills: SignalSkill[],
    private readonly providers: ProviderRegistry,
    private readonly store: Store,
  ) {}

  start(): void {
    for (const skill of this.skills) {
      const missing = missingCapabilities(this.providers, skill.requires);
      if (missing.length > 0) {
        console.warn(`[scheduler] skill "${skill.id}" disabled — missing capabilities: ${missing.join(", ")}`);
        continue;
      }
      this.tasks.push(cron.schedule(skill.schedule, () => void this.runSkill(skill)));
      console.log(`[scheduler] skill "${skill.id}" scheduled (${skill.schedule})`);
    }
  }

  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
  }

  /** Run every runnable skill against the whole watchlist once. */
  async runAllOnce(): Promise<{ skillsRun: number; signalsStored: number }> {
    let signalsStored = 0;
    let skillsRun = 0;
    for (const skill of this.skills) {
      if (missingCapabilities(this.providers, skill.requires).length > 0) continue;
      skillsRun += 1;
      signalsStored += await this.runSkill(skill);
    }
    return { skillsRun, signalsStored };
  }

  private async runSkill(skill: SignalSkill): Promise<number> {
    // Guard against a slow run overlapping the next cron tick.
    if (this.running.has(skill.id)) return 0;
    this.running.add(skill.id);
    let stored = 0;
    try {
      const ctx: SkillContext = {
        providers: this.providers,
        log: (msg) => console.log(`[${skill.id}] ${msg}`),
        now: () => new Date(),
      };
      for (const ticker of this.store.listSymbols()) {
        try {
          const signals = await skill.run(ctx, ticker);
          for (const signal of signals) {
            if (this.store.insertSignal(signal)) stored += 1;
          }
        } catch (err) {
          console.error(`[${skill.id}] ${ticker} failed:`, err);
        }
      }
    } finally {
      this.running.delete(skill.id);
    }
    if (stored > 0) console.log(`[${skill.id}] stored ${stored} new signal(s)`);
    return stored;
  }
}

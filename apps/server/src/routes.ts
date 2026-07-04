import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SignalSkill } from "@ottostreet/core";
import type { Store } from "./db.js";
import type { Scheduler } from "./scheduler.js";

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.\-]{0,9}$/, "invalid ticker symbol");

export function registerRoutes(
  app: FastifyInstance,
  store: Store,
  scheduler: Scheduler,
  skills: SignalSkill[],
): void {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/skills", async () =>
    skills.map(({ id, name, description, schedule, requires }) => ({
      id,
      name,
      description,
      schedule,
      requires,
    })),
  );

  app.get("/api/watchlist", async () => store.listSymbols());

  app.post("/api/watchlist", async (req, reply) => {
    const parsed = z.object({ symbol: symbolSchema }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    store.addSymbol(parsed.data.symbol);
    return { ok: true, watchlist: store.listSymbols() };
  });

  app.delete("/api/watchlist/:symbol", async (req, reply) => {
    const parsed = symbolSchema.safeParse((req.params as any).symbol);
    if (!parsed.success) return reply.code(400).send({ error: "invalid ticker symbol" });
    store.removeSymbol(parsed.data);
    return { ok: true, watchlist: store.listSymbols() };
  });

  app.get("/api/signals", async (req) => {
    const query = z
      .object({
        ticker: symbolSchema.optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(req.query ?? {});
    return store.listSignals(query);
  });

  /** Trigger an immediate run of all skills across the watchlist. */
  app.post("/api/run", async () => scheduler.runAllOnce());
}

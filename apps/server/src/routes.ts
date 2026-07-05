import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BarInterval, ProviderRegistry, SignalSkill } from "@otterstreet/core";
import type { Store } from "./db.js";
import type { Scheduler } from "./scheduler.js";

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.\-]{0,9}$/, "invalid ticker symbol");

/** Default lookback (calendar days) per interval — enough bars to be useful,
 *  small enough to stay cheap on rate-limited tiers. */
const LOOKBACK_DAYS: Record<BarInterval, number> = {
  "1m": 3,
  "5m": 7,
  "15m": 14,
  "1h": 60,
  "1d": 365,
};

export function registerRoutes(
  app: FastifyInstance,
  store: Store,
  scheduler: Scheduler,
  skills: SignalSkill[],
  providers: ProviderRegistry,
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

  /**
   * OHLCV bars for a ticker's candlestick chart.
   * Query: interval (1m|5m|15m|1h|1d, default 1d), days (optional lookback override).
   * All intervals (incl. intraday) are served by the required Polygon Stocks
   * Starter plan. Provider errors surface as 502.
   */
  app.get("/api/bars/:symbol", async (req, reply) => {
    const symParsed = symbolSchema.safeParse((req.params as any).symbol);
    if (!symParsed.success) return reply.code(400).send({ error: "invalid ticker symbol" });
    const parsedQuery = z
      .object({
        interval: z.enum(["1m", "5m", "15m", "1h", "1d"]).default("1d"),
        days: z.coerce.number().int().positive().max(1825).optional(),
      })
      .safeParse(req.query ?? {});
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: parsedQuery.error.issues[0]?.message ?? "invalid query" });
    }
    const query = parsedQuery.data;

    if (!providers.bars) {
      return reply.code(501).send({ error: "no bars provider configured" });
    }
    const days = query.days ?? LOOKBACK_DAYS[query.interval];
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    try {
      return await providers.bars.getBars(
        symParsed.data,
        query.interval,
        from.toISOString(),
        to.toISOString(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: message });
    }
  });

  /**
   * Trigger an immediate skill run.
   * Body (optional): { ticker?: string, dedupe?: boolean }
   *  - ticker omitted → whole watchlist; provided → just that symbol.
   *  - dedupe defaults true; false stores every signal even if recently seen.
   */
  app.post("/api/run", async (req, reply) => {
    const parsed = z
      .object({ ticker: symbolSchema.optional(), dedupe: z.boolean().optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    return scheduler.runOnce(parsed.data);
  });
}

import Fastify from "fastify";
import cors from "@fastify/cors";
import type { ProviderRegistry, SignalSkill } from "@ottostreet/core";
import { MockProvider, PolygonProvider, TradierProvider } from "@ottostreet/providers";
import { gexSkill } from "@ottostreet/skill-gex";
import { loadConfig, type ProviderName, type ServerConfig } from "./config.js";
import { Store } from "./db.js";
import { Scheduler } from "./scheduler.js";
import { registerRoutes } from "./routes.js";

type AnyProvider = MockProvider | PolygonProvider | TradierProvider;

const warned = new Set<ProviderName>();

/**
 * Resolve a requested provider to one we can actually construct. Polygon and
 * Tradier require credentials; if they're missing we fall back to mock so the
 * app still boots zero-config (useful for a first run before adding a key).
 * Warns once per provider since it's called for each capability.
 */
function resolveProvider(name: ProviderName, config: ServerConfig): ProviderName {
  if (name === "polygon" && !config.polygonApiKey) {
    if (!warned.has(name)) {
      console.warn("[server] PROVIDER=polygon but POLYGON_API_KEY is not set — falling back to mock");
      warned.add(name);
    }
    return "mock";
  }
  if (name === "tradier" && !config.tradierToken) {
    if (!warned.has(name)) {
      console.warn("[server] tradier selected but TRADIER_TOKEN is not set — falling back to mock");
      warned.add(name);
    }
    return "mock";
  }
  return name;
}

/**
 * Build the provider registry, honoring per-capability overrides
 * (QUOTES_PROVIDER / BARS_PROVIDER / OPTIONS_PROVIDER) so data plans can be
 * mixed as more providers are added. Provider instances are shared across
 * capabilities.
 */
function buildProviders(config: ServerConfig): ProviderRegistry {
  const instances = new Map<ProviderName, AnyProvider>();
  const instance = (requested: ProviderName): AnyProvider => {
    const name = resolveProvider(requested, config);
    let p = instances.get(name);
    if (!p) {
      p =
        name === "polygon"
          ? new PolygonProvider({ apiKey: config.polygonApiKey })
          : name === "tradier"
            ? new TradierProvider({ token: config.tradierToken, env: config.tradierEnv })
            : new MockProvider();
      instances.set(name, p);
    }
    return p;
  };

  const quotes = instance(config.quotesProvider);
  const optionsChain = instance(config.optionsProvider);
  const bars = instance(config.barsProvider);
  console.log(
    `[server] providers — quotes: ${resolveProvider(config.quotesProvider, config)}, ` +
      `options: ${resolveProvider(config.optionsProvider, config)}, ` +
      `bars: ${resolveProvider(config.barsProvider, config)}`,
  );
  return { quotes, optionsChain, bars };
}

async function main(): Promise<void> {
  const config = loadConfig();

  const providers = buildProviders(config);

  const skills: SignalSkill[] = [gexSkill];
  const store = new Store(config.dbPath);
  const scheduler = new Scheduler(skills, providers, store);

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  registerRoutes(app, store, scheduler, skills);

  scheduler.start();
  await app.listen({ port: config.port, host: "127.0.0.1" });
  console.log(`[server] ottostreet listening on http://127.0.0.1:${config.port} (provider: ${config.provider})`);

  const shutdown = async () => {
    scheduler.stop();
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

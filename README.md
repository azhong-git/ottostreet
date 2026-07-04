# ottostreet

Open-source stock & options signal engine. Add tickers to a watchlist; pluggable
**skills** poll market data, filings, and news sources on a schedule and generate
bullish/bearish signals with plain-language rationale. LLM-assisted skills (news,
social sentiment) use your own OpenAI API key. Not high-frequency by design —
minute-cadence polling, human-in-the-loop trading.

> **Not financial advice.** Signals are heuristics over public data. Do your own research.

## Quickstart (zero API keys)

```bash
pnpm install
pnpm dev
```

- Server: http://127.0.0.1:8420 (Fastify + SQLite)
- Web UI: http://127.0.0.1:5173 (Vite + React, proxies `/api` to the server)

With no `POLYGON_API_KEY` set, the server falls back to the **mock provider**
(deterministic synthetic quotes and options chains), so you can add a ticker,
click **Run skills now**, and see GEX signals immediately.

### Real market data (Polygon, free)

Polygon.io is the default provider and covers everything the skills need —
quotes, OHLCV bars, and options chains with open interest and greeks — with a
**single API key**.

1. Get a free API key from the [Polygon dashboard](https://polygon.io/dashboard/keys).
2. `cp .env.example .env`, set `POLYGON_API_KEY=...` (leave `PROVIDER=polygon`).
3. Restart the server.

**Does the free tier work?** Yes. The free "Basic" plan gives **one key for both
stocks and options** (no separate options subscription — that split only applies
to paid *real-time* plans) with two caveats:

- **5 calls/minute.** The GEX skill uses ~5 calls per ticker, so the free tier
  handles roughly **one ticker per minute**. The provider retries with backoff
  on HTTP 429, so a larger watchlist just runs slower rather than failing.
- **Delayed / end-of-day data.** This barely matters for these skills: OCC
  publishes open interest only once daily, so GEX / call wall / max pain are
  computed on data that's current regardless. You lose real-time *spot* price
  precision, not the core signal.

Tradier is supported as an alternative (`PROVIDER=tradier`, `TRADIER_TOKEN=...`);
it needs a brokerage account. Providers are selected per capability
(`QUOTES_PROVIDER`, `BARS_PROVIDER`, `OPTIONS_PROVIDER` override `PROVIDER`), so
plans can be mixed as more providers are added.

## Architecture

```
apps/
  server/          Fastify API + cron scheduler + SQLite (watchlist, signals)
  web/             React UI (watchlist, signal feed)
packages/
  core/            Types: providers (capabilities), SignalSkill, Signal
  providers/       Market data providers: Polygon, Tradier, Mock
  skills/
    gex/           Gamma exposure: call wall, put wall, gamma flip, squeeze setups
```

**Providers** implement *capabilities* (`quotes`, `options_chain`, `bars`, later
`news`, `filings`, `llm`, `scrape`). **Skills** declare which capabilities they
need plus a cron schedule; the scheduler runs each skill against every watchlist
ticker and dedupes repeated headlines. One options-chain subscription feeds many
skills (GEX, call wall, max pain, put/call) without duplicate fetching.

### Writing a skill

```ts
import type { SignalSkill } from "@ottostreet/core";

export const mySkill: SignalSkill = {
  id: "my-skill",
  name: "My Skill",
  description: "…",
  schedule: "*/15 * * * *",
  requires: ["quotes"],
  async run(ctx, ticker) {
    const quote = await ctx.providers.quotes!.getQuote(ticker);
    return [/* Signal[] */];
  },
};
```

Register it in `apps/server/src/index.ts` (`skills` array). Skills that scrape
websites without an official API must require the `"scrape"` capability so
hosted deployments can disable them (`ENABLE_SCRAPE_SKILLS=false`).

## Skill roadmap

| Skill | Data source | Status |
|---|---|---|
| GEX / call wall / gamma flip | Options chain (Polygon/Tradier) | ✅ shipped |
| Max pain, put/call ratio | Options chain, CBOE | planned |
| Technicals (RSI, Bollinger, prior high, volume trend) | OHLCV bars | planned |
| Month-end pension rebalancing | Calendar rule + index bars | planned |
| Insider sale notices (Form 144 / Form 4) | SEC EDGAR (free) | planned |
| 13F institutional holdings diff | SEC EDGAR / 13f.info | planned |
| IPO lockup expirations | EDGAR S-1/424B4, calendars | planned |
| Analyst upgrades/downgrades | FMP / Benzinga | planned |
| Earnings & peer-earnings calendar | FMP / Finnhub | planned |
| Reddit sentiment | Reddit API + LLM | planned |
| Layoff news | WARN notices, layoffs.fyi, news APIs + LLM | planned |
| YouTube channel monitor | YouTube Data API + LLM | planned |
| Risk-off regime (yields, DXY, gold, VIX) | FRED (free) | planned |
| Order flow (large prints/sweeps) | Polygon trades, Databento | planned |

## License

[AGPL-3.0](LICENSE). The core is and will remain open source for local
deployment; a hosted version with premium skills may be offered separately.

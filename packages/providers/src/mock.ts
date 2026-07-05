import type {
  Bar,
  BarInterval,
  BarsProvider,
  OptionContract,
  OptionsChainProvider,
  Quote,
  QuoteProvider,
} from "@otterstreet/core";

/**
 * Deterministic synthetic market data so the app runs end-to-end with zero
 * API keys. Each symbol gets a stable base price from a hash; the options
 * chain has call open interest concentrated a few percent above spot so the
 * GEX skill has a realistic call wall to find.
 */
export class MockProvider implements QuoteProvider, OptionsChainProvider, BarsProvider {
  private basePrice(symbol: string): number {
    let h = 0;
    for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) % 100_000;
    return 40 + (h % 300);
  }

  private spot(symbol: string, at = new Date()): number {
    const base = this.basePrice(symbol);
    // Slow intraday wobble so repeated polls aren't identical.
    const wobble = Math.sin(at.getTime() / 3_600_000) * 0.01;
    return round2(base * (1 + wobble));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const last = this.spot(symbol);
    return {
      symbol,
      last,
      bid: round2(last - 0.02),
      ask: round2(last + 0.02),
      volume: 1_000_000 + (this.basePrice(symbol) * 1000) % 5_000_000,
      timestamp: new Date().toISOString(),
    };
  }

  async getExpirations(_symbol: string): Promise<string[]> {
    // Next four Fridays.
    const dates: string[] = [];
    const d = new Date();
    while (dates.length < 4) {
      d.setDate(d.getDate() + 1);
      if (d.getUTCDay() === 5) dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  async getChain(symbol: string, expiration: string): Promise<OptionContract[]> {
    const spot = this.spot(symbol);
    const step = niceStrikeStep(spot);
    const contracts: OptionContract[] = [];
    const yearsToExpiry = Math.max(
      (new Date(expiration).getTime() - Date.now()) / (365 * 86_400_000),
      1 / 365,
    );
    const iv = 0.35;
    // Call OI peaks ~3% above spot (the "call wall"); put OI peaks ~5% below.
    const callPeak = spot * 1.03;
    const putPeak = spot * 0.95;

    const lowest = Math.floor((spot * 0.8) / step) * step;
    for (let strike = lowest; strike <= spot * 1.2; strike += step) {
      const gamma = blackScholesGamma(spot, strike, yearsToExpiry, iv);
      for (const type of ["call", "put"] as const) {
        const peak = type === "call" ? callPeak : putPeak;
        const openInterest = Math.round(
          20_000 * Math.exp(-((strike - peak) ** 2) / (2 * (spot * 0.04) ** 2)),
        );
        contracts.push({
          symbol: `${symbol}${expiration.replaceAll("-", "")}${type === "call" ? "C" : "P"}${strike}`,
          underlying: symbol,
          type,
          strike: round2(strike),
          expiration,
          openInterest,
          volume: Math.round(openInterest * 0.15),
          greeks: { gamma, iv },
          underlyingPrice: spot,
        });
      }
    }
    return contracts;
  }

  async getBars(symbol: string, interval: BarInterval, from: string, to: string): Promise<Bar[]> {
    const stepMs = INTERVAL_MS[interval];
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    const bars: Bar[] = [];
    // Cap the count so a wide range at a fine interval stays reasonable.
    const maxBars = 2000;
    const first = Math.max(start, end - maxBars * stepMs);
    for (let t = first; t <= end; t += stepMs) {
      const mid = this.spot(symbol, new Date(t));
      // Synthesize a little intrabar range that wanders with the step.
      const drift = Math.sin(t / (stepMs * 7)) * mid * 0.004;
      const open = round2(mid - drift);
      const close = round2(mid + drift);
      bars.push({
        time: new Date(t).toISOString(),
        open,
        high: round2(Math.max(open, close) * 1.002),
        low: round2(Math.min(open, close) * 0.998),
        close,
        volume: 10_000 + (Math.abs(Math.round(drift * 1000)) % 90_000),
      });
    }
    return bars;
  }
}

const INTERVAL_MS: Record<BarInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function niceStrikeStep(spot: number): number {
  if (spot < 50) return 1;
  if (spot < 100) return 2.5;
  if (spot < 250) return 5;
  return 10;
}

/** Black–Scholes gamma: φ(d1) / (S·σ·√T). */
function blackScholesGamma(spot: number, strike: number, years: number, iv: number, rate = 0.04): number {
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + iv ** 2 / 2) * years) / (iv * sqrtT);
  const pdf = Math.exp(-(d1 ** 2) / 2) / Math.sqrt(2 * Math.PI);
  return pdf / (spot * iv * sqrtT);
}

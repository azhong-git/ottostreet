import type {
  Bar,
  BarInterval,
  BarsProvider,
  OptionContract,
  OptionsChainProvider,
  Quote,
  QuoteProvider,
} from "@ottostreet/core";

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
        });
      }
    }
    return contracts;
  }

  async getBars(symbol: string, _interval: BarInterval, from: string, to: string): Promise<Bar[]> {
    const bars: Bar[] = [];
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    for (let t = start; t <= end; t += 60_000) {
      const price = this.spot(symbol, new Date(t));
      bars.push({
        time: new Date(t).toISOString(),
        open: price,
        high: round2(price * 1.001),
        low: round2(price * 0.999),
        close: price,
        volume: 10_000,
      });
    }
    return bars;
  }
}

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

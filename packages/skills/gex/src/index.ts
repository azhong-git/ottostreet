import type { Signal, SignalSkill, SkillContext } from "@otterstreet/core";
import { computeGexProfile, type GexProfile } from "./compute.js";

export { computeGexProfile, type GexProfile, type StrikeGex } from "./compute.js";

const MAX_EXPIRATIONS = 3;
const MAX_DAYS_OUT = 45;

/**
 * Gamma exposure (GEX) skill: builds a dealer-gamma profile from near-dated
 * options chains and flags call-wall proximity, squeeze setups, and
 * negative-gamma regimes.
 */
export const gexSkill: SignalSkill = {
  id: "gex",
  name: "Gamma Exposure (GEX)",
  description:
    "Computes dealer gamma exposure by strike from options open interest: call wall, put wall, gamma flip, squeeze potential.",
  schedule: "*/5 * * * *",
  // options_chain is the hard requirement; quotes is only a fallback for
  // providers that don't return the underlying price with the chain.
  requires: ["options_chain"],

  async run(ctx: SkillContext, ticker: string): Promise<Signal[]> {
    const { quotes, optionsChain } = ctx.providers;
    if (!optionsChain) return [];

    const allExpirations = await optionsChain.getExpirations(ticker);
    const cutoff = new Date(ctx.now().getTime() + MAX_DAYS_OUT * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const expirations = allExpirations.filter((d) => d <= cutoff).slice(0, MAX_EXPIRATIONS);
    if (expirations.length === 0) {
      ctx.log(`gex: no expirations within ${MAX_DAYS_OUT}d for ${ticker}`);
      return [];
    }

    const chains = await Promise.all(expirations.map((e) => optionsChain.getChain(ticker, e)));
    const contracts = chains.flat();

    // Prefer the underlying spot the chain already carries (Polygon's snapshot
    // returns it), so a single options-data plan suffices. Fall back to a
    // separate quote only for providers that don't include it.
    let spot = contracts.find((c) => c.underlyingPrice && c.underlyingPrice > 0)?.underlyingPrice;
    if (spot === undefined) {
      if (!quotes) {
        ctx.log(`gex: no spot price available for ${ticker} (no underlying price in chain, no quote provider)`);
        return [];
      }
      spot = (await quotes.getQuote(ticker)).last;
    }

    const profile = computeGexProfile(spot, contracts);
    if (profile.byStrike.length === 0) {
      ctx.log(`gex: no usable contracts (missing greeks/OI) for ${ticker}`);
      return [];
    }
    return evaluate(ticker, profile);
  },
};

function evaluate(ticker: string, profile: GexProfile): Signal[] {
  const signals: Signal[] = [];
  const { spot, callWall, gammaFlip, totalNetGex } = profile;
  const data = summarize(profile);

  const wallDist = callWall !== null ? (callWall - spot) / spot : null;

  if (wallDist !== null && callWall !== null && wallDist > 0.01 && wallDist <= 0.05 && totalNetGex > 0) {
    signals.push({
      skillId: "gex",
      ticker,
      direction: "bullish",
      confidence: 0.55,
      title: `Squeeze runway: spot ${pct(wallDist)} below call wall at ${callWall}`,
      rationale:
        `Heavy call open interest sits at ${callWall} while spot is ${spot.toFixed(2)}. ` +
        `If price pushes into that strike, dealer hedging can accelerate the move toward the wall. ` +
        `Gamma squeezes rarely run past the wall — take profits near ${callWall} rather than betting higher.`,
      data,
    });
  }

  if (wallDist !== null && callWall !== null && Math.abs(wallDist) <= 0.01) {
    signals.push({
      skillId: "gex",
      ticker,
      direction: "bearish",
      confidence: 0.5,
      title: `At the call wall (${callWall}) — pin/resistance zone`,
      rationale:
        `Spot ${spot.toFixed(2)} is at the largest call-gamma strike. Dealer hedging tends to pin ` +
        `or reject price here; upside continuation usually needs the wall to roll higher first. ` +
        `This is the "sell around the wall" zone.`,
      data,
    });
  }

  if (gammaFlip !== null && spot < gammaFlip) {
    signals.push({
      skillId: "gex",
      ticker,
      direction: "bearish",
      confidence: 0.45,
      title: `Negative gamma regime: spot below flip (~${gammaFlip.toFixed(1)})`,
      rationale:
        `Spot ${spot.toFixed(2)} is below the estimated gamma flip. Dealers hedge in the direction ` +
        `of moves here, so volatility expands both ways — expect larger swings and treat rallies ` +
        `with more caution until price reclaims the flip level.`,
      data,
    });
  }

  return signals;
}

function summarize(profile: GexProfile): Record<string, unknown> {
  // Keep only the 15 strikes nearest spot so signal payloads stay small.
  const nearest = [...profile.byStrike]
    .sort((a, b) => Math.abs(a.strike - profile.spot) - Math.abs(b.strike - profile.spot))
    .slice(0, 15)
    .sort((a, b) => a.strike - b.strike);
  return {
    spot: profile.spot,
    totalNetGex: Math.round(profile.totalNetGex),
    callWall: profile.callWall,
    putWall: profile.putWall,
    gammaFlip: profile.gammaFlip,
    byStrike: nearest.map((r) => ({
      strike: r.strike,
      netGex: Math.round(r.netGex),
      callOi: r.callOi,
      putOi: r.putOi,
    })),
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

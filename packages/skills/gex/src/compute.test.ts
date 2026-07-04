import { describe, expect, it } from "vitest";
import type { OptionContract } from "@ottostreet/core";
import { computeGexProfile } from "./compute.js";

function contract(
  type: "call" | "put",
  strike: number,
  openInterest: number,
  gamma: number,
): OptionContract {
  return {
    symbol: `TEST-${type}-${strike}`,
    underlying: "TEST",
    type,
    strike,
    expiration: "2099-01-15",
    openInterest,
    greeks: { gamma },
  };
}

describe("computeGexProfile", () => {
  const spot = 100;

  it("makes call gamma positive and put gamma negative", () => {
    const profile = computeGexProfile(spot, [
      contract("call", 105, 1000, 0.02),
      contract("put", 95, 1000, 0.02),
    ]);
    const call = profile.byStrike.find((r) => r.strike === 105)!;
    const put = profile.byStrike.find((r) => r.strike === 95)!;
    expect(call.netGex).toBeGreaterThan(0);
    expect(put.netGex).toBeLessThan(0);
    // GEX = gamma × OI × 100 × spot² × 0.01 = 0.02 × 1000 × 100 × 10000 × 0.01
    expect(call.netGex).toBeCloseTo(200_000, 5);
  });

  it("finds the call wall at the strike with max call GEX", () => {
    const profile = computeGexProfile(spot, [
      contract("call", 105, 5000, 0.02),
      contract("call", 110, 20000, 0.02), // wall
      contract("call", 115, 3000, 0.02),
      contract("put", 90, 8000, 0.02),
    ]);
    expect(profile.callWall).toBe(110);
    expect(profile.putWall).toBe(90);
  });

  it("interpolates the gamma flip where cumulative net GEX crosses zero", () => {
    const profile = computeGexProfile(spot, [
      contract("put", 95, 10000, 0.02), // cumulative -2,000,000
      contract("call", 105, 10000, 0.02), // cumulative back to 0 → crosses at 105
    ]);
    expect(profile.gammaFlip).not.toBeNull();
    expect(profile.gammaFlip!).toBeGreaterThan(95);
    expect(profile.gammaFlip!).toBeLessThanOrEqual(105);
  });

  it("ignores contracts without gamma or open interest", () => {
    const noGreeks: OptionContract = {
      symbol: "X",
      underlying: "TEST",
      type: "call",
      strike: 100,
      expiration: "2099-01-15",
      openInterest: 1000,
    };
    const profile = computeGexProfile(spot, [noGreeks, contract("call", 100, 0, 0.02)]);
    expect(profile.byStrike).toHaveLength(0);
    expect(profile.totalNetGex).toBe(0);
  });
});

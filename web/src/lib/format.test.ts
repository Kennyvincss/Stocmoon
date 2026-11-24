import { describe, expect, it } from "vitest";
import { fmtPct, fmtUsdc, parseUsdcInput, usdcToNumber } from "./format";

describe("parseUsdcInput", () => {
  it("parses decimal input into 6-decimal units exactly", () => {
    expect(parseUsdcInput("10")).toBe(10_000_000n);
    expect(parseUsdcInput("0.5")).toBe(500_000n);
    expect(parseUsdcInput("1.234567")).toBe(1_234_567n);
    expect(parseUsdcInput(".25")).toBe(250_000n);
  });
  it("rejects invalid or over-precise input", () => {
    expect(parseUsdcInput("")).toBeNull();
    expect(parseUsdcInput(".")).toBeNull();
    expect(parseUsdcInput("1.2345678")).toBeNull();
    expect(parseUsdcInput("-1")).toBeNull();
    expect(parseUsdcInput("1e3")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats USDC units", () => {
    expect(usdcToNumber("44178714")).toBeCloseTo(44.178714);
    expect(fmtUsdc("19178714", { signed: true })).toBe("+19.18 USDC");
    expect(fmtUsdc(-40_000_000n)).toBe("-40.00 USDC");
  });
  it("never renders missing values as numbers", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtUsdc(null)).toBe("—");
  });
});

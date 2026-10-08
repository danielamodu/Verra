import { formatUSDC, formatSignedUSDC, parseUSDC, truncateAddress } from "../src/lib/format";
import { chainStatus } from "../src/lib/status";

describe("format", () => {
  it("formats base units as USD", () => {
    expect(formatUSDC(150_000_000)).toBe("$150.00 USDC");
    expect(formatSignedUSDC(150_000_000)).toBe("+$150.00 USDC");
  });
  it("parses user amounts", () => {
    expect(parseUSDC("150")).toBe(150_000_000);
    expect(parseUSDC("$150.50")).toBe(150_500_000);
    expect(() => parseUSDC("abc")).toThrow();
    expect(() => parseUSDC("0")).toThrow();
  });
  it("truncates addresses", () => {
    expect(truncateAddress("ABCDEFGH1234", 4)).toBe("ABCD…1234");
  });
});

describe("chainStatus", () => {
  it("maps every chain state to one obvious status", () => {
    expect(chainStatus("FUNDED")).toEqual({ kind: "LOCKED", label: "LOCKED" });
    expect(chainStatus("SUBMITTED").kind).toBe("VERIFYING");
    expect(chainStatus("VERIFIED").kind).toBe("VERIFIED");
    expect(chainStatus("SETTLED").kind).toBe("RELEASED");
    expect(chainStatus("REJECTED").kind).toBe("REJECTED");
  });
});

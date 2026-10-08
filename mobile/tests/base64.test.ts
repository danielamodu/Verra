import { base64ToBytes } from "../src/lib/base64";

describe("base64ToBytes", () => {
  it("decodes RFC 4648 vectors", () => {
    expect(Array.from(base64ToBytes("TWFu"))).toEqual([77, 97, 110]);
    expect(Array.from(base64ToBytes("TWE="))).toEqual([77, 97]);
    expect(Array.from(base64ToBytes("TQ=="))).toEqual([77]);
    expect(Array.from(base64ToBytes(""))).toEqual([]);
  });
  it("round-trips binary data", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 16, 32]);
    const b64 = Buffer.from(bytes).toString("base64");
    expect(base64ToBytes(b64)).toEqual(bytes);
  });
  it("rejects garbage", () => {
    expect(() => base64ToBytes("abc")).toThrow(); // bad length
    expect(() => base64ToBytes("ab=d")).toThrow(); // padding in the middle
  });
});

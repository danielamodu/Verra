/** Shared SHA-256 must match NIST vectors (Node today, RN on-device). */
import { sha256Hex } from "../../verification/evidence";

describe("sha256 vectors", () => {
  it("empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
  it("abc", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
  it("56-byte NIST message", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });
  it("bytes input equals string input", () => {
    expect(sha256Hex(new Uint8Array([97, 98, 99]))).toBe(sha256Hex("abc"));
  });
});

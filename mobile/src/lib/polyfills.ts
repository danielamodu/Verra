/**
 * Runtime polyfills required by the React Native (Hermes) environment.
 * MUST be imported before any other app module (see App.tsx).
 *
 * - Buffer: @solana/web3.js, @solana/spl-token and the shared
 *   verification/evidence.ts (pure-TS SHA-256) operate on Uint8Array/Buffer.
 */
import { Buffer } from "buffer";

if (typeof (global as any).Buffer === "undefined") {
  (global as any).Buffer = Buffer;
}

export {};

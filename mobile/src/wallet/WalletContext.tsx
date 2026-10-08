import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as Application from "expo-application";
import { connectWallet, disconnectWallet, signDigest } from "./MobileWallet";

export type Role = "Business" | "Worker";

interface WalletState {
  address: string | null;
  demoMode: boolean;
  role: Role;
  connecting: boolean;
  error: string | null;
  /** Per-install device identifier (Android ID) — binds proof to the phone. */
  deviceId: string | null;
  connect: () => Promise<void>;
  connectDemo: (role: Role) => void;
  disconnect: () => Promise<void>;
  setRole: (role: Role) => void;
  /** Sign bytes with the connected wallet (Seed Vault does the signing). */
  signWithWallet: (digest: Uint8Array) => Promise<Uint8Array>;
}

const WalletContext = createContext<WalletState | null>(null);

const DEMO_ADDRESSES: Record<Role, string> = {
  Business: "DemoBizWallet1111111111111111111111111111111",
  Worker: "DemoWorkerWallet11111111111111111111111111111",
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [role, setRole] = useState<Role>("Business");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // expo-application exposes getAndroidIdAsync (older) or getAndroidId.
        const fn =
          (Application as any).getAndroidIdAsync ?? (Application as any).getAndroidId;
        const id = typeof fn === "function" ? await fn() : null;
        setDeviceId(typeof id === "string" && id ? id : "unknown-device");
      } catch {
        setDeviceId("unknown-device");
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const session = await connectWallet();
      setAddress(session.address);
      setAuthToken(session.authToken);
      setDemoMode(false);
    } catch (e: any) {
      setError(e?.message ?? "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectDemo = useCallback((r: Role) => {
    setRole(r);
    setAddress(DEMO_ADDRESSES[r]);
    setAuthToken("");
    setDemoMode(true);
    setError(null);
  }, []);

  const disconnect = useCallback(async () => {
    if (authToken) await disconnectWallet(authToken);
    setAddress(null);
    setAuthToken("");
    setDemoMode(false);
    setError(null);
  }, [authToken]);

  const signWithWallet = useCallback(
    async (digest: Uint8Array) => {
      if (!authToken) throw new Error("No wallet session — connect a real wallet to sign.");
      return signDigest(authToken, digest);
    },
    [authToken]
  );

  const value = useMemo(
    () => ({ address, demoMode, role, connecting, error, deviceId, connect, connectDemo, disconnect, setRole, signWithWallet }),
    [address, demoMode, role, connecting, error, deviceId, connect, connectDemo, disconnect, signWithWallet]
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

export function homeRouteFor(role: Role): "BusinessHome" | "WorkerHome" {
  return role === "Business" ? "BusinessHome" : "WorkerHome";
}

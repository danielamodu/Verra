import "./src/lib/polyfills";
import React from "react";
import { WalletProvider } from "./src/wallet/WalletContext";
import { ProofpayProvider } from "./src/state/ProofpayContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

export default function App() {
  return (
    <WalletProvider>
      <ProofpayProvider>
        <RootNavigator />
      </ProofpayProvider>
    </WalletProvider>
  );
}

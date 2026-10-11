import "./src/lib/polyfills";
import React from "react";
import { View } from "react-native";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from "@expo-google-fonts/outfit";
import { WalletProvider } from "./src/wallet/WalletContext";
import { ProofpayProvider } from "./src/state/ProofpayContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

export default function App() {
  const [loaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  // Hold on a white screen until the brand font is ready (avoids a flash of
  // the system font). Fonts bundle with the APK, so this is near-instant.
  if (!loaded) return <View style={{ flex: 1, backgroundColor: "#FFFFFF" }} />;

  return (
    <WalletProvider>
      <ProofpayProvider>
        <RootNavigator />
      </ProofpayProvider>
    </WalletProvider>
  );
}

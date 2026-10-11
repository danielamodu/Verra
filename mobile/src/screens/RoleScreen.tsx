import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { BrandLockup, Tile, Chip, Spacer } from "../components/ui";
import { colors, t } from "../theme";
import { homeRouteFor, useWallet, type Role } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

export function RoleScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { role, setRole, address, connectDemo } = useWallet();

  const pick = (r: Role) => {
    setRole(r);
    if (!address) connectDemo(r);
    nav.replace(homeRouteFor(r));
  };

  const options: { role: Role; sub: string }[] = [
    { role: "Business", sub: "Create & fund jobs" },
    { role: "Worker", sub: "Do the work, get paid" },
  ];

  return (
    <Screen>
      <View style={{ height: 10 }} />
      <BrandLockup size={22} center />
      <View style={{ height: 26 }} />
      <Text style={[t.hero, { fontSize: 28 }]}>Who are you{"\n"}today?</Text>
      <View style={{ height: 22 }} />
      {options.map((o) => (
        <TouchableOpacity key={o.role} accessibilityRole="button" onPress={() => pick(o.role)} activeOpacity={0.8} style={{ marginBottom: 12 }}>
          <Tile style={role === o.role ? { borderWidth: 1.5, borderColor: colors.lilac } : undefined}>
            <View style={s.row}>
              <View>
                <Text style={[t.item, { fontSize: 19 }]}>{o.role}</Text>
                <Text style={[t.meta, { marginTop: 3 }]}>{o.sub}</Text>
              </View>
              <Text style={s.chev}>›</Text>
            </View>
          </Tile>
        </TouchableOpacity>
      ))}
      <Spacer />
      <TouchableOpacity accessibilityRole="button" onPress={() => nav.navigate("Stake")} style={{ alignSelf: "center" }}>
        <Chip tone="lilac">◆ Verifier? Stake your SKR bond →</Chip>
      </TouchableOpacity>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chev: { ...t.h2, color: colors.lilacInk },
});

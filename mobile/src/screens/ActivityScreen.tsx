import { StyleSheet, Text, View } from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { colors, spacing } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

const STAGE_ORDER = [
  "created",
  "funded",
  "accepted",
  "submitted",
  "verified",
  "released",
] as const;

export function ActivityScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Activity">>();
  const { jobs } = useProofpay();
  const job = jobs.find((j) => j.id === route.params.jobId);

  if (!job) {
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }

  const order = (key: string) => {
    const i = STAGE_ORDER.findIndex((s) => key.startsWith(s));
    return i === -1 ? 99 : i;
  };
  const events = [...job.activity].sort((a, b) => order(a.key) - order(b.key));

  return (
    <Screen>
      <Text style={styles.heading}>{job.title}</Text>
      {events.map((e, i) => (
        <View key={`${e.key}-${i}`} style={styles.row}>
          <View style={styles.rail}>
            <View style={styles.dot} />
            {i < events.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.body}>
            <Text style={styles.label}>{e.label}</Text>
            <Text style={styles.time}>{new Date(e.at).toLocaleString()}</Text>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: spacing.md },
  muted: { color: colors.muted, fontSize: 14 },
  row: { flexDirection: "row" },
  rail: { alignItems: "center", marginRight: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  line: { width: 2, flex: 1, backgroundColor: colors.cardBorder, marginVertical: 2 },
  body: { paddingBottom: spacing.md },
  label: { color: colors.text, fontSize: 16, fontWeight: "700" },
  time: { color: colors.muted, fontSize: 13, marginTop: 2 },
});

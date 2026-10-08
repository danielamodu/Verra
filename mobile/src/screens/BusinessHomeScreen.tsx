import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React from "react";
import { Screen } from "../components/Screen";
import { JobCard } from "../components/JobCard";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function BusinessHomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { jobs, refresh, backend } = useProofpay();

  useFocusEffect(
    React.useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh])
  );

  return (
    <Screen>
      {!backend.settlesOnChain ? (
        <View style={styles.demoBanner}>
          <Text style={styles.demoText}>DEMO MODE — not on-chain</Text>
        </View>
      ) : null}
      <Text style={styles.heading}>Active jobs</Text>
      {jobs.length === 0 ? (
        <Text style={styles.empty}>No jobs yet. Create your first job below.</Text>
      ) : (
        jobs.map((job) => (
          <JobCard key={job.id} job={job} onPress={() => nav.navigate("JobDetail", { jobId: job.id })} />
        ))
      )}
      <PrimaryButton title="Create Job" onPress={() => nav.navigate("CreateJob")} />
      <Text style={styles.heading}>Recent activity</Text>
      {jobs
        .flatMap((j) => j.activity.map((a) => ({ ...a, job: j.title })))
        .slice(-5)
        .reverse()
        .map((a, i) => (
          <Text key={`${a.key}-${i}`} style={styles.activity}>
            • {a.label} — {a.job}
          </Text>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  demoBanner: {
    borderColor: colors.amber, borderWidth: 1, borderRadius: 12,
    padding: spacing.sm, marginBottom: spacing.md, alignItems: "center",
    backgroundColor: `${colors.amber}14`,
  },
  demoText: { color: colors.amber, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  heading: { color: colors.text, fontSize: 20, fontWeight: "800", marginVertical: spacing.sm },
  empty: { color: colors.muted, fontSize: 15 },
  activity: { color: colors.muted, fontSize: 14, marginTop: 4 },
});

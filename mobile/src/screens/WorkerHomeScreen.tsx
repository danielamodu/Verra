import { StyleSheet, Text } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React from "react";
import { Screen } from "../components/Screen";
import { JobCard } from "../components/JobCard";
import { colors, spacing } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function WorkerHomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { jobs, refresh } = useProofpay();

  useFocusEffect(
    React.useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh])
  );

  return (
    <Screen>
      <Text style={styles.heading}>Assigned jobs</Text>
      {jobs.length === 0 ? (
        <Text style={styles.empty}>No jobs assigned yet.</Text>
      ) : (
        jobs.map((job) => (
          <JobCard key={job.id} job={job} onPress={() => nav.navigate("JobDetail", { jobId: job.id })} />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 20, fontWeight: "800", marginVertical: spacing.sm },
  empty: { color: colors.muted, fontSize: 15 },
});

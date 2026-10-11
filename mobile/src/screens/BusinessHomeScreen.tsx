import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React from "react";
import { Screen } from "../components/Screen";
import { JobCard } from "../components/JobCard";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, VerraMark, Divider, Chip } from "../components/ui";
import { colors, t } from "../theme";
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
      <TopBar title="Your jobs" right={<VerraMark size={24} />} />
      {!backend.settlesOnChain ? (
        <Chip tone="amber" style={{ marginBottom: 14 }}>DEMO MODE · not on-chain</Chip>
      ) : null}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {jobs.length === 0 ? (
          <Text style={[t.sub, { marginTop: 8 }]}>No jobs yet. Create your first job below.</Text>
        ) : (
          jobs.map((job, i) => (
            <View key={job.id}>
              {i > 0 ? <Divider /> : null}
              <JobCard job={job} onPress={() => nav.navigate("JobDetail", { jobId: job.id })} />
            </View>
          ))
        )}
      </ScrollView>
      <PrimaryButton title="+ New job" onPress={() => nav.navigate("CreateJob")} />
    </Screen>
  );
}

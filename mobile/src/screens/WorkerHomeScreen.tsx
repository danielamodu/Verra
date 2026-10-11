import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React from "react";
import { Screen } from "../components/Screen";
import { JobCard } from "../components/JobCard";
import { TopBar, VerraMark, Divider, Chip } from "../components/ui";
import { t } from "../theme";
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
      <TopBar title="Available work" right={<VerraMark size={24} />} />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {jobs.length === 0 ? (
          <Text style={[t.sub, { marginTop: 8 }]}>No jobs assigned yet.</Text>
        ) : (
          jobs.map((job, i) => (
            <View key={job.id}>
              {i > 0 ? <Divider /> : null}
              <JobCard job={job} onPress={() => nav.navigate("JobDetail", { jobId: job.id })} />
            </View>
          ))
        )}
      </ScrollView>
      {jobs.length > 0 ? (
        <Chip tone="lilac" style={{ alignSelf: "center", marginTop: 8 }}>Tap a job to begin</Chip>
      ) : null}
    </Screen>
  );
}

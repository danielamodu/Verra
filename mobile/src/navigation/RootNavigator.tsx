import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "../theme";
import type { RootStackParamList } from "./types";
import { ConnectScreen } from "../screens/ConnectScreen";
import { RoleScreen } from "../screens/RoleScreen";
import { BusinessHomeScreen } from "../screens/BusinessHomeScreen";
import { CreateJobScreen } from "../screens/CreateJobScreen";
import { WorkerHomeScreen } from "../screens/WorkerHomeScreen";
import { JobDetailScreen } from "../screens/JobDetailScreen";
import { ExecuteJobScreen } from "../screens/ExecuteJobScreen";
import { EvidenceScreen } from "../screens/EvidenceScreen";
import { ReviewScreen } from "../screens/ReviewScreen";
import { VerificationScreen } from "../screens/VerificationScreen";
import { SettlementScreen } from "../screens/SettlementScreen";
import { ReceiptScreen } from "../screens/ReceiptScreen";
import { ActivityScreen } from "../screens/ActivityScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Connect"
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Role" component={RoleScreen} options={{ title: "I am a…" }} />
        <Stack.Screen name="BusinessHome" component={BusinessHomeScreen} options={{ title: "Verra Business" }} />
        <Stack.Screen name="CreateJob" component={CreateJobScreen} options={{ title: "New job" }} />
        <Stack.Screen name="WorkerHome" component={WorkerHomeScreen} options={{ title: "Verra Worker" }} />
        <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: "Job" }} />
        <Stack.Screen name="ExecuteJob" component={ExecuteJobScreen} options={{ title: "Checklist" }} />
        <Stack.Screen name="Evidence" component={EvidenceScreen} options={{ title: "Evidence" }} />
        <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Review & submit" }} />
        <Stack.Screen name="Verification" component={VerificationScreen} options={{ title: "Verification" }} />
        <Stack.Screen name="Settlement" component={SettlementScreen} options={{ title: "Settlement" }} />
        <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ title: "Verra Receipt" }} />
        <Stack.Screen name="Activity" component={ActivityScreen} options={{ title: "Activity" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

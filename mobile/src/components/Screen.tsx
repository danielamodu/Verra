import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors, spacing } from "../theme";

/**
 * Screen shell. Default is a flex column that fills the viewport, so a
 * <Spacer/> pushes the primary CTA to the bottom. Pass `scroll` for
 * content-heavy screens.
 */
export function Screen({
  children,
  scroll = false,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1, paddingHorizontal: 22, paddingTop: spacing.sm, paddingBottom: spacing.md },
  scrollBody: { paddingHorizontal: 22, paddingTop: spacing.sm, paddingBottom: spacing.lg },
});

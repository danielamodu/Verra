import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { parseUSDC } from "../lib/format";
import { getApiBaseUrl } from "../backend/SolanaBackend";
import { storeInspectionRequirements } from "../../../verification/example-job";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

export function CreateJobScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { createJob, backendKind } = useProofpay();
  const { address } = useWallet();
  const [title, setTitle] = useState("Inspect 10 stores");
  const [description, setDescription] = useState("Visit all 10 stores and submit one photo per store.");
  const [amount, setAmount] = useState("150");
  const [worker, setWorker] = useState("");
  const [verifier, setVerifier] = useState("");
  const [extraItems, setExtraItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [minPhotos, setMinPhotos] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In devnet mode the backend publishes its verifier address — prefill it
  // (editable override stays possible). Demo mode needs no verifier.
  useEffect(() => {
    if (backendKind !== "devnet" || verifier) return;
    const base = getApiBaseUrl();
    if (!base) return;
    fetch(`${base}/api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && typeof cfg.verifier === "string" && cfg.verifier) {
          setVerifier(cfg.verifier);
        }
      })
      .catch(() => undefined);
  }, [backendKind]);

  const publish = async () => {
    setError(null);
    let paymentBaseUnits = 0;
    try {
      paymentBaseUnits = parseUSDC(amount);
    } catch (e: any) {
      setError(e.message);
      return;
    }
    if (!worker.trim()) {
      setError("Enter the worker wallet address.");
      return;
    }
    setBusy(true);
    try {
      const base = storeInspectionRequirements();
      const checklist = base[0];
      const photo = base[1];
      if (checklist.type !== "CHECKLIST" || photo.type !== "PHOTO_EVIDENCE") {
        throw new Error("Template requirements malformed.");
      }
      const items = [
        ...(checklist.configuration as { items: { id: string; label: string }[] }).items,
        ...extraItems.map((label, i) => ({ id: `extra-${i + 1}`, label })),
      ];
      const job = await createJob(
        {
          title: title.trim() || "Untitled job",
          description: description.trim(),
          paymentBaseUnits,
          worker: worker.trim(),
          verifier: verifier.trim() || undefined,
          requirements: [
            { ...checklist, configuration: { items } },
            { ...photo, configuration: { minPhotos } },
          ],
        },
        address ?? "unknown-business"
      );
      nav.replace("JobDetail", { jobId: job.id });
    } catch (e: any) {
      setError(e?.message ?? "Could not publish the job.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.label}>Job title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholderTextColor={colors.muted} />
      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multi]}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Payment (USDC)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="150"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Worker wallet</Text>
      <TextInput
        style={styles.input}
        value={worker}
        onChangeText={setWorker}
        autoCapitalize="none"
        placeholder="Worker address"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Verifier wallet (devnet real funding)</Text>
      <TextInput
        style={styles.input}
        value={verifier}
        onChangeText={setVerifier}
        autoCapitalize="none"
        placeholder="Leave empty in demo mode"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Checklist requirements</Text>
      <Text style={styles.hint}>10 store visits included. Add extras if needed.</Text>
      {extraItems.map((item, i) => (
        <Text key={i} style={styles.item}>
          • {item}
        </Text>
      ))}
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.addInput]}
          value={newItem}
          onChangeText={setNewItem}
          placeholder="Extra step"
          placeholderTextColor={colors.muted}
        />
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.addBtn}
          onPress={() => {
            if (newItem.trim()) {
              setExtraItems([...extraItems, newItem.trim()]);
              setNewItem("");
            }
          }}
        >
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.label}>Required photos: {minPhotos}</Text>
      <View style={styles.stepRow}>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.step}
          onPress={() => setMinPhotos(Math.max(1, minPhotos - 1))}
        >
          <Text style={styles.stepText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.step}
          onPress={() => setMinPhotos(minPhotos + 1)}
        >
          <Text style={styles.stepText}>+</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Fund & Publish" onPress={publish} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: spacing.md },
  hint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  input: {
    backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1,
    borderRadius: 12, color: colors.text, fontSize: 16, padding: spacing.sm, marginTop: 6,
  },
  multi: { minHeight: 72, textAlignVertical: "top" },
  item: { color: colors.text, fontSize: 14, marginTop: 4 },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addInput: { flex: 1 },
  addBtn: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 12, padding: spacing.sm, marginTop: 6 },
  addBtnText: { color: colors.primary, fontWeight: "800" },
  stepRow: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  step: {
    flex: 1, backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1,
    borderRadius: 12, padding: spacing.sm, alignItems: "center",
  },
  stepText: { color: colors.text, fontSize: 22, fontWeight: "800" },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm },
});

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, SectionLabel } from "../components/ui";
import { colors, spacing, radius, font, t } from "../theme";
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

  useEffect(() => {
    if (backendKind !== "devnet" || verifier) return;
    const base = getApiBaseUrl();
    if (!base) return;
    fetch(`${base}/api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && typeof cfg.verifier === "string" && cfg.verifier) setVerifier(cfg.verifier);
      })
      .catch(() => undefined);
  }, [backendKind]);

  const publish = async () => {
    setError(null);
    let paymentBaseUnits = 0;
    try { paymentBaseUnits = parseUSDC(amount); } catch (e: any) { setError(e.message); return; }
    if (!worker.trim()) { setError("Enter the worker wallet address."); return; }
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
    } finally { setBusy(false); }
  };

  return (
    <Screen scroll>
      <TopBar title="New job" onBack={() => nav.goBack()} />
      <SectionLabel>Details</SectionLabel>
      <TextInput style={s.input} value={title} onChangeText={setTitle} placeholderTextColor={colors.faint} />
      <TextInput style={[s.input, s.multi]} value={description} onChangeText={setDescription} multiline placeholder="What needs doing…" placeholderTextColor={colors.faint} />
      <SectionLabel style={{ marginTop: 20 }}>Payment · USDC</SectionLabel>
      <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="150" placeholderTextColor={colors.faint} />
      <SectionLabel style={{ marginTop: 20 }}>Assign</SectionLabel>
      <TextInput style={s.input} value={worker} onChangeText={setWorker} autoCapitalize="none" placeholder="Worker wallet" placeholderTextColor={colors.faint} />
      <TextInput style={s.input} value={verifier} onChangeText={setVerifier} autoCapitalize="none" placeholder="Verifier wallet (devnet)" placeholderTextColor={colors.faint} />
      <SectionLabel style={{ marginTop: 20 }}>Extra checklist steps</SectionLabel>
      {extraItems.map((item, i) => (<Text key={i} style={[t.item, { marginBottom: 6 }]}>• {item}</Text>))}
      <View style={s.addRow}>
        <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={newItem} onChangeText={setNewItem} placeholder="Add a step" placeholderTextColor={colors.faint} />
        <TouchableOpacity accessibilityRole="button" style={s.addBtn} onPress={() => { if (newItem.trim()) { setExtraItems([...extraItems, newItem.trim()]); setNewItem(""); } }}>
          <Text style={s.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
      <SectionLabel style={{ marginTop: 20 }}>Required photos · {minPhotos}</SectionLabel>
      <View style={s.stepRow}>
        <TouchableOpacity accessibilityRole="button" style={s.step} onPress={() => setMinPhotos(Math.max(1, minPhotos - 1))}><Text style={s.stepText}>−</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={s.step} onPress={() => setMinPhotos(minPhotos + 1)}><Text style={s.stepText}>+</Text></TouchableOpacity>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <PrimaryButton title={`Fund & publish · $${amount || "0"}`} onPress={publish} loading={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1.5, borderRadius: radius.sm, color: colors.ink, fontFamily: font.semibold, fontSize: 16, padding: 14, marginBottom: 12 },
  multi: { minHeight: 72, textAlignVertical: "top" },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addBtn: { backgroundColor: colors.ink, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 15 },
  addBtnText: { color: "#fff", fontFamily: font.bold, fontSize: 15 },
  stepRow: { flexDirection: "row", gap: spacing.sm },
  step: { flex: 1, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1.5, borderRadius: radius.sm, padding: 12, alignItems: "center" },
  stepText: { color: colors.ink, fontSize: 22, fontFamily: font.bold },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm, fontFamily: font.medium },
});

import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Steps, SectionLabel, Chip } from "../components/ui";
import { colors, radius, font, t } from "../theme";
import { sha256Hex } from "../../../verification/evidence";
import { base64ToBytes } from "../lib/base64";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { DraftEvidence } from "../backend/types";
import type { RootStackParamList } from "../navigation/types";

/**
 * Evidence collection only — the camera gathers proof, never verifies.
 * Each photo is hashed on-device (SHA-256); the hash travels with the
 * submission and is re-checked by the verifier.
 */
export function EvidenceScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Evidence">>();
  const { jobs } = useProofpay();
  const { deviceId } = useWallet();
  const job = jobs.find((j) => j.id === route.params.jobId);

  const [photos, setPhotos] = useState<DraftEvidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoReq = useMemo(() => job?.requirements.find((r) => r.type === "PHOTO_EVIDENCE"), [job]);
  const minPhotos = photoReq && typeof (photoReq.configuration as { minPhotos?: unknown }).minPhotos === "number"
    ? (photoReq.configuration as { minPhotos: number }).minPhotos : 0;

  if (!job) {
    return (<Screen><TopBar title="Evidence" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }

  const capture = async () => {
    setError(null); setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== "granted") { setError("Camera permission is required to capture evidence."); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (shot.canceled || !shot.assets || shot.assets.length === 0) return;
      const asset = shot.assets[0];
      if (!asset.base64) return;
      const bytes = base64ToBytes(asset.base64);
      setPhotos((prev) => [...prev, {
        requirementId: photoReq?.id ?? "photos", uri: asset.uri, contentHash: sha256Hex(bytes),
        mimeType: asset.mimeType ?? "image/jpeg", capturedAt: new Date().toISOString(),
      }]);
    } catch (e: any) { setError(e?.message ?? "Could not capture the photo."); }
    finally { setBusy(false); }
  };

  return (
    <Screen scroll>
      <TopBar title="Evidence" onBack={() => nav.goBack()} />
      <Steps total={5} current={2} />
      <SectionLabel>Photos · {photos.length}/{minPhotos} · device {deviceId ? "bound" : "—"}</SectionLabel>
      <View style={s.grid}>
        {photos.map((p, i) => (
          <View key={`${p.uri}-${i}`} style={s.thumbWrap}>
            <Image source={{ uri: p.uri }} style={s.thumb} />
            <View style={s.hash}><Text style={s.hashText} numberOfLines={1}>⛓ {p.contentHash.slice(0, 10)}…</Text></View>
          </View>
        ))}
      </View>
      <PrimaryButton title="Capture photo" tone="quiet" onPress={capture} loading={busy} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Chip tone="lilac" style={{ marginTop: 14 }}>◎ Each photo fingerprinted at capture</Chip>
      <PrimaryButton title="Review submission" disabled={photos.length < minPhotos}
        onPress={() => nav.navigate("Review", { jobId: job.id, completedChecklists: route.params.completedChecklists, photos })} />
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 6 },
  thumbWrap: { width: "31.5%" },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.lilacTint },
  hash: { marginTop: 4 },
  hashText: { fontFamily: font.mono, fontSize: 10, color: colors.muted },
  error: { color: colors.red, fontSize: 14, marginTop: 10 },
});

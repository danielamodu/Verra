import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { sha256Hex } from "../../../verification/evidence";
import { base64ToBytes } from "../lib/base64";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { DraftEvidence } from "../backend/types";
import type { RootStackParamList } from "../navigation/types";

/**
 * Evidence collection only — the camera gathers proof, it never verifies.
 * Each photo is hashed on-device (SHA-256 via the shared evidence layer);
 * the hash travels with the submission and is re-checked by the verifier.
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

  const photoReq = useMemo(
    () => job?.requirements.find((r) => r.type === "PHOTO_EVIDENCE"),
    [job]
  );
  const minPhotos =
    photoReq && typeof (photoReq.configuration as { minPhotos?: unknown }).minPhotos === "number"
      ? (photoReq.configuration as { minPhotos: number }).minPhotos
      : 0;

  if (!job) {
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }

  const capture = async () => {
    setError(null);
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== "granted") {
        setError("Camera permission is required to capture evidence.");
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        base64: true,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
      if (shot.canceled || !shot.assets || shot.assets.length === 0) return;
      const asset = shot.assets[0];
      if (!asset.base64) return;
      const bytes = base64ToBytes(asset.base64);
      setPhotos((prev) => [
        ...prev,
        {
          requirementId: photoReq?.id ?? "photos",
          uri: asset.uri,
          contentHash: sha256Hex(bytes),
          mimeType: asset.mimeType ?? "image/jpeg",
          capturedAt: new Date().toISOString(),
        },
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Could not capture the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.heading}>Evidence</Text>
      <Text style={styles.sub}>
        {photos.length}/{minPhotos} photos · device {deviceId ? "bound" : "unknown"}
      </Text>
      <View style={styles.grid}>
        {photos.map((p, i) => (
          <View key={`${p.uri}-${i}`} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            <Text style={styles.hash} numberOfLines={1}>
              ⛓ {p.contentHash.slice(0, 12)}…
            </Text>
          </View>
        ))}
      </View>
      <PrimaryButton title="Capture photo" tone="quiet" onPress={capture} loading={busy} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        title="Review submission"
        disabled={photos.length < minPhotos}
        onPress={() =>
          nav.navigate("Review", {
            jobId: job.id,
            completedChecklists: route.params.completedChecklists,
            photos,
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.primary, fontSize: 18, fontWeight: "800", marginTop: 4 },
  muted: { color: colors.muted, fontSize: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  thumbWrap: { width: "31%" },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  hash: { color: colors.muted, fontSize: 11, marginTop: 2 },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm },
});

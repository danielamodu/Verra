// Global test doubles: screens must stay importable without native modules.
jest.mock("expo-application", () => ({
  getAndroidIdAsync: jest.fn(async () => "test-android-id"),
}));

jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  MediaTypeOptions: { Images: "Images" },
}));

jest.mock("expo-crypto", () => ({
  digestStringAsync: jest.fn(async () => "00".repeat(32)),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
}));

jest.mock("@solana-mobile/mobile-wallet-adapter-protocol-web3js", () => ({
  transact: jest.fn(),
}));

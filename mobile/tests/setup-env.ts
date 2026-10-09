/**
 * Node-test setup: point the backend client at a dummy API URL so
 * API-path code is exercisable with mocked fetch. Real runs provide
 * EXPO_PUBLIC_VERRA_API_URL from the environment (never committed).
 * Must be imported before ../src/backend/SolanaBackend in every node test.
 */
process.env.EXPO_PUBLIC_VERRA_API_URL ??= "http://verra-test.local";

export {};

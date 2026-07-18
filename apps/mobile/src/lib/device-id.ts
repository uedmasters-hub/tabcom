import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "tabcom.device-id";

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) {
    cached = existing;
    return existing;
  }

  const fresh =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
  cached = fresh;
  return fresh;
}

export function getDeviceInfo(): string {
  const model = Constants.deviceName ?? "unknown device";
  return `${Platform.OS} ${Platform.Version} · ${model} · Tabcom Mobile`.slice(0, 200);
}

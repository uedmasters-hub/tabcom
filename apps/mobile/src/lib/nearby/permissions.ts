import { PermissionsAndroid, Platform } from "react-native";

export type PermissionOutcome =
  | { ok: true }
  | { ok: false; reason: "denied" | "blocked" | "unavailable" };

/**
 * Request runtime permissions required for Nearby Connections.
 * iOS prompts via Info.plist usage strings from the config plugin.
 */
export async function requestNearbyPermissions(): Promise<PermissionOutcome> {
  if (Platform.OS === "ios") {
    // Bluetooth / local network prompts are system-driven on first use.
    return { ok: true };
  }

  if (Platform.OS !== "android") {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const api = typeof Platform.Version === "number" ? Platform.Version : 31;
    const needed: string[] = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];

    if (api >= 31) {
      needed.push(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      );
    }
    if (api >= 33) {
      // NEARBY_WIFI_DEVICES may not be on older RN typings
      const nearbyWifi = "android.permission.NEARBY_WIFI_DEVICES";
      needed.push(nearbyWifi);
    }

    const result = await PermissionsAndroid.requestMultiple(
      needed as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][]
    );

    const values = Object.values(result);
    if (values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
      return { ok: false, reason: "blocked" };
    }
    if (values.some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) {
      return { ok: false, reason: "denied" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

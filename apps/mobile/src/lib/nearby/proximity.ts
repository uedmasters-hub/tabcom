/**
 * Approximate proximity bands — never expose meters or exact distance.
 * Nearby Connections does not always surface RSSI; when unknown we
 * default to "Nearby".
 */

export type ProximityBand = "very_close" | "nearby" | "within_range";

export function proximityLabel(band: ProximityBand): string {
  switch (band) {
    case "very_close":
      return "Very Close";
    case "nearby":
      return "Nearby";
    case "within_range":
      return "Within Range";
  }
}

/** Map optional RSSI (dBm) to a coarse band. */
export function bandFromRssi(rssi: number | null | undefined): ProximityBand {
  if (rssi == null || !Number.isFinite(rssi)) return "nearby";
  if (rssi >= -55) return "very_close";
  if (rssi >= -75) return "nearby";
  return "within_range";
}

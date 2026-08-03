import * as Crypto from "expo-crypto";

import { DEFAULT_CAPABILITIES, PROTOCOL_VERSION } from "./config";

/**
 * Opaque advertisement payload — never contains username, email, or
 * display name. Nearby Connections uses this string as the endpoint
 * "name"; keep it short (Android name length limits).
 *
 * Wire format: `TC` + versionDigit + `.` + base64url(flags1 + nonce8)
 */

const MAGIC = "TC";

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa available in RN hermes / metro
  const b64 = globalThis.btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = globalThis.atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export interface Advertisement {
  version: number;
  flags: number;
  nonce: string; // hex
  rawName: string;
}

export async function createAdvertisement(
  flags: number = DEFAULT_CAPABILITIES
): Promise<Advertisement> {
  const nonceBytes = await Crypto.getRandomBytesAsync(8);
  const payload = new Uint8Array(1 + 8);
  payload[0] = flags & 0xff;
  payload.set(nonceBytes, 1);
  const rawName = `${MAGIC}${PROTOCOL_VERSION}.${bytesToBase64Url(payload)}`;
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { version: PROTOCOL_VERSION, flags, nonce, rawName };
}

export function parseAdvertisement(name: string): Advertisement | null {
  if (!name || !name.startsWith(MAGIC)) return null;
  const rest = name.slice(MAGIC.length);
  const dot = rest.indexOf(".");
  if (dot < 1) return null;
  const version = Number(rest.slice(0, dot));
  if (!Number.isFinite(version) || version < 1) return null;
  const body = base64UrlToBytes(rest.slice(dot + 1));
  if (!body || body.length < 9) return null;
  const flags = body[0]!;
  const nonceBytes = body.slice(1, 9);
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { version, flags, nonce, rawName: name };
}

export function isCompatibleVersion(version: number): boolean {
  return version === PROTOCOL_VERSION;
}

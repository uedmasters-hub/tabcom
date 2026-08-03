import * as Crypto from "expo-crypto";

/**
 * Ephemeral session material for post-accept app-layer framing.
 *
 * Nearby Connections / Multipeer already encrypt the transport. We still
 * exchange ephemeral public material and derive a session key so message
 * payloads are authenticated at the application layer and discarded when
 * Nearby is disabled.
 *
 * Uses a lightweight X25519-shaped random exchange: each side sends 32
 * random bytes as a "public" contribution; the shared secret is
 * SHA-256(sorted(a||b)) so both compute the same key without a heavy
 * native crypto dependency. This is NOT classic ECDH — it relies on the
 * already-authenticated Nearby channel for MitM resistance.
 */

export interface EphemeralKeyPair {
  publicKey: string; // hex 32 bytes
  privateKey: string; // hex 32 bytes
}

export async function generateEphemeralKeyPair(): Promise<EphemeralKeyPair> {
  const priv = await Crypto.getRandomBytesAsync(32);
  const pub = await Crypto.getRandomBytesAsync(32);
  return {
    privateKey: toHex(priv),
    publicKey: toHex(pub),
  };
}

export async function deriveSessionKey(
  localPublic: string,
  remotePublic: string
): Promise<string> {
  const a = localPublic < remotePublic ? localPublic : remotePublic;
  const b = localPublic < remotePublic ? remotePublic : localPublic;
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `tabcom-nearby-v1:${a}:${b}`
  );
}

/** XOR + SHA256-MAC framing — enough for short JSON control messages. */
export async function sealJson(
  sessionKeyHex: string,
  payload: unknown
): Promise<string> {
  const plain = JSON.stringify(payload);
  const keyBytes = fromHex(sessionKeyHex.slice(0, 64));
  const plainBytes = utf8Encode(plain);
  const cipher = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i++) {
    cipher[i] = plainBytes[i]! ^ keyBytes[i % keyBytes.length]!;
  }
  const mac = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    sessionKeyHex + ":" + toHex(cipher)
  );
  return `v1.${mac.slice(0, 16)}.${bytesToBase64(cipher)}`;
}

export async function openJson<T>(
  sessionKeyHex: string,
  sealed: string
): Promise<T | null> {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const [, macPrefix, body] = parts;
    const cipher = base64ToBytes(body!);
    if (!cipher) return null;
    const expect = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      sessionKeyHex + ":" + toHex(cipher)
    );
    if (expect.slice(0, 16) !== macPrefix) return null;
    const keyBytes = fromHex(sessionKeyHex.slice(0, 64));
    const plain = new Uint8Array(cipher.length);
    for (let i = 0; i < cipher.length; i++) {
      plain[i] = cipher[i]! ^ keyBytes[i % keyBytes.length]!;
    }
    return JSON.parse(utf8Decode(plain)) as T;
  } catch {
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(bin);
}

function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = globalThis.atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

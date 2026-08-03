import { PROTOCOL_VERSION } from "./config";

/**
 * Application messages sent over the Nearby text channel after both
 * sides accept the connection. Profiles are never sent before accept.
 */

export type NearbyMessage =
  | {
      type: "hello";
      v: number;
      publicKey: string;
      username: string;
      displayName: string;
      avatarColor: string;
      presence: "online" | "away" | "busy" | "offline";
    }
  | { type: "hello_ack"; v: number; publicKey: string }
  | {
      type: "profile_offer";
      username: string;
      displayName: string;
      avatarColor: string;
      presence: "online" | "away" | "busy" | "offline";
    }
  | { type: "connect_req"; username: string }
  | { type: "connect_accept"; username: string }
  | { type: "connect_decline"; username: string }
  | { type: "connect_ignore"; username: string }
  | { type: "invite_token"; token: string; expiresAt?: number }
  | { type: "ping" }
  | { type: "goodbye" }
  | { type: "reserved"; kind: string; payload?: unknown };

export function encodeMessage(msg: NearbyMessage): string {
  return JSON.stringify({ ...msg, v: "v" in msg ? msg.v : PROTOCOL_VERSION });
}

export function decodeMessage(raw: string): NearbyMessage | null {
  try {
    const parsed = JSON.parse(raw) as NearbyMessage & { v?: number };
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    if (
      (parsed.type === "hello" || parsed.type === "hello_ack") &&
      typeof parsed.v === "number" &&
      parsed.v !== PROTOCOL_VERSION
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

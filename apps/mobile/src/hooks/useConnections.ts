import { useMemo } from "react";
import { useChatStore } from "@/stores/chat";
import type { Contact, ConnectionStatus } from "@tabcom/shared";

/**
 * Connection state is GLOBAL, not owned by any screen.
 *
 * Every surface that can show a pending request — Chat thread, Discover,
 * Notifications, badges — reads from here and acts through the same two
 * functions. That's what keeps badges honest and lets a request be
 * accepted wherever the user happens to see it, with no navigation.
 */
export function usePendingRequests(): Contact[] {
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  return useMemo(
    () =>
      contacts.filter(
        (c) => c.id.startsWith("u-") && connections[c.username] === "pending_in"
      ),
    [contacts, connections]
  );
}

export function usePendingCount(): number {
  return usePendingRequests().length;
}

export function useConnectionStatus(username?: string): ConnectionStatus | "none" {
  const connections = useChatStore((s) => s.connections);
  if (!username) return "none";
  return connections[username] ?? "none";
}

export function acceptConnection(contact: Contact): void {
  useChatStore.getState().respondToRequest(contact, "accept");
}

export function ignoreConnection(contact: Contact): void {
  useChatStore.getState().respondToRequest(contact, "deny");
}

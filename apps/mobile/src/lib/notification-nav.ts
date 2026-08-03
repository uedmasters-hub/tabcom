/**
 * Deep-link targets from push / in-app notification taps.
 *
 * Rules:
 *  - Never stack a fresh conversation on top of an open one.
 *  - Prefer switching the existing thread in place.
 *  - Always merge notification payload into the chat store first so
 *    bell / list / contacts stay in sync even if the socket missed it.
 */
import { useChatStore } from "@/stores/chat";

export type NotificationData = Record<string, unknown>;

type NavRouter = {
  push: (href: never) => void;
  replace: (href: never) => void;
};

function ingestMessagePayload(data: NotificationData): string | null {
  if (data.category !== "messages" && data.type !== "dm") return null;
  const from = typeof data.from === "string" ? data.from : null;
  if (!from || !data.messageId) return null;

  const store = useChatStore.getState();
  store.receivePushDm({
    from,
    fromName: String(data.fromName ?? from),
    fromColor: String(data.fromColor ?? "#2563eb"),
    messageId: String(data.messageId),
    messageKind: String(data.messageKind ?? "text"),
    messageText: String(data.messageText ?? "New message"),
  });

  const contactId = `u-${from}`;
  const conv =
    store.conversations.find((c) => c.contactId === contactId) ??
    useChatStore.getState().conversations.find((c) => c.contactId === contactId);
  const convId = conv?.id ?? useChatStore.getState().startConversation(contactId);
  useChatStore.getState().pulseIncomingRefresh(convId);
  return convId;
}

/** Resolve a server route + payload into a concrete conversation id. */
export function resolveConversationTarget(
  route: string,
  data: NotificationData
): string | null {
  const ingested = ingestMessagePayload(data);
  if (ingested) return ingested;

  // /conversation/u-<username> or /conversation/<convId>
  const match = route.match(/^\/conversation\/([^/?]+)/);
  if (!match) return null;
  const param = decodeURIComponent(match[1]);
  const state = useChatStore.getState();
  const direct = state.conversations.find((c) => c.id === param);
  if (direct) return direct.id;
  if (param.startsWith("u-") || param.startsWith("c-")) {
    return state.startConversation(param);
  }
  return null;
}

/**
 * Open the right surface for a notification tap without leaving a
 * trail of stacked conversation screens.
 */
export function openFromNotification(
  router: NavRouter,
  route: string,
  data: NotificationData,
  opts?: { onConversationScreen?: boolean }
): void {
  if (data?.type === "call" || data?.category === "calls") {
    const from = String(data.from ?? "");
    if (!from) return;
    const name = encodeURIComponent(String(data.fromName ?? data.name ?? from));
    const color = encodeURIComponent(String(data.fromColor ?? data.color ?? "#2563eb"));
    const video = data.video ? "true" : "false";
    router.push(
      `/call/${from}?peerName=${name}&peerColor=${color}&role=callee&video=${video}` as never
    );
    return;
  }

  const convId = resolveConversationTarget(route, data);
  if (convId) {
    const state = useChatStore.getState();
    // Already looking at this thread — stay put, subtle refresh only.
    if (state.activeConversationId === convId) {
      state.pulseIncomingRefresh(convId);
      void import("@/lib/notifications").then(({ clearThreadNotifications }) => {
        const from = typeof data.from === "string" ? data.from : null;
        if (from) clearThreadNotifications(`dm:${from}`);
      });
      return;
    }

    if (opts?.onConversationScreen) {
      // Swap the open thread in place instead of pushing another screen.
      state.requestSwitchConversation(convId);
      router.replace(`/conversation/${convId}` as never);
      return;
    }

    state.openConversation(convId);
    router.push(`/conversation/${convId}` as never);
    return;
  }

  // Communities / requests / misc — follow the server route.
  if (route) {
    if (opts?.onConversationScreen) router.replace(route as never);
    else router.push(route as never);
  }
}

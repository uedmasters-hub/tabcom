import { initRealtime } from "./realtime";
import { useChatStore } from "../stores/chat.store";
import { useProfileStore } from "../stores/profile.store";

/**
 * The ONE place the realtime socket is wired to the stores.
 *
 * Every UI surface that runs its own socket (panel/popup, floating PiP
 * chat window — and anything added later) MUST connect through this
 * function. The PiP window previously hand-copied a SUBSET of these
 * handlers and silently fell behind the panel: no message edits or
 * deletions, no reactions, no read receipts, none of the newer presence
 * events — the exact "old design and behavior" drift this module exists
 * to make impossible. A handler added here reaches every surface.
 */
export function initRealtimeFromStores(): void {
  const profile = useProfileStore.getState();
  if (!profile.username) return;

  initRealtime(
    {
      username: profile.username,
      name: profile.displayName,
      color: profile.avatarColor,
      visibility: profile.visibility,
      photo: profile.photo,
      presence: profile.presence,
    },
    {
      onConnectionChange: (live) =>
        useChatStore.getState().setLiveStatus(live),

      onUsernameAssigned: (assignedUsername) => {
        const profile = useProfileStore.getState();
        // Only guests can actually hit this (see realtime.ts's
        // comment on the ack) — but the check is by identity, not by
        // trusting that invariant blindly: only ever touch the
        // locally-stored username if we're not authenticated, so a
        // real account's username can never be silently overwritten.
        if (!profile.sessionToken) {
          profile.setIdentity({
            displayName: profile.displayName,
            username: assignedUsername,
          });
        }
      },

      onRoster: (users) =>
        useChatStore
          .getState()
          .applyRoster(users.filter((user) => user.username !== profile.username)),

      onDm: (from, message) =>
        useChatStore.getState().receiveDm(from, message),

      onDmEdited: (from, messageId, text, editedAt) =>
        useChatStore.getState().receiveDmEdited(from, messageId, text, editedAt),

      onDmDeleted: (from, messageId) =>
        useChatStore.getState().receiveDmDeleted(from, messageId),

      onDmReaction: (from, messageId, emoji) =>
        useChatStore.getState().receiveDmReaction(from, messageId, emoji),

      onDmReadReceipt: (from, messageId, readAt) =>
        useChatStore.getState().receiveDmReadReceipt(from, messageId, readAt),

      onCommunityMessageEdited: (communityId, from, messageId, text, editedAt) =>
        useChatStore
          .getState()
          .receiveCommunityMessageEdited(communityId, from, messageId, text, editedAt),

      onCommunityMessageDeleted: (communityId, from, messageId) =>
        useChatStore
          .getState()
          .receiveCommunityMessageDeleted(communityId, from, messageId),

      onCommunityReaction: (communityId, from, messageId, emoji) =>
        useChatStore
          .getState()
          .receiveCommunityReaction(communityId, from, messageId, emoji),

      onTyping: (fromUsername) =>
        useChatStore.getState().receiveTyping(fromUsername),

      onDmError: (toUsername, reason) =>
        useChatStore.getState().receiveDmError(toUsername, reason),

      onDmNotice: (toUsername, reason) =>
        useChatStore.getState().receiveDmNotice(toUsername, reason),

      onCallError: (toUsername, reason) =>
        useChatStore.getState().receiveCallError(toUsername, reason),

      onConnections: (snapshot) =>
        useChatStore.getState().receiveConnections(snapshot),

      onConnectRequest: (from) =>
        useChatStore.getState().receiveConnectRequest(from),

      onConnectUpdate: (username, status) =>
        useChatStore.getState().receiveConnectUpdate(username, status),

      onConnectRequestError: (username, reason) =>
        useChatStore.getState().receiveConnectRequestError(username, reason),

      onCommunities: (list) =>
        useChatStore.getState().receiveCommunities(list),

      onCommunityUpdate: (community) =>
        useChatStore.getState().receiveCommunityUpdate(community),

      onCommunityInvite: (community, from, attempt) =>
        useChatStore.getState().receiveCommunityInvite(community, from, attempt),

      onCommunityDeclined: (payload) =>
        useChatStore.getState().receiveCommunityDeclined(payload),

      onCommunityLeft: (communityId) =>
        useChatStore.getState().receiveCommunityLeft(communityId),

      onCommunityDeleted: (communityId) =>
        useChatStore.getState().receiveCommunityDeleted(communityId),

      onCommunityInviteCancelled: (communityId) =>
        useChatStore.getState().receiveCommunityInviteCancelled(communityId),

      onCommunityMessage: (communityId, from, message) =>
        useChatStore.getState().receiveCommunityMessage(communityId, from, message),

      onCommunityError: (payload) =>
        useChatStore.getState().receiveCommunityError(payload),
    },
    profile.sessionToken,
    profile.guestInstanceId
  );
}

import type { Message } from "./chat";

/** Cap on photos/videos in one multi-select send. */
export const MAX_ALBUM_ITEMS = 10;

/** All non-deleted members of an album, in send order. */
export function albumItems(messages: Message[], albumId: string): Message[] {
  return messages
    .filter((m) => m.albumId === albumId && !m.deletedAt)
    .sort((a, b) => (a.albumIndex ?? 0) - (b.albumIndex ?? 0));
}

/** Photo-only members — used for swipe next/prev in the viewer. */
export function albumPhotos(messages: Message[], albumId: string): Message[] {
  return albumItems(messages, albumId).filter(
    (m) => m.kind === "image" && !!m.dataUrl
  );
}

/**
 * FlatList / thread collapse: keep only the lead message of each album
 * so the rest don't render as separate bubbles. Non-album messages pass
 * through unchanged.
 */
export function collapseAlbumLeads(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (!m.albumId || m.deletedAt) return true;
    if (seen.has(m.albumId)) return false;
    seen.add(m.albumId);
    return true;
  });
}

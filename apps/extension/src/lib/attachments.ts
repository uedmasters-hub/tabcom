import { browser } from "wxt/browser";

import type { Message } from "../types/chat";

/**
 * Attachment pipeline shared by every chat surface (panel + PiP).
 *
 * Privacy model: attachments are data URLs riding the same
 * relay-and-forget socket as text. The server hands them to the
 * recipient's live sockets and keeps nothing — files exist only on the
 * sender's and receiver's devices. There is deliberately no upload
 * endpoint, no media library, and no re-download path: once a device
 * loses its copy, the conversation shows an "unavailable" placeholder.
 */

/** Max data-URL length (~4.4 MB of binary). The relay's socket frame
 *  cap is 8 MB; this leaves generous headroom for envelope + base64
 *  overhead while keeping transfers snappy. */
export const DATA_URL_CAP = 6_000_000;

export interface StagedAttachment {
  kind: "image" | "video" | "file";
  dataUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read that file — try another."));
    reader.readAsDataURL(file);
  });
}

/** Downscale an image so photos never brush the size cap. */
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxEdge = 1600;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Couldn't read that image — try another."));
    };
    img.src = objectUrl;
  });
}

/** File → staged attachment, routed by type, size-capped with a clear
 *  error. Used identically by the picker, drag-and-drop, and paste. */
export async function fileToStagedAttachment(file: File): Promise<StagedAttachment> {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  const dataUrl = isImage ? await downscaleImage(file) : await readAsDataUrl(file);

  if (dataUrl.length > DATA_URL_CAP) {
    throw new Error(
      `"${file.name}" is too large — Tabcom transfers files device-to-device up to ~4 MB (no cloud storage, by design).`
    );
  }

  return {
    kind: isImage ? "image" : isVideo ? "video" : "file",
    dataUrl,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
  };
}

export function stagedToMedia(staged: StagedAttachment) {
  return {
    kind: staged.kind,
    dataUrl: staged.dataUrl,
    fileName: staged.fileName,
    fileSize: staged.fileSize,
    mimeType: staged.mimeType,
  };
}

export function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Open the dedicated full-tab viewer for a message's attachment.
 *  Images/videos get the media viewer; PDFs render in the browser's
 *  native document viewer (page navigation, zoom, full-screen); other
 *  files get a download flow. The viewer reads the payload from local
 *  chat storage — nothing is fetched from any server. */
export function openAttachmentViewer(conversationId: string, message: Message): void {
  const url =
    browser.runtime.getURL("/viewer.html" as never) +
    `?c=${encodeURIComponent(conversationId)}&m=${encodeURIComponent(message.id)}`;
  void browser.tabs.create({ url });
}

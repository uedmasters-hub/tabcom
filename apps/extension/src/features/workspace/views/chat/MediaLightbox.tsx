import { Download, ExternalLink, File, X, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

export interface LightboxMedia {
  kind: "image" | "video" | "file";
  dataUrl: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Full-panel quick preview — opened by tapping any image/video/file
 * bubble. "Full-screen" inside a 380x600 popup still means a fixed
 * small window, so this maximizes what that space can actually do
 * (zoom toggle, real video controls, inline PDF rendering) and offers
 * "open in new tab" as the escape hatch for a genuinely large view —
 * the browser's own image/video/PDF viewer handles real zoom and pan
 * far better than anything worth hand-rolling into this space.
 */
export default function MediaLightbox({
  media,
  onClose,
}: {
  media: LightboxMedia;
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);

  const openInNewTab = () => {
    void browser.tabs.create({ url: media.dataUrl });
  };

  const canPreviewAsDocument = media.mimeType === "application/pdf";

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {media.fileName ??
            (media.kind === "image" ? "Photo" : media.kind === "video" ? "Video" : "File")}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          {media.kind === "image" && (
            <button
              type="button"
              onClick={() => setZoomed((value) => !value)}
              aria-label={zoomed ? "Zoom out" : "Zoom in"}
              title={zoomed ? "Zoom out" : "Zoom in"}
              className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              {zoomed ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
            </button>
          )}

          <button
            type="button"
            onClick={openInNewTab}
            aria-label="Open in new tab"
            title="Open in new tab — full browser view, zoom, download"
            className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <ExternalLink size={17} />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X size={19} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto">
        {media.kind === "image" && (
          <img
            src={media.dataUrl}
            alt={media.fileName ?? "Shared photo"}
            onClick={() => setZoomed((value) => !value)}
            className={
              zoomed
                ? "max-w-none cursor-zoom-out"
                : "max-h-full max-w-full cursor-zoom-in object-contain"
            }
          />
        )}

        {media.kind === "video" && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={media.dataUrl}
            controls
            autoPlay
            className="max-h-full max-w-full"
          />
        )}

        {media.kind === "file" &&
          (canPreviewAsDocument ? (
            <iframe
              src={media.dataUrl}
              title={media.fileName ?? "Document preview"}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 px-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-white/70">
                <File size={28} />
              </span>
              <div>
                <p className="text-sm font-medium text-white">{media.fileName ?? "File"}</p>
                {media.fileSize != null && (
                  <p className="mt-0.5 text-xs text-white/50">{formatBytes(media.fileSize)}</p>
                )}
              </div>
              <p className="max-w-xs text-xs leading-5 text-white/40">
                This file type can't be previewed inline — open it to view or
                download using your browser's own viewer.
              </p>
              <button
                type="button"
                onClick={openInNewTab}
                className="mt-1 flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
              >
                <Download size={13} />
                Open file
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

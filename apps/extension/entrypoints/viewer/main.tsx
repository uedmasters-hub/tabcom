import { Download, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";

import "../../src/styles/tailwind.css";

import { formatFileSize } from "../../src/lib/attachments";
import type { Message } from "../../src/types/chat";

/**
 * Dedicated full-tab attachment viewer.
 *
 * Reads the payload straight from LOCAL chat storage — never from a
 * server, because no server copy exists (zero retention). Images and
 * videos get a full-screen media viewer with zoom; PDFs render through
 * the browser's native document viewer (page navigation, zoom,
 * full-screen come for free and beat anything hand-rolled); everything
 * else gets a clean download flow. If the payload is gone from this
 * device, the viewer says so — there is deliberately no re-download.
 */

function useAttachment(): { loading: boolean; message: Message | null } {
  const [state, setState] = useState<{ loading: boolean; message: Message | null }>({
    loading: true,
    message: null,
  });

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const conversationId = params.get("c");
        const messageId = params.get("m");
        if (!conversationId || !messageId) {
          setState({ loading: false, message: null });
          return;
        }
        const result = await browser.storage.local.get("tabcom:chat");
        const raw = result["tabcom:chat"] as string | undefined;
        if (!raw) {
          setState({ loading: false, message: null });
          return;
        }
        const parsed = JSON.parse(raw);
        const messages: Record<string, Message[]> =
          (parsed.state ?? parsed)?.messages ?? {};
        const message =
          (messages[conversationId] ?? []).find((item) => item.id === messageId) ?? null;
        setState({ loading: false, message });
      } catch {
        setState({ loading: false, message: null });
      }
    })();
  }, []);

  return state;
}

/** data: URL → object URL. iframes and downloads want a blob; creating
 *  it in THIS document ties its lifetime to this tab (a blob minted in
 *  the popup would die the moment the popup closed). */
function useObjectUrl(dataUrl: string | undefined, mimeType: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!dataUrl) return;
    let revoked = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const typed = mimeType ? new Blob([blob], { type: mimeType }) : blob;
        objectUrl = URL.createObjectURL(typed);
        if (!revoked) setUrl(objectUrl);
      } catch {
        setUrl(null);
      }
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [dataUrl, mimeType]);

  return url;
}

function TopBar({
  title,
  subtitle,
  downloadUrl,
  downloadName,
  zoom,
  onZoom,
}: {
  title: string;
  subtitle?: string;
  downloadUrl: string | null;
  downloadName: string;
  zoom?: number;
  onZoom?: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{title}</p>
        {subtitle && <p className="truncate text-[11px] text-slate-400">{subtitle}</p>}
      </div>

      {onZoom && zoom != null && (
        <div className="flex items-center gap-1 rounded-lg bg-white/10 px-1 py-0.5">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onZoom(Math.max(0.25, zoom - 0.25))}
            className="rounded-md p-1 text-slate-300 transition hover:bg-white/10"
          >
            <ZoomOut size={14} />
          </button>
          <span className="w-10 text-center text-[11px] font-semibold text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onZoom(Math.min(4, zoom + 0.25))}
            className="rounded-md p-1 text-slate-300 transition hover:bg-white/10"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            aria-label="Fit to screen"
            onClick={() => onZoom(1)}
            className="rounded-md p-1 text-slate-300 transition hover:bg-white/10"
          >
            <Minimize2 size={14} />
          </button>
        </div>
      )}

      {downloadUrl && (
        <a
          href={downloadUrl}
          download={downloadName}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/20"
        >
          <Download size={13} />
          Download
        </a>
      )}
    </div>
  );
}

function CenterNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">{body}</p>
    </div>
  );
}

function ViewerApp() {
  const { loading, message } = useAttachment();
  const [zoom, setZoom] = useState(1);
  const objectUrl = useObjectUrl(message?.dataUrl, message?.mimeType);

  const downloadName = useMemo(() => {
    if (!message) return "attachment";
    if (message.fileName) return message.fileName;
    if (message.kind === "image") return "photo.jpg";
    if (message.kind === "video") return "video.mp4";
    if (message.kind === "voice") return "voice-message.webm";
    return "attachment";
  }, [message]);

  if (loading) return null;

  if (!message || !message.dataUrl) {
    return (
      <div className="fixed inset-0 flex flex-col">
        <TopBar title="Attachment unavailable" downloadUrl={null} downloadName="" />
        <CenterNote
          title="This attachment is no longer on this device"
          body="Tabcom transfers files directly between devices and never stores them on a server — so once a copy is gone, there's nothing to re-download. Ask the sender to share it again."
        />
      </div>
    );
  }

  const subtitle = [message.mimeType, formatFileSize(message.fileSize)]
    .filter(Boolean)
    .join(" · ");

  if (message.kind === "image") {
    return (
      <div className="fixed inset-0 flex flex-col">
        <TopBar
          title={message.fileName ?? "Photo"}
          subtitle={subtitle}
          downloadUrl={objectUrl}
          downloadName={downloadName}
          zoom={zoom}
          onZoom={setZoom}
        />
        <div className="flex-1 overflow-auto">
          <div className="flex min-h-full min-w-full items-center justify-center p-6">
            <img
              src={message.dataUrl}
              alt={message.fileName ?? "Shared photo"}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
              }}
              className="max-h-full max-w-full object-contain transition-transform"
            />
          </div>
        </div>
      </div>
    );
  }

  if (message.kind === "video") {
    return (
      <div className="fixed inset-0 flex flex-col">
        <TopBar
          title={message.fileName ?? "Video"}
          subtitle={subtitle}
          downloadUrl={objectUrl}
          downloadName={downloadName}
        />
        <div className="flex flex-1 items-center justify-center p-6">
          {/* Native controls include full-screen. */}
          <video
            src={message.dataUrl}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-xl"
          />
        </div>
      </div>
    );
  }

  if (message.kind === "voice") {
    return (
      <div className="fixed inset-0 flex flex-col">
        <TopBar
          title="Voice message"
          subtitle={subtitle}
          downloadUrl={objectUrl}
          downloadName={downloadName}
        />
        <div className="flex flex-1 items-center justify-center p-6">
          <audio src={message.dataUrl} controls autoPlay className="w-full max-w-md" />
        </div>
      </div>
    );
  }

  // kind "file": PDFs (and anything the browser can render, like text)
  // go through the native viewer in an iframe — page navigation, zoom,
  // and full-screen included. Everything else: download flow.
  const browserViewable =
    message.mimeType === "application/pdf" ||
    message.mimeType?.startsWith("text/") ||
    message.mimeType?.startsWith("image/");

  return (
    <div className="fixed inset-0 flex flex-col">
      <TopBar
        title={message.fileName ?? "File"}
        subtitle={subtitle}
        downloadUrl={objectUrl}
        downloadName={downloadName}
      />
      {browserViewable && objectUrl ? (
        <iframe
          src={objectUrl}
          title={message.fileName ?? "Document"}
          className="flex-1 border-0 bg-white"
        />
      ) : (
        <CenterNote
          title="Preview isn't available for this file type"
          body="Use Download above to save it — the file lives only on your device and the sender's, never on a server."
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<ViewerApp />);

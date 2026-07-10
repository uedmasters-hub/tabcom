import { Check, Mic, Video, X } from "lucide-react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";

/**
 * A one-time, full-tab permission grant. Exists because getUserMedia's
 * native permission prompt doesn't reliably render inside Tabcom's
 * small action popup or the call popup window — a well-known Chromium
 * quirk for transient extension surfaces, not something JS can work
 * around from inside them. Permission grants are scoped to the
 * extension's origin (chrome-extension://<id>), the SAME origin the
 * popup and call window run at — so granting it here, once, in a
 * stable full-tab context where the prompt can actually appear, is
 * enough to make it work everywhere in the extension afterward.
 */

const MIC_SETTINGS_URL = "chrome://settings/content/microphone";
const CAMERA_SETTINGS_URL = "chrome://settings/content/camera";

type DeviceStatus = "idle" | "requesting" | "granted" | "denied" | "error";

function DeviceRow({
  label,
  icon,
  constraint,
  settingsUrl,
}: {
  label: string;
  icon: React.ReactNode;
  constraint: MediaStreamConstraints;
  settingsUrl: string;
}) {
  const [status, setStatus] = useState<DeviceStatus>("idle");

  const request = async () => {
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraint);
      stream.getTracks().forEach((track) => track.stop()); // just proving access, not using it
      setStatus("granted");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setStatus(name === "NotAllowedError" ? "denied" : "error");
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 px-5 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {status === "idle" && "Not requested yet"}
          {status === "requesting" && "Waiting for your response…"}
          {status === "granted" && "Access granted — you're set"}
          {status === "denied" &&
            "Blocked. Chrome won't ask again here — reset it in settings, then retry."}
          {status === "error" && "Couldn't access this device."}
        </p>
      </div>

      {status === "granted" ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Check size={16} />
        </span>
      ) : status === "denied" ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500">
            <X size={16} />
          </span>
          <button
            type="button"
            onClick={() => void browser.tabs.create({ url: settingsUrl })}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
          >
            Open settings
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void request()}
          disabled={status === "requesting"}
          className="shrink-0 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {status === "requesting" ? "Requesting…" : "Grant access"}
        </button>
      )}
    </div>
  );
}

function PermissionsApp() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Enable microphone &amp; camera
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        To use voice messages and video calls, we need access to your microphone and camera. This is a one-time setup.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <DeviceRow
          label="Microphone"
          icon={<Mic size={18} />}
          constraint={{ audio: true }}
          settingsUrl={MIC_SETTINGS_URL}
        />
        <DeviceRow
          label="Camera"
          icon={<Video size={18} />}
          constraint={{ video: true }}
          settingsUrl={CAMERA_SETTINGS_URL}
        />
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        You can close this tab once both show as granted.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PermissionsApp />
  </StrictMode>
);

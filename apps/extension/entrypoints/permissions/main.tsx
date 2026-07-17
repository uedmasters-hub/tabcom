import { Bell, Check, MapPin, Mic, Video, X } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";

/**
 * Unified permission center — ONE setup surface for every browser
 * permission Tabcom uses (microphone, camera, location, notifications).
 *
 * Exists because native permission prompts don't reliably render inside
 * Tabcom's small action popup or the call popup window — a well-known
 * Chromium quirk for transient extension surfaces, not something JS can
 * work around from inside them. Grants are scoped to the extension's
 * origin (chrome-extension://<id>), the SAME origin every Tabcom
 * surface runs at — so granting here, once, in a stable full-tab
 * context where the prompt can actually appear, makes it work
 * everywhere afterward.
 *
 * Every row self-detects: it queries the current permission state on
 * load and subscribes to changes, so a grant flips the row to green
 * automatically — including grants made in browser settings while this
 * tab is open. Deep-linkable: ?focus=<permission> highlights the row
 * the user came for.
 */

const SETTINGS_URLS: Record<string, string> = {
  microphone: "chrome://settings/content/microphone",
  camera: "chrome://settings/content/camera",
  location: "chrome://settings/content/location",
  notifications: "chrome://settings/content/notifications",
};

type RowStatus = "idle" | "requesting" | "granted" | "denied" | "error";

/** Query + live-subscribe to a Permissions API state. Returns null
 *  when the browser can't report it (row falls back to idle). */
function usePermissionState(name: string | null): RowStatus | null {
  const [state, setState] = useState<RowStatus | null>(null);

  useEffect(() => {
    if (!name || !navigator.permissions?.query) return;
    let active = true;
    let statusRef: PermissionStatus | null = null;
    const apply = (value: PermissionState) => {
      if (!active) return;
      setState(
        value === "granted" ? "granted" : value === "denied" ? "denied" : null
      );
    };
    void navigator.permissions
      .query({ name: name as PermissionName })
      .then((status) => {
        statusRef = status;
        apply(status.state);
        status.onchange = () => apply(status.state);
      })
      .catch(() => setState(null));
    return () => {
      active = false;
      if (statusRef) statusRef.onchange = null;
    };
  }, [name]);

  return state;
}

function PermissionRow({
  id,
  label,
  description,
  icon,
  queryName,
  request,
  focused,
  requestless,
}: {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Permissions API name for auto-detection (null = not queryable). */
  queryName: string | null;
  /** Trigger the native prompt. Resolve = granted; reject with a
   *  DOMException NotAllowedError (or code 1) = denied. */
  request: () => Promise<void>;
  focused: boolean;
  /** True when there is no programmatic prompt (browser-level setting
   *  only) — the row offers Open settings instead of Grant access. */
  requestless?: boolean;
}) {
  const [manual, setManual] = useState<RowStatus>("idle");
  const detected = usePermissionState(queryName);
  // Auto-detection wins: a grant made anywhere (this page, settings,
  // another surface) flips the row without any click here.
  const status: RowStatus = detected ?? manual;

  const run = async () => {
    setManual("requesting");
    try {
      await request();
      setManual("granted");
    } catch (error) {
      const denied =
        (error instanceof DOMException && error.name === "NotAllowedError") ||
        (typeof error === "object" &&
          error !== null &&
          (error as { code?: number }).code === 1);
      setManual(denied ? "denied" : "error");
    }
  };

  return (
    <div
      id={`perm-${id}`}
      className={
        "flex items-center gap-4 rounded-2xl border px-5 py-4 transition " +
        (focused
          ? "border-blue-300 ring-2 ring-blue-100"
          : "border-slate-200")
      }
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {status === "granted"
            ? "Access granted — you're set"
            : status === "requesting"
              ? "Waiting for your response…"
              : status === "denied"
                ? "Blocked. The browser won't ask again here — reset it in settings, then this row will turn green by itself."
                : status === "error"
                  ? "Couldn't complete the request — try again."
                  : description}
        </p>
      </div>

      {status === "granted" ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Check size={16} />
        </span>
      ) : status === "denied" || requestless ? (
        <div className="flex shrink-0 items-center gap-2">
          {status === "denied" && (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500">
              <X size={16} />
            </span>
          )}
          <button
            type="button"
            onClick={() => void browser.tabs.create({ url: SETTINGS_URLS[id] })}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300"
          >
            Open settings
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void run()}
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
  const focus = new URLSearchParams(window.location.search).get("focus");

  useEffect(() => {
    if (!focus) return;
    document
      .getElementById(`perm-${focus}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Tabcom permissions
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Voice messages, calls, and location sharing each need a one-time
        browser permission. Grant what you use — each row updates by itself
        the moment access is given.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <PermissionRow
          id="microphone"
          label="Microphone"
          description="For voice messages and calls."
          icon={<Mic size={18} />}
          queryName="microphone"
          focused={focus === "microphone"}
          request={async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop()); // proving access, not using it
          }}
        />
        <PermissionRow
          id="camera"
          label="Camera"
          description="For video calls."
          icon={<Video size={18} />}
          queryName="camera"
          focused={focus === "camera"}
          request={async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach((track) => track.stop());
          }}
        />
        <PermissionRow
          id="location"
          label="Location"
          description="For sharing your location in chats — only ever sent when you choose to."
          icon={<MapPin size={18} />}
          queryName="geolocation"
          focused={focus === "location"}
          request={() =>
            new Promise<void>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(
                () => resolve(), // position discarded — this is only the grant
                (error) => reject(error),
                { timeout: 15_000 }
              );
            })
          }
        />
        <PermissionRow
          id="notifications"
          label="Notifications"
          description="Message and call alerts while Tabcom is closed. Controlled in browser settings."
          icon={<Bell size={18} />}
          queryName="notifications"
          focused={focus === "notifications"}
          requestless
          request={() => Promise.resolve()}
        />
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        You can close this tab once the permissions you need show as granted.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PermissionsApp />
  </StrictMode>
);

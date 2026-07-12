import { useState } from "react";
import { ImageOff } from "lucide-react";
import { browser } from "wxt/browser";
import { cn } from "../../lib/cn";

interface IllustrationProps {
  /** Filename under public/illustrations/, e.g. "communities-empty.png".
   *  Drop the real artwork in with this exact name and it renders
   *  automatically — nothing else to wire up. */
  name: string;
  /** Accessible description of what the illustration depicts. */
  alt: string;
  /** Roughly matches the reference mockups' illustration size. */
  size?: number;
  className?: string;
}

/**
 * Renders a 3D-style illustration asset by convention (public/illustrations/<name>),
 * falling back to a clearly-labeled placeholder box when the file hasn't
 * been added yet — so the app looks intentional rather than broken while
 * final artwork is still pending, and it's obvious to a developer exactly
 * which file to drop in and where.
 *
 * Uses browser.runtime.getURL rather than a bare "/illustrations/..."
 * path — a plain absolute path happens to resolve correctly in every
 * current use of this component (popup, the pip window — both genuine
 * chrome-extension:// pages), but getURL is the extension-idiomatic,
 * always-correct way to reference a bundled asset regardless of which
 * page or shadow-DOM context ends up rendering it later, and removes
 * one whole category of "why won't this load" guessing.
 *
 * To finish the visual polish pass: export each illustration from the
 * design file (Communities empty, Board/Tabs empty, Board/Pins empty,
 * Board/Areas empty, Discover empty, Session-timeout, Invite-code,
 * Connection-request) as a PNG or SVG, and save it into
 * apps/extension/public/illustrations/ using the exact `name` passed
 * at each call site below — see public/illustrations/README.md for
 * the full checklist, including a troubleshooting section for "I added
 * the file and it's still showing the placeholder."
 */
export default function Illustration({
  name,
  alt,
  size = 180,
  className,
}: IllustrationProps) {
  const [failed, setFailed] = useState(false);
  const src = browser.runtime.getURL(`/illustrations/${name}` as never);

  if (failed) {
    return (
      <div
        style={{ width: size, height: size * 0.78 }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 text-center",
          className
        )}
      >
        <ImageOff size={22} className="text-slate-300" />
        <p className="text-[11px] leading-4 text-slate-400">
          Add illustration
          <br />
          <code className="text-slate-500">/illustrations/{name}</code>
        </p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      onError={() => {
        // The single most useful line for diagnosing "I added the file
        // and it's still a placeholder" — this prints the EXACT URL
        // Chrome tried and failed to fetch. Open the popup's own
        // DevTools (right-click the panel -> Inspect) and check both
        // this console line and the Network tab for that URL's status:
        // 404 means the file isn't in the build (wrong name/location,
        // or forgot to rebuild); anything else points elsewhere.
        console.error(
          `[tabcom] illustration failed to load: ${src} — check that ` +
            `apps/extension/public/illustrations/${name} exists with ` +
            `this EXACT filename (case-sensitive), then rebuild ` +
            `(pnpm build) and reload the extension in chrome://extensions.`
        );
        setFailed(true);
      }}
      className={cn("select-none object-contain", className)}
      style={{ maxWidth: size, maxHeight: size }}
      draggable={false}
    />
  );
}

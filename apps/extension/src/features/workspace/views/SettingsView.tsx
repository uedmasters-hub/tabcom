import { Camera, Check, Globe, Lock, MousePointer2, PictureInPicture2, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Avatar,
  Button,
  Input,
  OptionCard,
  SectionLabel,
} from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { sendVerificationEmail } from "../../../lib/auth-client";
import { getCursorsEnabled, setCursorsEnabled } from "../../../lib/cursor-settings";
import { reannounce, updateVisibility } from "../../../lib/realtime";
import { useAppStore } from "../../../stores/app.store";
import {
  AVATAR_COLORS,
  useProfileStore,
  type ProfileVisibility,
} from "../../../stores/profile.store";

const visibilityOptions: Array<{
  id: ProfileVisibility;
  title: string;
  description: string;
  icon: typeof Globe;
}> = [
  {
    id: "public",
    title: "Public Profile",
    description: "Anyone can find and connect with you.",
    icon: Globe,
  },
  {
    id: "private",
    title: "Private Profile",
    description: "Complete end: invisible, unreachable, cannot message.",
    icon: Lock,
  },
];

/** Flat row + toggle, matching the presence menu's minimal density —
 *  no bordered box per item, just icon, two lines of text, and a
 *  switch. Rows are separated by the container's divide-y. */
function SettingRow({
  icon,
  label,
  description,
  checked,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
    >
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-slate-900" : "bg-slate-200"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

/** Downscale an image file to a small square data URL (~4-10 KB). */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);

  return canvas.toDataURL("image/jpeg", 0.75);
}

export default function SettingsView() {
  const setScreen = useAppStore((state) => state.setScreen);
  const username = useProfileStore((state) => state.username);
  const sessionToken = useProfileStore((state) => state.sessionToken);
  const verified = useProfileStore((state) => state.verified);
  const displayName = useProfileStore((state) => state.displayName);
  const visibility = useProfileStore((state) => state.visibility);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const photo = useProfileStore((state) => state.photo);
  const animations = useProfileStore((state) => state.animations);
  const pipEnabled = useProfileStore((state) => state.pipEnabled);

  const [cursorsEnabled, setCursorsEnabledState] = useState(true);

  useEffect(() => {
    void getCursorsEnabled().then(setCursorsEnabledState);
  }, []);

  const toggleCursors = () => {
    const next = !cursorsEnabled;
    setCursorsEnabledState(next);
    void setCursorsEnabled(next);
  };

  const setIdentity = useProfileStore((state) => state.setIdentity);
  const setAvatarColor = useProfileStore((state) => state.setAvatarColor);
  const setPhoto = useProfileStore((state) => state.setPhoto);
  const setAnimations = useProfileStore((state) => state.setAnimations);
  const setPipEnabled = useProfileStore((state) => state.setPipEnabled);
  const setVisibilityLocal = useProfileStore((state) => state.setVisibility);

  const [name, setName] = useState(displayName);
  const [verificationSent, setVerificationSent] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const sendVerification = async () => {
    if (!sessionToken) return;
    setSendingVerification(true);
    setVerificationError(null);
    const result = await sendVerificationEmail(sessionToken);
    setSendingVerification(false);
    if (result.ok) {
      setVerificationSent(true);
    } else {
      setVerificationError(
        result.reason === "unreachable"
          ? "Couldn't reach Tabcom's server — make sure it's running and try again."
          : "Couldn't send the verification email. Try again in a moment."
      );
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);

  /** Push current profile to the server so others see changes live. */
  const announce = (patch?: Partial<{ name: string; color: string; photo?: string }>) => {
    reannounce({
      username,
      name: patch?.name ?? useProfileStore.getState().displayName,
      color: patch?.color ?? useProfileStore.getState().avatarColor,
      photo: "photo" in (patch ?? {}) ? patch?.photo : useProfileStore.getState().photo,
      visibility: useProfileStore.getState().visibility,
    });
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setIdentity({ displayName: trimmed, username });
    announce({ name: trimmed });
  };

  const pickColor = (color: string) => {
    setAvatarColor(color);
    announce({ color });
  };

  const uploadPhoto = async (file?: File) => {
    if (!file) return;
    const dataUrl = await compressImage(file);
    setPhoto(dataUrl);
    announce({ photo: dataUrl });
  };

  const removePhoto = () => {
    setPhoto(undefined);
    announce({ photo: undefined });
  };

  const setVisibility = (value: ProfileVisibility) => {
    setVisibilityLocal(value);
    updateVisibility(value);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      {!sessionToken && (
        <button
          type="button"
          onClick={() => setScreen("signin")}
          className="mb-6 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-left transition hover:border-blue-300"
        >
          <Lock size={18} className="shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-blue-900">
              You're using Tabcom as a guest
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-blue-700">
              Sign in to protect @{username} from being taken by someone
              else, and pick up your account on other devices.
            </span>
          </span>
        </button>
      )}

      {sessionToken && !verified && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <ShieldAlert size={18} className="shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-amber-900">
              Your email isn't verified yet
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-amber-700">
              {verificationError
                ? verificationError
                : verificationSent
                  ? "Check your email for the link — this updates automatically once you click it."
                  : "People you contact can see this. Verify to remove the notice."}
            </span>
          </span>
          {!verificationSent && (
            <button
              type="button"
              onClick={() => void sendVerification()}
              disabled={sendingVerification}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {sendingVerification ? "Sending…" : verificationError ? "Retry" : "Verify"}
            </button>
          )}
        </div>
      )}

      {/* Profile editor */}
      <SectionLabel>Profile</SectionLabel>

      <div className="mt-4 flex items-center gap-4">
        <div className="relative">
          <Avatar
            name={displayName}
            color={avatarColor}
            photo={photo}
            size="xl"
          />
          <button
            type="button"
            title="Upload photo"
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-white transition hover:bg-slate-700"
          >
            <Camera size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void uploadPhoto(event.target.files?.[0])}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">@{username}</p>
          {photo && (
            <button
              type="button"
              onClick={removePhoto}
              className="mt-1 flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-red-600"
            >
              <Trash2 size={12} /> Remove photo
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Display name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button
          size="lg"
          variant="outline"
          disabled={name.trim() === displayName || name.trim().length < 2}
          onClick={saveName}
        >
          Save
        </Button>
      </div>

      {/* Avatar color */}
      <div className="mt-4 flex flex-wrap gap-2.5">
        {AVATAR_COLORS.map(({ id, value }) => (
          <button
            key={id}
            type="button"
            aria-label={id}
            onClick={() => pickColor(value)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105",
              value === avatarColor && "ring-2 ring-slate-900 ring-offset-2"
            )}
            style={{ backgroundColor: value }}
          >
            {value === avatarColor && (
              <Check size={13} className="text-white" />
            )}
          </button>
        ))}
      </div>

      {/* Discovery — the most consequential setting, surfaced first */}
      <SectionLabel className="mt-8">Discovery</SectionLabel>

      <div className="mt-4 flex flex-col gap-3">
        {visibilityOptions.map(({ id, title, description, icon: Icon }) => (
          <OptionCard
            key={id}
            title={title}
            description={description}
            icon={<Icon size={18} />}
            selected={visibility === id}
            trailing={
              visibility === id ? (
                <Check size={18} className="text-blue-600" />
              ) : undefined
            }
            onClick={() => setVisibility(id)}
          />
        ))}
      </div>

      {/* Preferences — flat list, matches the status-menu pattern */}
      <SectionLabel className="mt-8">Preferences</SectionLabel>

      <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
        <SettingRow
          icon={<MousePointer2 size={17} />}
          label="Live cursors"
          description="See where members are looking"
          checked={cursorsEnabled}
          onToggle={toggleCursors}
        />
        <SettingRow
          icon={<Sparkles size={17} />}
          label="Message animations"
          description="Spring animation on new messages"
          checked={animations}
          onToggle={() => setAnimations(!animations)}
        />
        <SettingRow
          icon={<PictureInPicture2 size={17} />}
          label="Floating chat"
          description="Pop out a chat into its own window"
          checked={pipEnabled}
          onToggle={() => setPipEnabled(!pipEnabled)}
        />
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Tabcom v0.1 — Browser-first communication · zero message retention
      </p>
    </div>
  );
}

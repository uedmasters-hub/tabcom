import { Camera, Check, CircleDot, Globe, Lock, LogOut, PictureInPicture2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Avatar,
  Button,
  Input,
  OptionCard,
  SectionLabel,
} from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { SettingsToggleRow } from "../../../components/shared/SettingsToggleRow";
import { getPillEnabled, setPillEnabled } from "../../../lib/pill-settings";
import {
  disconnectRealtime,
  reannounce,
  updateVisibility,
} from "../../../lib/realtime";
import { useAppStore } from "../../../stores/app.store";
import { useChatStore } from "../../../stores/chat.store";
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
  const displayName = useProfileStore((state) => state.displayName);
  const visibility = useProfileStore((state) => state.visibility);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const photo = useProfileStore((state) => state.photo);
  const animations = useProfileStore((state) => state.animations);
  const pipEnabled = useProfileStore((state) => state.pipEnabled);

  const setIdentity = useProfileStore((state) => state.setIdentity);
  const setAvatarColor = useProfileStore((state) => state.setAvatarColor);
  const setPhoto = useProfileStore((state) => state.setPhoto);
  const setAnimations = useProfileStore((state) => state.setAnimations);
  const setPipEnabled = useProfileStore((state) => state.setPipEnabled);
  const setVisibilityLocal = useProfileStore((state) => state.setVisibility);
  const resetProfile = useProfileStore((state) => state.resetProfile);
  const resetChat = useChatStore((state) => state.resetChat);

  const [name, setName] = useState(displayName);
  const [pillEnabled, setPillEnabledState] = useState(true);

  useEffect(() => {
    void getPillEnabled().then(setPillEnabledState);
  }, []);

  const togglePill = () => {
    const next = !pillEnabled;
    setPillEnabledState(next);
    void setPillEnabled(next);
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

  const signOut = () => {
    disconnectRealtime();
    resetChat();
    resetProfile();
    setScreen("welcome");
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
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

      {/* Chat preferences */}
      <SectionLabel className="mt-8">Chat</SectionLabel>

      <SettingsToggleRow
        className="mt-4"
        icon={<Sparkles size={18} />}
        label="Message animations"
        description="Apple-style spring pop when messages arrive."
        checked={animations}
        onToggle={() => setAnimations(!animations)}
      />

      <SettingsToggleRow
        className="mt-3"
        icon={<CircleDot size={18} />}
        label="Tabcom pill on pages"
        description="Quick actions on every page — and your presence: while the pill is on you appear Online even with this panel closed; turn it off to go offline."
        checked={pillEnabled}
        onToggle={togglePill}
      />

      <SettingsToggleRow
        className="mt-3"
        icon={<PictureInPicture2 size={18} />}
        label="Floating chat"
        description="Pop a chat into its own small window that keeps working when the main browser window is minimized. While it's open you appear Online."
        checked={pipEnabled}
        onToggle={() => setPipEnabled(!pipEnabled)}
      />

      {/* Visibility */}
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

      {/* Account */}
      <SectionLabel className="mt-8">Account</SectionLabel>

      <Button
        variant="outline"
        fullWidth
        className="mt-4 text-red-600 hover:border-red-200 hover:bg-red-50"
        leftIcon={<LogOut size={16} />}
        onClick={signOut}
      >
        Sign out
      </Button>

      <p className="mt-8 text-center text-xs text-slate-400">
        Tabcom v0.1 — Browser-first communication · zero message retention
      </p>
    </div>
  );
}

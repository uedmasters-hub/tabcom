import { Camera, Check, Copy, Globe, Lock, LogOut, MousePointer2, PictureInPicture2, ShieldAlert, Sparkles, Ticket, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Avatar,
  Button,
  Input,
  OptionCard,
  SectionLabel,
} from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { deleteAccount, fetchInvites, logout, sendVerificationEmail, type InviteSummary } from "../../../lib/auth-client";
import { getCursorsEnabled, setCursorsEnabled } from "../../../lib/cursor-settings";
import { FLOATING_PILL_ENABLED } from "../../../lib/feature-flags";
import { disconnectRealtime, reannounce, updateVisibility } from "../../../lib/realtime";
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
  const isGuest = useProfileStore((state) => state.isGuest);
  const guestExpiresAt = useProfileStore((state) => state.guestExpiresAt);
  const resetProfile = useProfileStore((state) => state.resetProfile);
  const resetChat = useChatStore((state) => state.resetChat);

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
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Invitations — signed-in accounts each hold 5 single-use codes.
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Forces a re-render once a minute so the guest countdown stays
  // roughly live without a per-second timer nobody needs.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isGuest) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, [isGuest]);

  const guestMinutesLeft =
    isGuest && guestExpiresAt
      ? Math.max(0, Math.ceil((guestExpiresAt - Date.now()) / 60_000))
      : null;

  useEffect(() => {
    if (!sessionToken) return;
    void fetchInvites(sessionToken).then((result) => {
      if (result.ok) setInvites(result.invites);
    });
  }, [sessionToken]);

  const copyInvite = (code: string) => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 1500);
    });
  };

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

  // Real-account sign-out deliberately leaves local device data in
  // place — see chat.store's own persistence notes — since that data
  // was never the account's to begin with in this architecture.
  //
  // Guests are different: a guest identity is meant to be fully
  // disposable, and two different guests must never appear linked in
  // any way (see ensureUniqueGuestUsername server-side, and the
  // matching decision here). Ending a guest session — by choice or by
  // the 30-minute timeout in WorkspaceScreen/App.tsx — clears
  // everything so the NEXT guest (or the next session generally)
  // starts from a genuinely clean slate, not a carried-over one.
  const signOut = async () => {
    if (!sessionToken) {
      disconnectRealtime();
      resetProfile();
      resetChat();
      setScreen("welcome");
      return;
    }
    setSigningOut(true);
    try {
      await logout(sessionToken); // best-effort — proceed either way
    } finally {
      setSigningOut(false);
      disconnectRealtime();
      resetProfile();
      setScreen("welcome");
    }
  };

  // Same local-data principle as sign-out: this ends the ACCOUNT, not
  // this device's chat history, which was never the account's to
  // begin with in this architecture.
  const handleDeleteAccount = async () => {
    if (!sessionToken) return;
    setDeletingAccount(true);
    setDeleteError(null);
    const result = await deleteAccount(sessionToken);
    setDeletingAccount(false);

    if (!result.ok) {
      setDeleteError(
        result.reason === "unreachable"
          ? "Couldn't reach Tabcom's server — make sure it's running and try again."
          : "Couldn't delete your account right now. Try again in a moment."
      );
      return;
    }

    disconnectRealtime();
    resetProfile();
    setScreen("welcome");
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
          onClick={() => setScreen("register", { returnTo: "workspace" })}
          className="mb-6 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-left transition hover:border-blue-300"
        >
          <Lock size={18} className="shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-blue-900">
              {guestMinutesLeft !== null
                ? `Guest session — ${guestMinutesLeft} min left`
                : "You're using Tabcom as a guest"}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-blue-700">
              Register to make it permanent, pick your own username, and
              sync across devices — no time limit.
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

      {/* Invitations — Tabcom is invite-only; these are this account's
          codes to hand out. Guests don't have server accounts, so the
          section only exists when signed in. */}
      {sessionToken && (
        <>
          <SectionLabel className="mt-8">Invitations</SectionLabel>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Tabcom is invite-only. Share these codes to bring people in —
            each works exactly once.
          </p>

          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {invites === null ? (
              <p className="px-4 py-3 text-xs text-slate-400">
                Loading your invitations…
              </p>
            ) : invites.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-400">
                No invitation codes on this account yet.
              </p>
            ) : (
              invites.map((invite) => (
                <div
                  key={invite.code}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <Ticket
                    size={15}
                    className={cn(
                      "shrink-0",
                      invite.used ? "text-slate-300" : "text-blue-600"
                    )}
                  />
                  <code
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide",
                      invite.used
                        ? "text-slate-300 line-through"
                        : "text-slate-700"
                    )}
                  >
                    {invite.code}
                  </code>
                  {invite.used ? (
                    <span className="shrink-0 text-[11px] font-medium text-slate-400">
                      Used
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => copyInvite(invite.code)}
                      aria-label={`Copy ${invite.code}`}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      {copiedCode === invite.code ? (
                        <>
                          <Check size={12} className="text-emerald-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          Copy
                        </>
                      )}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

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
        {FLOATING_PILL_ENABLED && (
          <SettingRow
            icon={<PictureInPicture2 size={17} />}
            label="Floating chat"
            description="Pop out a chat into its own window"
            checked={pipEnabled}
            onToggle={() => setPipEnabled(!pipEnabled)}
          />
        )}
      </div>

      {/* Account — session + lifecycle actions, same flat-row density
          as everything above rather than a separate bordered "card". */}
      <SectionLabel className="mt-8">Account</SectionLabel>

      <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
        >
          <LogOut size={17} className="shrink-0 text-slate-400" />
          {signingOut
            ? "Signing out…"
            : sessionToken
              ? "Sign out"
              : "End guest session"}
        </button>

        {sessionToken && (
          <div>
            {confirmingDelete ? (
              <div className="flex flex-col gap-2 px-4 py-3">
                <p className="text-xs leading-5 text-slate-500">
                  This permanently deletes your account, invitation codes,
                  and sessions. Local chat history on this device is not
                  affected. This can't be undone.
                </p>
                {deleteError && (
                  <p className="text-xs text-red-600">{deleteError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount()}
                    disabled={deletingAccount}
                    className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white transition disabled:opacity-60"
                  >
                    {deletingAccount ? "Deleting…" : "Delete permanently"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeleteError(null);
                    }}
                    disabled={deletingAccount}
                    className="rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                <Trash2 size={17} />
                Delete account
              </button>
            )}
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Tabcom v0.1 — Browser-first communication · zero message retention
      </p>
    </div>
  );
}

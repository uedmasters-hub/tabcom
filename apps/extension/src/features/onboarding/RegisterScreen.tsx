import { ArrowRight, Check, Loader2, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button, Input, SectionLabel } from "../../components/ui";
import { checkInvite, checkUsernameAvailable, registerAccount } from "../../lib/auth-client";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";

type UsernameState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken"; suggestions: string[] }
  | { status: "invalid" }
  | { status: "error" }
  | { status: "unreachable" };

type InviteState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid" }
  | { status: "invalid" }
  | { status: "unreachable" };

/**
 * The lean onboarding entry point: invite code + name + username +
 * email, account usable immediately. No click-a-link wait — see
 * profile.store's sessionToken/verified split and Settings' unverified
 * nudge for how verification happens later instead of gating this
 * screen. Tabcom is invite-only: the code gate is the one hard
 * requirement here, everything else stays lean.
 */
export default function RegisterScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const setSession = useProfileStore((state) => state.setSession);
  const setVerified = useProfileStore((state) => state.setVerified);
  const setIdentity = useProfileStore((state) => state.setIdentity);

  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [inviteState, setInviteState] = useState<InviteState>({ status: "idle" });
  const [usernameState, setUsernameState] = useState<UsernameState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCheckId = useRef(0);
  const inviteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestInviteCheckId = useRef(0);

  useEffect(() => {
    if (inviteDebounceRef.current) clearTimeout(inviteDebounceRef.current);

    const candidate = inviteCode.trim().toUpperCase();
    if (!candidate) {
      setInviteState({ status: "idle" });
      return;
    }
    // Don't ping the server on every keystroke of a partial code —
    // codes are TAB-XXXX-XXXX (12+ chars), so wait for a plausible length.
    if (candidate.length < 10) {
      setInviteState({ status: "idle" });
      return;
    }

    setInviteState({ status: "checking" });
    const checkId = ++latestInviteCheckId.current;

    inviteDebounceRef.current = setTimeout(async () => {
      const result = await checkInvite(candidate);
      if (checkId !== latestInviteCheckId.current) return;

      if (result.ok) {
        setInviteState({ status: "valid" });
      } else if (result.reason === "unreachable") {
        setInviteState({ status: "unreachable" });
      } else {
        setInviteState({ status: "invalid" });
      }
    }, 400);

    return () => {
      if (inviteDebounceRef.current) clearTimeout(inviteDebounceRef.current);
    };
  }, [inviteCode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const candidate = username.trim().toLowerCase();
    if (!candidate) {
      setUsernameState({ status: "idle" });
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(candidate)) {
      setUsernameState({ status: "invalid" });
      return;
    }

    setUsernameState({ status: "checking" });
    const checkId = ++latestCheckId.current;

    debounceRef.current = setTimeout(async () => {
      const result = await checkUsernameAvailable(candidate);
      if (checkId !== latestCheckId.current) return; // a newer keystroke superseded this check

      if (!result.ok) {
        if (result.reason === "unreachable") {
          setUsernameState({ status: "unreachable" });
        } else if (result.reason === "invalid_format") {
          setUsernameState({ status: "invalid" });
        } else {
          // The server responded but couldn't complete the check
          // (e.g. a database problem) — this is NOT the same thing
          // as the username being badly formatted, and showing the
          // format-rule copy here would be actively misleading.
          setUsernameState({ status: "error" });
        }
      } else if (result.available) {
        setUsernameState({ status: "available" });
      } else {
        setUsernameState({ status: "taken", suggestions: result.suggestions ?? [] });
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username]);

  const canSubmit =
    (inviteState.status === "valid" || inviteState.status === "unreachable") &&
    displayName.trim().length >= 2 &&
    (usernameState.status === "available" ||
      usernameState.status === "unreachable" ||
      usernameState.status === "error") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const result = await registerAccount(
      email.trim().toLowerCase(),
      username.trim().toLowerCase(),
      displayName.trim(),
      "#2563EB", // finalized on the next screen
      inviteCode.trim().toUpperCase()
    );

    setSubmitting(false);

    if (!result.ok) {
      if (result.reason === "invalid_invite") {
        setInviteState({ status: "invalid" });
      } else if (result.reason === "username_taken") {
        setUsernameState({ status: "taken", suggestions: [] });
      } else if (result.reason === "unreachable") {
        setError("Couldn't reach Tabcom's server. Make sure it's running, then try again.");
      } else {
        setError("Something went wrong — check your details and try again.");
      }
      return;
    }

    setSession(result.sessionToken, result.user.email);
    setVerified(result.user.verified);
    setIdentity({ displayName: displayName.trim(), username: username.trim().toLowerCase() });
    setScreen("profile");
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("welcome")} />

        <section className="flex flex-1 flex-col overflow-y-auto px-6">
          <SectionLabel>Create your account</SectionLabel>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            You're invited — almost in.
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Tabcom is invite-only right now. Enter your invitation code to
            create an account — we'll ask you to confirm your email later.
          </p>

          <div className="mt-8 space-y-4">
            <div>
              <Input
                label="Invitation code"
                placeholder="TAB-XXXX-XXXX"
                autoFocus
                autoComplete="off"
                value={inviteCode}
                onChange={(event) =>
                  setInviteCode(event.target.value.toUpperCase())
                }
              />
              <div className="mt-1.5 min-h-[18px] text-xs">
                {inviteState.status === "checking" && (
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Loader2 size={11} className="animate-spin" /> Checking your invitation…
                  </span>
                )}
                {inviteState.status === "valid" && (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                    <Ticket size={12} /> Invitation accepted — welcome aboard
                  </span>
                )}
                {inviteState.status === "invalid" && (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <X size={12} /> That code isn't valid or was already used.
                  </span>
                )}
                {inviteState.status === "unreachable" && (
                  <span className="text-amber-600">
                    Couldn't verify right now — it'll be checked when you continue.
                  </span>
                )}
              </div>
            </div>

            <Input
              label="Display Name"
              placeholder="Ramesh Mandal"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />

            <div>
              <Input
                label="Username"
                placeholder="ramesh"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <div className="mt-1.5 min-h-[18px] text-xs">
                {usernameState.status === "checking" && (
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Loader2 size={11} className="animate-spin" /> Checking availability…
                  </span>
                )}
                {usernameState.status === "available" && (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                    <Check size={12} /> @{username.trim().toLowerCase()} is available
                  </span>
                )}
                {usernameState.status === "invalid" && (
                  <span className="text-red-500">
                    3-20 characters — lowercase letters, numbers and underscores only.
                  </span>
                )}
                {usernameState.status === "error" && (
                  <span className="text-amber-600">
                    Couldn't check availability right now (server issue) — you can still continue.
                  </span>
                )}
                {usernameState.status === "taken" && (
                  <div className="flex items-center gap-1.5 text-red-500">
                    <X size={12} /> Already taken.
                  </div>
                )}
                {usernameState.status === "unreachable" && (
                  <span className="text-amber-600">
                    Couldn't check availability right now — you can still continue.
                  </span>
                )}
              </div>
              {usernameState.status === "taken" && (usernameState.suggestions ?? []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {usernameState.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setUsername(s)}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Input
              label="Email address"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={error ?? undefined}
            />
          </div>

          {/* CTA lives in the scrollable flow, not a pinned footer — it
              scrolls with the form instead of sitting fixed over the
              last field on short screens. */}
          <div className="mt-8 space-y-3 pb-8">
            <Button
              fullWidth
              disabled={!canSubmit || submitting}
              onClick={() => void submit()}
              rightIcon={<ArrowRight size={18} />}
            >
              {submitting ? "Creating your account…" : "Continue"}
            </Button>

            <button
              type="button"
              onClick={() => setScreen("signin")}
              className="w-full text-center text-xs font-medium text-slate-400 transition hover:text-slate-600"
            >
              Already have an account? Sign in
            </button>

            <button
              type="button"
              onClick={() => setScreen("setup")}
              className="w-full text-center text-xs font-medium text-slate-400 transition hover:text-slate-600"
            >
              Continue as a guest instead
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

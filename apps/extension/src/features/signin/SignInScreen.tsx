import { ArrowRight, BadgeCheck, Loader2, Lock, Mail, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button, Input, SectionLabel } from "../../components/ui";
import {
  checkEmail,
  isMagicLinkGranted,
  requestMagicLink,
  submitInviteRequest,
  waitForLogin,
} from "../../lib/auth-client";
import { wipeGuestLocalState } from "../../lib/guest-session";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";

type Stage = "email" | "sent" | "not_registered" | "error";

const NOT_REGISTERED_MESSAGE =
  "We couldn't find an active account associated with this email address. Invitations are not yet available for your account. We'll notify you once invitations are ready. In the meantime, you can continue using Tabcom as a Guest.";

const BENEFITS = [
  { icon: Lock, text: "Your username is yours — nobody else can claim it" },
  { icon: RefreshCw, text: "Sign in again on any device and pick up where you left off" },
  { icon: BadgeCheck, text: "People you talk to know it's really you, not just a typed name" },
];

/**
 * Real passwordless sign-in: request a magic link, wait for the
 * person to click it in their email, pick up the resulting session
 * via polling. No password ever exists to store or leak.
 *
 * The "check your email" stage is unreachable unless the backend
 * confirms the address belongs to a fully registered account.
 */
export default function SignInScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const goBack = useAppStore((state) => state.goBack);
  const setSession = useProfileStore((state) => state.setSession);
  const setVerified = useProfileStore((state) => state.setVerified);
  const setIdentity = useProfileStore((state) => state.setIdentity);
  const completeProfile = useProfileStore((state) => state.completeProfile);
  const isGuest = useProfileStore((state) => state.isGuest);

  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const markNotRegistered = (address: string) => {
    setStage("not_registered");
    // Waitlist only — never call request-link here (that was minting
    // magic-link emails while this UI said "no account found").
    void submitInviteRequest(address);
  };

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);

    try {
      const eligibility = await checkEmail(trimmed);
      if (!eligibility.ok) {
        setError(
          eligibility.reason === "invalid_email"
            ? "That doesn't look like a valid email address."
            : "Couldn't reach Tabcom's server. Make sure it's running, then try again."
        );
        setStage("error");
        setSubmitting(false);
        return;
      }

      // Only trust an explicit false. Legacy catch-all `{ ok: true }`
      // without `eligible` must fall through to request-link.
      if (eligibility.eligible === false) {
        markNotRegistered(trimmed);
        setSubmitting(false);
        return;
      }

      const result = await requestMagicLink(trimmed);
      if (!isMagicLinkGranted(result)) {
        if (result.reason === "not_registered") {
          markNotRegistered(trimmed);
        } else {
          setError(
            result.reason === "rate_limited"
              ? "You already requested a link — check your email, or wait a minute to try again."
              : result.reason === "unreachable"
                ? "Couldn't reach Tabcom's server. Make sure it's running, then try again."
                : "That doesn't look like a valid email address."
          );
          setStage("error");
        }
        setSubmitting(false);
        return;
      }

      setStage("sent");
      setSubmitting(false);

      const outcome = await waitForLogin(result.pollId);
      if (!outcome) {
        setError("That link expired. Request a new one below.");
        setStage("error");
        return;
      }

      // Signing in must not inherit disposable guest chat residue.
      if (isGuest) {
        await wipeGuestLocalState();
      }

      setSession(outcome.sessionToken, outcome.user.email);
      setVerified(true);

      if (outcome.user.username && outcome.user.displayName) {
        setIdentity({
          displayName: outcome.user.displayName,
          username: outcome.user.username,
        });
        completeProfile();
        setScreen("workspace");
      } else {
        setError(
          "This account is incomplete. Please register with an invite code, or continue as a Guest."
        );
        setStage("error");
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setStage("error");
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => goBack("welcome")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Sign in</SectionLabel>

          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            {stage === "sent"
              ? "Check your email"
              : stage === "not_registered"
                ? "No account found"
                : "Continue to Tabcom"}
          </h1>

          {stage === "sent" ? (
            <div className="mt-10 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                <Mail size={26} className="text-blue-600" />
              </div>
              <p className="mt-6 text-sm leading-6 text-slate-500">
                We sent a sign-in link to
                <br />
                <span className="font-semibold text-slate-900">{email}</span>
              </p>
              <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" />
                Waiting for you to click it — this page updates automatically.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStage("email");
                  setError(null);
                }}
                className="mt-8 flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600"
              >
                <RotateCcw size={12} />
                Use a different email
              </button>
            </div>
          ) : stage === "not_registered" ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              {NOT_REGISTERED_MESSAGE}
            </div>
          ) : (
            <>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                No password to remember — we'll email you a link to sign in.
                You must already have a Tabcom account.
              </p>

              <div className="mt-10">
                <Input
                  label="Email address"
                  type="email"
                  placeholder="you@example.com"
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError(null);
                    if (stage === "error") setStage("email");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                  error={error ?? undefined}
                />
              </div>

              <ul className="mt-8 space-y-3">
                {BENEFITS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5 text-xs text-slate-500">
                    <Icon size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <span className="leading-5">{text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {stage !== "sent" && (
          <ScreenFooter>
            {stage === "not_registered" ? (
              <div className="flex flex-col gap-2">
                <Button fullWidth onClick={() => setScreen("guest-setup")}>
                  Continue as Guest
                </Button>
                <button
                  type="button"
                  onClick={() => setScreen("register")}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  I have an invite code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStage("email");
                  }}
                  className="text-xs font-medium text-slate-400 hover:text-slate-600"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <Button
                fullWidth
                disabled={submitting || !email.trim()}
                onClick={() => void submit()}
                rightIcon={<ArrowRight size={18} />}
              >
                {submitting ? "Sending…" : "Send sign-in link"}
              </Button>
            )}
          </ScreenFooter>
        )}
      </div>
    </AppShell>
  );
}

import { ArrowRight, BadgeCheck, Loader2, Lock, Mail, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button, Input, SectionLabel } from "../../components/ui";
import { requestMagicLink, waitForLogin } from "../../lib/auth-client";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";

type Stage = "email" | "sent" | "error";

const BENEFITS = [
  { icon: Lock, text: "Your username is yours — nobody else can claim it" },
  { icon: RefreshCw, text: "Sign in again on any device and pick up where you left off" },
  { icon: BadgeCheck, text: "People you talk to know it's really you, not just a typed name" },
];

/**
 * Real passwordless sign-in: request a magic link, wait for the
 * person to click it in their email, pick up the resulting session
 * via polling. No password ever exists to store or leak.
 */
export default function SignInScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const goBack = useAppStore((state) => state.goBack);
  const setSession = useProfileStore((state) => state.setSession);
  const setVerified = useProfileStore((state) => state.setVerified);
  const setIdentity = useProfileStore((state) => state.setIdentity);
  const completeProfile = useProfileStore((state) => state.completeProfile);

  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await requestMagicLink(trimmed);
      if (!result.ok || !result.pollId) {
        setError(
          result.reason === "rate_limited"
            ? "You already requested a link — check your email, or wait a minute to try again."
            : result.reason === "unreachable"
              ? "Couldn't reach Tabcom's server. Make sure it's running, then try again."
              : "That doesn't look like a valid email address."
        );
        setStage("error");
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

      setSession(outcome.sessionToken, outcome.user.email);
      setVerified(true); // clicking the magic link IS the verification

      if (outcome.user.username) {
        // Returning account, already has a profile — go straight in.
        setIdentity({
          displayName: outcome.user.displayName ?? outcome.user.username,
          username: outcome.user.username,
        });
        completeProfile();
        setScreen("workspace");
      } else {
        setScreen("setup");
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
            {stage === "sent" ? "Check your email" : "Continue to Tabcom"}
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
          ) : (
            <>
              <p className="mt-4 text-sm leading-7 text-slate-500">
                No password to remember — we'll email you a link to sign in.
              </p>

              <div className="mt-10">
                <Input
                  label="Email address"
                  type="email"
                  placeholder="you@example.com"
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
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
            <Button
              fullWidth
              disabled={submitting || !email.trim()}
              onClick={() => void submit()}
              rightIcon={<ArrowRight size={18} />}
            >
              {submitting ? "Sending…" : "Send sign-in link"}
            </Button>
          </ScreenFooter>
        )}
      </div>
    </AppShell>
  );
}

import { useEffect } from "react";

import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";
import WorkspaceScreen from "../features/workspace";
import { GuestExpiredScreen, GuestSetupScreen } from "../features/guest";

import { DoneScreen, ProfileScreen, RegisterScreen, SetupScreen } from "../features/onboarding";

import { useAppStore } from "../stores/app.store";
import { useChatStore } from "../stores/chat.store";
import { useProfileStore } from "../stores/profile.store";
import { disconnectAllContexts } from "../lib/realtime";
import { recognizeDevice, endGuestSessionOnServer } from "../lib/auth-client";

export default function App() {
  const screen = useAppStore((state) => state.screen);
  const setScreen = useAppStore((state) => state.setScreen);

  const hasHydrated = useProfileStore((state) => state.hasHydrated);
  const isComplete = useProfileStore((state) => state.isComplete);
  const isGuestSessionExpired = useProfileStore(
    (state) => state.isGuestSessionExpired
  );
  const endGuestSession = useProfileStore((state) => state.endGuestSession);
  const restoreRecognizedGuest = useProfileStore(
    (state) => state.restoreRecognizedGuest
  );
  const resetChat = useChatStore((state) => state.resetChat);

  // Returning users skip onboarding once storage has hydrated. The
  // socket's own session validation (server-side) is the real gate —
  // if a stored session has expired, connecting simply falls back to
  // the pre-auth trust model rather than hard-locking someone out of
  // an extension they already set up.
  //
  // Guest sessions are the one exception: a guest whose 30 minutes
  // ran out while the popup was closed should land on the "session
  // ended" screen on reopen, not silently back in the workspace — and
  // with a fully clean chat.store, not carrying anything forward. A
  // guest identity is disposable by design; nothing about it should
  // outlive the session it belonged to.
  useEffect(() => {
    if (!hasHydrated) return;

    if (isComplete) {
      if (isGuestSessionExpired()) {
        endGuestSession();
        // Best-effort — see endGuestSessionOnServer's doc comment.
        // Closes the up-to-60s window between local expiry and the
        // server's own periodic sweep, during which device
        // recognition could otherwise still resume this same guest.
        void endGuestSessionOnServer().catch(() => {});
        resetChat();
        // disconnectAllContexts (not bare disconnectRealtime) — see its
        // doc comment. This is what makes background's separate
        // connection actually notice the session ended, instead of
        // continuing to report this identity as online indefinitely.
        disconnectAllContexts();
        setScreen("guest-expired");
        return;
      }
      setScreen("workspace");
      return;
    }

    // Local profile state says onboarding is still needed — but device
    // recognition (Phase 1 of session management) covers ONE concrete
    // case local storage alone can't: THIS device already has an
    // active, non-expired guest session server-side (started, say, by
    // a different extension context, or after a partial local reset)
    // that local state simply doesn't know about yet. Silently resume
    // it rather than send the person through onboarding again for a
    // session that's still genuinely running.
    //
    // Deliberately NOT attempted for registered accounts here: the
    // recognition endpoint never returns a bearer token (see its doc
    // comment) — without the actual sessionToken there's nothing valid
    // to authenticate with, so there's no safe way to silently restore
    // a registered account whose local session token is genuinely
    // gone. That's a real re-auth, not a recognition problem.
    let cancelled = false;
    void recognizeDevice().then((result) => {
      if (cancelled || !result.ok || !result.session) return;
      if (result.session.sessionType !== "guest" || !result.session.guestUsername) return;
      if (new Date(result.session.expiresAt) <= new Date()) return;

      restoreRecognizedGuest({
        username: result.session.guestUsername,
        expiresAt: new Date(result.session.expiresAt).getTime(),
      });
      setScreen("workspace");
    });

    return () => {
      cancelled = true;
    };
  }, [
    hasHydrated,
    isComplete,
    isGuestSessionExpired,
    endGuestSession,
    restoreRecognizedGuest,
    resetChat,
    setScreen,
  ]);

  // Avoid a welcome-screen flash while browser.storage loads.
  if (!hasHydrated) {
    return null;
  }

  switch (screen) {
    case "welcome":
      return <WelcomeScreen />;

    case "signin":
      return <SignInScreen />;

    case "register":
      return <RegisterScreen />;

    case "profile":
      return <ProfileScreen />;

    case "done":
      return <DoneScreen />;

    case "setup":
      return <SetupScreen />;

    case "guest-setup":
      return <GuestSetupScreen />;

    case "guest-expired":
      return <GuestExpiredScreen />;

    case "workspace":
      return <WorkspaceScreen />;

    default:
      return <WelcomeScreen />;
  }
}

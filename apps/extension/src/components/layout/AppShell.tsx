import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

/** Running as a standalone window (opened from the pill) rather than
 *  the toolbar popup — fill the window instead of the popup's fixed
 *  380x600 box, which otherwise leaves dead space around the app. */
const isStandaloneWindow =
  typeof window !== "undefined" &&
  window.location.search.includes("window=1");

export default function AppShell({ children }: AppShellProps) {
  return (
    <main
      className={
        isStandaloneWindow
          ? "flex h-dvh w-full flex-col overflow-hidden bg-white text-slate-900"
          : "flex h-[600px] w-[380px] flex-col overflow-hidden rounded-xl bg-white text-slate-900"
      }
    >
      {children}
    </main>
  );
}

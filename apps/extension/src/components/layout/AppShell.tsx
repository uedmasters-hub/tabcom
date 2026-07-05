import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <main className="flex h-[600px] w-[380px] flex-col overflow-hidden rounded-xl bg-white text-slate-900">
      {children}
    </main>
  );
}
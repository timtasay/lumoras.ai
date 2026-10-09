"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { markAllNotificationsRead } from "@/app/(app)/actions";
import { AppShell, type ShellData } from "./AppShell";

/** The real shell: sign-out and "stop impersonating" go through Better Auth's client, then a fresh server render. */
export function LiveShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const router = useRouter();
  return (
    <AppShell
      data={data}
      actions={{
        signOut: async () => {
          await authClient.signOut();
          router.replace("/sign-in");
          router.refresh();
        },
        stopImpersonating: async () => {
          await authClient.admin.stopImpersonating();
          router.replace("/agency");
          router.refresh();
        },
        markNotificationsRead: async () => {
          await markAllNotificationsRead();
        },
      }}
    >
      {children}
    </AppShell>
  );
}

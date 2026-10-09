import { requireViewer } from "@/lib/auth/app";

/** Onboarding: signed in, but outside the app shell (the field and the steps get the whole screen). */
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  await requireViewer("/onboarding");
  return children;
}

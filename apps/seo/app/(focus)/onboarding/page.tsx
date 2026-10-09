import type { Metadata } from "next";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { WorkspaceForm } from "./WorkspaceForm";

export const metadata: Metadata = { title: "New workspace" };

export default function NewWorkspacePage() {
  return (
    <OnboardingFrame step="workspace" reached="workspace" title="Name the workspace" lede="A workspace is one client business: its people, its sites and everything written for them. Nobody outside it can see it.">
      <WorkspaceForm />
    </OnboardingFrame>
  );
}

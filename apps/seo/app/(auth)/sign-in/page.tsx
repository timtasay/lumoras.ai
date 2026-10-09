import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthStage } from "@/components/auth/AuthStage";
import { SignInPanel } from "@/components/auth/SignInPanel";
import { Icon } from "@/components/Icons";
import { getViewer } from "@/lib/auth/app";
import { webEnv } from "@/lib/config";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getViewer()) redirect(next);
  return (
    <main id="main" tabIndex={-1}>
      <AuthStage
        aside={
          <div className="stage-copy">
            <p className="eyebrow">
              <b>Lumoras Growth</b> · client workspaces
            </p>
            <p className="stage-head">Every client site, one control room.</p>
            <ul className="stage-points">
              <li>
                <Icon name="radar" /> Route inventory crawled from each site&apos;s sitemap
              </li>
              <li>
                <Icon name="shield" /> Each workspace sealed off from every other at the database
              </li>
              <li>
                <Icon name="history" /> Every change recorded: who, what, when, before and after
              </li>
            </ul>
          </div>
        }
      >
        <SignInPanel next={next} googleEnabled={!!webEnv().google} error={sp.error} invitedEmail={typeof sp.email === "string" ? sp.email.slice(0, 254) : undefined} />
      </AuthStage>
    </main>
  );
}

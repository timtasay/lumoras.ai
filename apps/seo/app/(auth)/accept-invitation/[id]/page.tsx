import type { Metadata } from "next";
import Link from "next/link";
import { AuthStage } from "@/components/auth/AuthStage";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Status";
import { getViewer } from "@/lib/auth/app";
import { ROLE_LABEL, ROLE_SUMMARY } from "@/lib/auth/permissions";
import { pool } from "@/lib/db/pool";
import { isUuid } from "@/lib/db/tenant";
import { getInvitation } from "@/lib/data/workspaces";
import { dateLabel } from "@/lib/ui/time";
import { InvitationActions } from "./InvitationActions";

export const metadata: Metadata = { title: "Invitation" };

export default async function AcceptInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = isUuid(id) ? await getInvitation(pool(), id) : null;
  const viewer = await getViewer();
  const open = inv && inv.status === "pending" && inv.expires_at > new Date();
  const here = `/accept-invitation/${id}`;

  return (
    <main id="main" tabIndex={-1}>
      <AuthStage form={3}>
        {!inv || !open ? (
          <div className="inv">
            <h1 className="stage-title">{inv ? "This invitation is closed" : "Invitation not found"}</h1>
            <p className="muted">
              {inv
                ? inv.status === "accepted"
                  ? "It has already been accepted."
                  : inv.status === "pending"
                    ? "It expired. Ask a workspace owner to send a new one."
                    : `It was ${inv.status}. Ask a workspace owner to send a new one.`
                : "The link may be mistyped, or the invitation was withdrawn."}
            </p>
            <Link href={viewer ? "/" : "/sign-in"} className={buttonClass("secondary")}>
              {viewer ? "Go to your workspaces" : "Sign in"}
            </Link>
          </div>
        ) : (
          <div className="inv">
            <p className="eyebrow">
              <b>Invitation</b> · {inv.workspace_name}
            </p>
            <h1 className="stage-title">Join {inv.workspace_name}</h1>
            <p>
              <strong>{inv.inviter_name || inv.inviter_email}</strong> invited <strong>{inv.email}</strong> as:
            </p>
            <div className="inv-role">
              <Badge tone="ion">{ROLE_LABEL[inv.role]}</Badge>
              <p className="muted small">{ROLE_SUMMARY[inv.role]}</p>
            </div>
            <p className="muted small">Open until {dateLabel(inv.expires_at)}.</p>
            {!viewer ? (
              <Link href={`/sign-in?next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`} className={buttonClass("primary", "lg")}>
                Sign in as {inv.email} to accept
              </Link>
            ) : viewer.user.email.toLowerCase() !== inv.email ? (
              <div className="form-alert" role="alert">
                You are signed in as {viewer.user.email}. This invitation is for {inv.email}: sign out and sign in with that address.
              </div>
            ) : (
              <InvitationActions id={inv.id} workspace={inv.workspace_name} />
            )}
          </div>
        )}
      </AuthStage>
    </main>
  );
}

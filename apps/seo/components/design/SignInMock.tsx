"use client";

import { useState } from "react";
import { AuthStage } from "@/components/auth/AuthStage";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";

/** The sign-in panel on /design: the real stage (components/auth/AuthStage) with an inert form. */
export function SignInMock() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthStage variant="inline">
      {sent ? (
        <div className="signin-sent" role="status">
          <h3 className="stage-title">Check your inbox</h3>
          <p>We sent a sign-in link to you@business.com. It works once, for 15 minutes.</p>
          <Button variant="ghost" size="sm" icon="back" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form
          className="signin-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              setSent(true);
            }, 900);
          }}
        >
          <h3 className="stage-title">Sign in to your workspace</h3>
          <p className="muted">Sample only on this page. The real one is at /sign-in.</p>
          <TextField label="Work email" type="email" name="email" placeholder="you@business.com" autoComplete="email" required />
          <Button type="submit" variant="primary" size="lg" icon="mail" loading={busy}>
            Email me a sign-in link
          </Button>
          <p className="signin-or" aria-hidden="true">
            <span>or</span>
          </p>
          <Button variant="secondary" size="lg" icon="google">
            Continue with Google
          </Button>
          <p className="signin-fine">Session cookies only, httpOnly and secure. No passwords to leak.</p>
        </form>
      )}
    </AuthStage>
  );
}

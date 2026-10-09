"use client";

import { useState } from "react";
import { BrandMark } from "@/components/Icons";
import { FieldBackdrop } from "@/components/FieldBackdrop";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";

/** Sign-in panel mock (Phase 1 wires Better Auth: email magic link and Google). */
export function SignInMock() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <FieldBackdrop form={0} />
      <div className="signin-glass glass">
        <div className="signin-brand">
          <BrandMark size={32} />
          <span>Lumoras Growth</span>
        </div>
        {sent ? (
          <div className="signin-sent" role="status">
            <h3>Check your inbox</h3>
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
            <h3>Sign in to your workspace</h3>
            <p className="muted">Mock only: authentication arrives in Phase 1.</p>
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
      </div>
    </div>
  );
}

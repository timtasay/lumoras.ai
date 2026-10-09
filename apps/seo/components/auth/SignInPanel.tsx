"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Fields";
import { authClient } from "@/lib/auth/client";

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one.",
  INVALID_TOKEN: "That sign-in link has expired or was already used. Send yourself a new one.",
  EXPIRED_TOKEN: "That sign-in link has expired. Send yourself a new one.",
  google: "Google sign-in did not complete. Try again, or use an email link.",
};

/**
 * Sign in with an emailed link (Better Auth magic link) or Google.
 * Google is shown but disabled, with the reason, when the server has no
 * Google OAuth client configured.
 */
export function SignInPanel({ next, googleEnabled, error, invitedEmail }: { next: string; googleEnabled: boolean; error?: string; invitedEmail?: string }) {
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"link" | "google" | null>(null);
  const [problem, setProblem] = useState<string | null>(error ? (ERRORS[error] ?? "Sign-in did not complete. Try again.") : null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  if (sentTo) {
    return (
      <div className="signin-sent" role="status">
        <h1 className="stage-title">Check your inbox</h1>
        <p>
          We sent a sign-in link to <strong>{sentTo}</strong>. It works once, for 15 minutes.
        </p>
        <Button variant="ghost" size="sm" icon="back" onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form
      className="signin-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const value = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          setFieldError("Enter the email address you use for work");
          return;
        }
        setFieldError(undefined);
        setProblem(null);
        setBusy("link");
        const { error: err } = await authClient.signIn.magicLink({ email: value, callbackURL: next, newUserCallbackURL: next, errorCallbackURL: "/sign-in?error=link" });
        setBusy(null);
        if (err) setProblem(err.status === 429 ? "Too many sign-in links were requested. Wait a few minutes and try again." : (err.message ?? "We could not send the link. Try again."));
        else setSentTo(value);
      }}
    >
      <h1 className="stage-title">Sign in to your workspace</h1>
      <p className="muted">No password: we email you a link that signs you in.</p>
      {problem ? (
        <p className="form-alert" role="alert">
          {problem}
        </p>
      ) : null}
      <TextField
        label="Work email"
        type="email"
        name="email"
        placeholder="you@business.com"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
      />
      <Button type="submit" variant="primary" size="lg" icon="mail" loading={busy === "link"} disabled={busy === "google"}>
        Email me a sign-in link
      </Button>
      <p className="signin-or" aria-hidden="true">
        <span>or</span>
      </p>
      <Button
        variant="secondary"
        size="lg"
        icon="google"
        loading={busy === "google"}
        disabled={!googleEnabled || busy === "link"}
        aria-describedby={googleEnabled ? undefined : "google-off"}
        onClick={async () => {
          setBusy("google");
          const { error: err } = await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: "/sign-in?error=google" });
          if (err) {
            setBusy(null);
            setProblem(err.message ?? ERRORS.google);
          }
        }}
      >
        Continue with Google
      </Button>
      {googleEnabled ? null : (
        <p className="signin-fine" id="google-off">
          Google sign-in is not set up on this server yet. Use an email link.
        </p>
      )}
      <p className="signin-fine">Session cookies only, httpOnly and secure. No passwords to leak.</p>
    </form>
  );
}

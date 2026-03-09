"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setError(null);
  }, [step]);

  return (
    <div className="max-w-md px-6 py-10">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-white/70">
        Enter your Jamieson email. We’ll send a one-time code.
      </p>

      {error ? (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {step === "email" ? (
        <div className="mt-6 space-y-3">
          <label className="block">
            <div className="text-xs text-white/70">Email</div>
            <input
              className="mt-1 h-10 w-full rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@jamieson.com.au"
              autoComplete="email"
            />
          </label>

          <button
            className="jam-btn jam-btn-primary h-10 w-full"
            type="button"
            disabled={sending}
            onClick={async () => {
              const e = email.trim().toLowerCase();
              if (!e) return setError("Enter your email.");
              if (!e.endsWith("@jamieson.com.au")) {
                return setError("Use your @jamieson.com.au email.");
              }

              setSending(true);
              setError(null);
              try {
                // Verify allowlist before sending OTP
                const chk = await fetch(`/api/auth/allowed?email=${encodeURIComponent(e)}`);
                if (!chk.ok) {
                  const data = (await chk.json().catch(() => null)) as { error?: string } | null;
                  throw new Error(data?.error || "You are not authorised.");
                }

                const { error } = await sb.auth.signInWithOtp({
                  email: e,
                  options: {
                    // Allow creation, but only after allowlist check above.
                    // This avoids Supabase "Signups not allowed" while still enforcing preregistration.
                    shouldCreateUser: true,
                  },
                });
                if (error) throw error;
                setStep("code");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Sign-in failed.");
              } finally {
                setSending(false);
              }
            }}
          >
            {sending ? "Sending…" : "Send code"}
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <div className="text-sm text-white/70">Code sent to {email.trim().toLowerCase()}</div>

          <label className="block">
            <div className="text-xs text-white/70">One-time code</div>
            <input
              className="mt-1 h-10 w-full rounded border border-white/15 bg-black/20 px-3 text-sm outline-none"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              autoComplete="one-time-code"
            />
          </label>

          <button
            className="jam-btn jam-btn-primary h-10 w-full"
            type="button"
            disabled={verifying}
            onClick={async () => {
              const e = email.trim().toLowerCase();
              const c = code.trim();
              if (!c) return setError("Enter the code.");

              setVerifying(true);
              setError(null);
              try {
                const chk = await fetch(`/api/auth/allowed?email=${encodeURIComponent(e)}`);
                if (!chk.ok) {
                  const data = (await chk.json().catch(() => null)) as { error?: string } | null;
                  throw new Error(data?.error || "You are not authorised.");
                }

                const { error } = await sb.auth.verifyOtp({
                  email: e,
                  token: c,
                  type: "email",
                });
                if (error) throw error;
                // middleware will redirect to /
                window.location.href = "/";
              } catch (err) {
                setError(err instanceof Error ? err.message : "Verify failed.");
              } finally {
                setVerifying(false);
              }
            }}
          >
            {verifying ? "Signing in…" : "Sign in"}
          </button>

          <button
            className="jam-btn h-10 w-full"
            type="button"
            onClick={() => {
              setCode("");
              setStep("email");
            }}
          >
            Use different email
          </button>
        </div>
      )}
    </div>
  );
}

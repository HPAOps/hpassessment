import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, KeyRound, CheckCircle2, AlertTriangle } from "lucide-react";
import { HpaLogo } from "@/components/common/Logo";
import { supabase } from "@/lib/supabase";
import { updateMyPassword } from "@/lib/api";
import { toast } from "sonner";

// Landing page that Supabase's password-reset email links to.
// When the user clicks the email link, Supabase puts a recovery
// session into the URL hash; supabase-js auto-detects it and
// signs the user in to that short-lived session. We then let them
// set a new password via supabase.auth.updateUser({ password }).
export default function StaffResetPassword() {
  const [hasRecoverySession, setHasRecoverySession] = useState(null); // null=loading, true=recovery session, false=invalid
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    let timer = null;
    // The ONLY signal that this is a recovery session is the PASSWORD_RECOVERY
    // event from supabase-js as it parses the URL hash. We do NOT trust a
    // pre-existing session — that could be a normal logged-in admin who
    // happened to navigate here, and we must not let them accidentally
    // overwrite their own password.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return;
      if (event === "PASSWORD_RECOVERY") {
        setHasRecoverySession(true);
        if (timer) { clearTimeout(timer); timer = null; }
      }
    });
    // If we never hear PASSWORD_RECOVERY within 1.5s, treat this as an
    // invalid / expired link.
    timer = setTimeout(() => {
      if (!alive) return;
      setHasRecoverySession(prev => prev === null ? false : prev);
    }, 1500);
    return () => { alive = false; sub?.subscription?.unsubscribe?.(); if (timer) clearTimeout(timer); };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await updateMyPassword(password);
      // Sign them back out so they have to authenticate fresh with the new password.
      await supabase.auth.signOut().catch(() => {});
      setDone(true);
    } catch (err) {
      toast.error(err?.message || "Couldn't update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex items-center justify-center bg-black p-12 relative overflow-hidden">
        <img
          src="/hpa-logo.png"
          alt="HPA Educational Services"
          className="w-[min(78%,560px)] h-auto object-contain drop-shadow-2xl select-none"
          draggable={false}
        />
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md border-border" data-testid="reset-password-card">
          <CardContent className="p-8 lg:p-10">
            <Link to="/" className="lg:hidden block mb-6"><HpaLogo showText /></Link>
            <div className="overline inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Password reset</div>

            {hasRecoverySession === null && (
              <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            )}

            {hasRecoverySession === false && (
              <>
                <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Link expired or invalid</h1>
                <div className="mt-6 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>This password reset link is no longer valid. Reset links expire after about an hour. Request a new one and try again.</div>
                </div>
                <Button
                  variant="outline"
                  className="w-full h-11 mt-6"
                  onClick={() => nav("/staff/forgot-password")}
                  data-testid="reset-request-new"
                >
                  Request a new link
                </Button>
              </>
            )}

            {hasRecoverySession === true && !done && (
              <>
                <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight">Set a new password</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  Choose a strong password — at least 8 characters.
                </p>
                <form onSubmit={onSubmit} className="mt-8 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      required
                      autoFocus
                      minLength={8}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="h-11"
                      data-testid="reset-new-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      required
                      minLength={8}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      className="h-11"
                      data-testid="reset-confirm-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={saving || password.length < 8 || password !== confirm}
                    className="w-full h-11"
                    data-testid="reset-submit"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Update password
                  </Button>
                </form>
              </>
            )}

            {done && (
              <>
                <div className="mt-6 flex items-start gap-3 rounded-lg border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-4">
                  <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))] shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium">Password updated</div>
                    <div className="text-muted-foreground mt-1">You can now sign in with your new password.</div>
                  </div>
                </div>
                <Button className="w-full h-11 mt-6" onClick={() => nav("/staff/login")} data-testid="reset-back-to-login">
                  Go to sign in
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Mail, CheckCircle2, ShieldCheck, ArrowLeft } from "lucide-react";
import { HpaLogo } from "@/components/common/Logo";
import { sendPasswordResetEmail } from "@/lib/api";
import { toast } from "sonner";

// "Forgot password?" entry point. Sends a reset email to the user.
//
// Only works for users that already have an entry in Supabase auth.users
// (anyone who has signed in via SSO or password at least once). Users who
// have NEVER signed in must do the first SSO sign-in to create the auth
// record, then can reset their password from there.
export default function StaffForgotPassword() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await sendPasswordResetEmail(email.trim());
      setSent(true);
    } catch (err) {
      toast.error(err?.message || "Couldn't send reset email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="hidden lg:flex items-center justify-center bg-black p-12 relative overflow-hidden">
        <img
          src="/hpa-logo.png"
          alt="HPA Educational Services"
          className="w-[min(78%,560px)] h-auto object-contain drop-shadow-2xl select-none"
          draggable={false}
        />
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md border-border" data-testid="forgot-password-card">
          <CardContent className="p-8 lg:p-10">
            <Link to="/" className="lg:hidden block mb-6"><HpaLogo showText /></Link>
            <div className="overline inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Password reset</div>

            {sent ? (
              <>
                <div className="mt-6 flex items-start gap-3 rounded-lg border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-4">
                  <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))] shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium">Email sent</div>
                    <div className="text-muted-foreground mt-1">
                      If <span className="font-mono">{email}</span> is on the staff list, you'll receive a link to set a new password within a minute.
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full h-11 mt-6"
                  onClick={() => nav("/staff/login")}
                  data-testid="forgot-back-to-login"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </Button>
              </>
            ) : (
              <>
                <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight">Forgot your password?</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  Enter your staff email and we'll send you a link to set a new password.
                </p>

                <form onSubmit={onSubmit} className="mt-8 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      autoFocus
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="h-11"
                      placeholder="you@highlandprepaz.org"
                      data-testid="forgot-email-input"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={sending || !email.trim()}
                    className="w-full h-11"
                    data-testid="forgot-submit"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    Send reset link
                  </Button>
                </form>

                <Link to="/staff/login" className="mt-6 block text-center text-xs text-muted-foreground hover:text-foreground" data-testid="forgot-cancel-link">
                  ← Back to sign in
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hydrateStaffSessionFromSupabase } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { HpaLogo } from "@/components/common/Logo";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function StaffOAuthCallback() {
  const nav = useNavigate();
  const { refreshStaff } = useAuth();
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Give Supabase a tick to finish the URL exchange
        await new Promise(r => setTimeout(r, 500));
        const session = await hydrateStaffSessionFromSupabase();
        if (cancelled) return;
        if (session) {
          if (refreshStaff) refreshStaff(session);
          nav("/admin/dashboard", { replace: true });
        } else {
          setErr("We couldn't read your Microsoft session. Please try signing in again.");
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "Sign-in failed.");
      }
    })();
    return () => { cancelled = true; };
  }, [nav, refreshStaff]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full border-border">
        <CardContent className="p-8 text-center space-y-4">
          <div className="flex justify-center"><HpaLogo showText /></div>
          {!err ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Completing Microsoft sign-in…</div>
            </>
          ) : (
            <>
              <AlertTriangle className="h-8 w-8 mx-auto text-[hsl(var(--destructive))]" />
              <div className="font-display text-lg font-semibold">Sign-in blocked</div>
              <div className="text-sm text-muted-foreground">{err}</div>
              <Button onClick={() => nav("/staff/login", { replace: true })} data-testid="back-to-login">Back to sign-in</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

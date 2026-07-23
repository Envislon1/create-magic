import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password · Mind Buddy" },
      { name: "description", content: "Choose a new password for your Mind Buddy account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    // Supabase places the recovery token in the URL hash; supabase-js
    // detects it automatically and fires PASSWORD_RECOVERY.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setHasRecoverySession(true);
    });
    // Also handle the case where the session is already established by the time
    // this page mounts (e.g., after a hard refresh on a recovery link).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasRecoverySession(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters.");
    if (password !== confirm) return toast.error("Passwords don't match.");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You're signed in.");
      navigate({ to: "/app" });
    } catch (err: any) {
      toast.error(err.message || "Could not update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 shadow-soft border-border/60">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-safe flex items-center justify-center shadow-safe mb-3">
            <Shield className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold">Set a new password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasRecoverySession ? "Choose a password you'll remember." : "Open this page from the reset link in your email."}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw">New password</Label>
            <div className="relative">
              <Input
                id="pw"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2">Confirm password</Label>
            <Input
              id="pw2"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !hasRecoverySession}>
            {loading ? "Updating…" : "Update password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

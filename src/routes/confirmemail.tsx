import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/confirmemail")({
  head: () => ({
    meta: [
      { title: "Email confirmed · Mind Buddy" },
      { name: "description", content: "Your Mind Buddy email is confirmed." },
    ],
  }),
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setHasSession(!!s);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    const id = window.setTimeout(() => navigate({ to: "/app" }), 1500);
    return () => window.clearTimeout(id);
  }, [hasSession, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 text-center shadow-soft border-border/60">
        <div className="w-14 h-14 rounded-2xl bg-gradient-safe flex items-center justify-center shadow-safe mx-auto mb-3">
          <Shield className="text-white" />
        </div>
        <h1 className="text-2xl font-semibold mb-2 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-primary" /> Email confirmed
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {hasSession
            ? "Taking you to your Mind Buddy dashboard…"
            : "Your email is confirmed. Sign in to continue."}
        </p>
        <Button className="w-full" onClick={() => navigate({ to: hasSession ? "/app" : "/auth" })}>
          {hasSession ? "Open Mind Buddy" : "Sign in"}
        </Button>
      </Card>
    </div>
  );
}
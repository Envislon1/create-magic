import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Shield, LogOut } from "lucide-react";
import { PatientDashboard } from "@/components/guardian/PatientDashboard";
import { CaregiverDashboard } from "@/components/guardian/CaregiverDashboard";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Dashboard · Mind Buddy" },
      { name: "description", content: "Mind Buddy — SOS alerts, medication reminders, and live care chat." },
    ],
  }),
  component: AppPage,
});

function AppPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<"patient" | "caregiver" | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
    // Admin shortcut: redirect the single admin email to /admin.
    if (user && ["wuf.tech@gmail.com", "wuf.device@gmail.com"].includes((user.email || "").toLowerCase())) {
      navigate({ to: "/admin" });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // 1) Authoritative: user_roles table (server-managed)
      const { data } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const roles = ((data as any[]) ?? []).map((r) => r.role as string);
      let resolved: "patient" | "caregiver" | null = roles.includes("caregiver")
        ? "caregiver"
        : roles.includes("patient")
          ? "patient"
          : null;

      // 2) Fallback: signup metadata (older accounts before user_roles existed)
      if (!resolved) {
        const meta = (user.user_metadata as any) || {};
        if (meta.role === "caregiver" || meta.role === "patient") {
          resolved = meta.role;
          // Backfill so subsequent logins are authoritative.
          await (supabase as any)
            .from("user_roles")
            .insert({ user_id: user.id, role: resolved })
            .then(() => {}, () => {});
        }
      }

      setRole(resolved ?? "patient");
      setRoleLoading(false);
    })();
  }, [user]);

  if (loading || !user || roleLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border/60">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-gradient-safe shadow-safe flex items-center justify-center shrink-0">
              <Shield className="w-6 h-6 text-white drop-shadow" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold leading-tight">Mind Buddy</div>
              <div className="text-xs text-muted-foreground capitalize truncate">
                {role} · {user.email}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>
      {role === "caregiver" ? <CaregiverDashboard user={user} /> : <PatientDashboard user={user} />}
    </div>
  );
}

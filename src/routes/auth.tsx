import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield, Heart, UserRound, Eye, EyeOff } from "lucide-react";
import { authRedirectUrl } from "@/lib/app-config";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Mind Buddy" },
      { name: "description", content: "Sign in to your Mind Buddy account." },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<"patient" | "caregiver">("patient");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/app" });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: authRedirectUrl("/confirmemail"),
            data: { display_name: name, role },
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectUrl("/forgotpassword"),
        });
        if (error) throw error;
        toast.success("Password reset link sent. Check your email.");
        setMode("signin");
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 shadow-soft border-border/60">
        <div className="flex flex-col items-center mb-6">
          <Link to="/" className="w-14 h-14 rounded-2xl bg-gradient-safe flex items-center justify-center shadow-safe mb-3">
            <Shield className="text-white" />
          </Link>
          <h1 className="text-2xl font-semibold">Mind Buddy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" && "Welcome back"}
            {mode === "signup" && "Create your account"}
            {mode === "forgot" && "Reset your password"}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div className="space-y-2">
                <Label>I am a…</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole("patient")}
                    className={`rounded-lg border p-3 text-left transition ${
                      role === "patient" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                    }`}
                  >
                    <Heart className="w-4 h-4 mb-1 text-primary" />
                    <div className="font-medium text-sm">Patient</div>
                    <div className="text-xs text-muted-foreground">I use the device</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("caregiver")}
                    className={`rounded-lg border p-3 text-left transition ${
                      role === "caregiver" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                    }`}
                  >
                    <UserRound className="w-4 h-4 mb-1 text-primary" />
                    <div className="font-medium text-sm">Caregiver</div>
                    <div className="text-xs text-muted-foreground">I support a patient</div>
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {mode !== "forgot" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot your password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm text-muted-foreground space-y-1">
          {mode === "signin" && (
            <button type="button" onClick={() => setMode("signup")} className="hover:text-foreground">
              Need an account? Sign up
            </button>
          )}
          {mode === "signup" && (
            <button type="button" onClick={() => setMode("signin")} className="hover:text-foreground">
              Already have an account? Sign in
            </button>
          )}
          {mode === "forgot" && (
            <button type="button" onClick={() => setMode("signin")} className="hover:text-foreground">
              Back to sign in
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

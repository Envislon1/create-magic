import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Shield, AlertTriangle, MessageCircle, Sparkles } from "lucide-react";
import { showSosNotification, showMedicationNotification } from "@/lib/notifications";
import { useMedicationChime } from "@/hooks/use-medication-chime";
// Patient SOS doesn't ring locally (the device handles audio + comforting voice).
// Medication uses the soft 3-note bell chime, distinct from the SOS siren.
import { HardwareStatus } from "./HardwareStatus";
import { ChatPanel } from "./ChatPanel";
import { MoodCheckIn } from "./MoodCheckIn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";


type SosEvent = { id: string; source: string; status: string; note: string | null; created_at: string };
type Med = { id: string; label: string; hour: number; minute: number; enabled: boolean };
type Device = {
  id: string;
  pairing_code: string;
  current_mode: string | null;
  last_seen_at: string | null;
  firmware_version?: string | null;
  ota_url?: string | null;
  ota_version?: string | null;
  ota_requested_at?: string | null;
  ota_consumed_at?: string | null;
  ota_progress?: number | null;
  ota_status?: string | null;
};

export function PatientDashboard({ user }: { user: User }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [meds, setMeds] = useState<Med[]>([]);
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [caregiver, setCaregiver] = useState<{ id: string; display_name: string | null } | null>(null);
  const [chatOpen, setChatOpen] = useState<"guardian_ai" | "care" | null>(null);
  const medChime = useMedicationChime();

  // Reload caregiver whenever the user opens the care chat, so a freshly
  // added caregiver shows up without a full page refresh.
  useEffect(() => {
    if (chatOpen === "care") void loadCaregiver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  const soundEnabled = (device as any)?.sound_enabled ?? true;
  const preferredVoice = (device as any)?.preferred_voice ?? "female";
  const speakerVolume = (device as any)?.speaker_volume ?? 70;

  useEffect(() => {
    void loadAll();
    const ch = supabase
      .channel(`patient-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sos_events", filter: `user_id=eq.${user.id}` },
        (p) => {
          const ev = p.new as SosEvent;
          setEvents((prev) => [ev, ...prev]);
          toast.error("🚨 SOS triggered", { description: ev.note || "Emergency from your device" });
          void showSosNotification(ev.note || "Emergency triggered from your Mind Buddy device.", ev.id);
          // No audible alarm on the patient's own dashboard — the device
          // itself buzzes and speaks the comforting voice. Caregiver
          // dashboards still ring so they're alerted remotely.
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sos_events", filter: `user_id=eq.${user.id}` },
        (p) => {
          const ev = p.new as SosEvent;
          setEvents((prev) => prev.map((e) => (e.id === ev.id ? ev : e)));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `user_id=eq.${user.id}` },
        (p) => {
          // Only overwrite when realtime gives us a real row. Empty payloads
          // (e.g. DELETE events) must NOT wipe the cached mode/pairing code.
          const next = p.new as Device | undefined;
          if (next && next.id) setDevice((prev) => ({ ...(prev ?? {}), ...next }));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "medication_schedules", filter: `user_id=eq.${user.id}` },
        () => void loadMeds(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caregiver_links", filter: `patient_id=eq.${user.id}` },
        () => void loadCaregiver(),
      )
      .subscribe();

    // Light poll so the "Live" badge reflects last_seen_at without a row update,
    // and re-fetch the device row from the DB so cached mode/pairing/OTA
    // state stays visible even when the hardware is offline.
    const tick = setInterval(() => {
      setDevice((d) => (d ? { ...d } : d));
      void refreshDevice();
    }, 30_000);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function refreshDevice() {
    const { data } = await supabase
      .from("devices")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    const dev = data?.[0];
    if (dev) setDevice((prev) => ({ ...(prev ?? {}), ...(dev as Device) }));
  }

  async function loadAll() {
    const [{ data: devRows }, { data: ev }] = await Promise.all([
      supabase
        .from("devices")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1),
      supabase.from("sos_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    ]);
    const dev = (devRows && devRows[0]) || null;
    setDevice((dev as Device) || null);
    setEvents((ev || []) as SosEvent[]);
    await loadMeds();
    await loadCaregiver();

    if (!dev) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const { data: created, error: insErr } = await supabase
        .from("devices")
        .insert({ user_id: user.id, pairing_code: code })
        .select()
        .single();
      if (insErr) {
        const { data: again } = await supabase
          .from("devices")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true })
          .limit(1);
        if (again && again[0]) setDevice(again[0] as Device);
      } else if (created) {
        setDevice(created as Device);
      }
    }
  }

  async function loadCaregiver() {
    const { data: links } = await supabase
      .from("caregiver_links")
      .select("caregiver_id")
      .eq("patient_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    const link = links?.[0];
    if (!link?.caregiver_id) {
      setCaregiver(null);
      return;
    }
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", link.caregiver_id)
      .maybeSingle();
    setCaregiver((prof as any) || { id: link.caregiver_id, display_name: null });
  }

  async function loadMeds() {
    const { data } = await supabase
      .from("medication_schedules")
      .select("*")
      .eq("user_id", user.id)
      .order("hour");
    setMeds((data || []) as Med[]);
  }

  // Medication alarm watcher: every 20s, if local time matches an enabled
  // schedule (HH:MM), ring + vibrate + push a sticky notification. We
  // debounce per (date, schedule) so each med only fires once per day.
  useEffect(() => {
    const firedKey = "mindbuddy:med-fired";
    const tick = () => {
      const now = new Date();
      const hh = now.getHours();
      const mm = now.getMinutes();
      const today = now.toISOString().slice(0, 10);
      let fired: Record<string, string> = {};
      try {
        fired = JSON.parse(localStorage.getItem(firedKey) || "{}");
      } catch {}
      for (const med of meds) {
        if (!med.enabled) continue;
        if (med.hour !== hh || med.minute !== mm) continue;
        if (fired[med.id] === today) continue;
        fired[med.id] = today;
        localStorage.setItem(firedKey, JSON.stringify(fired));
        toast.info("💊 Medication reminder", {
          description: med.label,
          duration: 60_000,
          action: { label: "Dismiss", onClick: () => medChime.stop() },
        });
        void showMedicationNotification(med.label, `med-${med.id}-${today}`);
        // Soft 3-note bell pattern (C6-E6-G6) — clearly distinct from the
        // SOS siren so users can tell what alert just fired without looking.
        medChime.play({
          durationMs: 60_000,
          enabled: soundEnabled,
          volume: speakerVolume,
        });
      }
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meds, soundEnabled, speakerVolume]);

  const activeSos = useMemo(() => events.find((e) => e.status === "active"), [events]);
  const isSos = !!activeSos;

  // SOS is read-only in the web app — control happens on the Mind Buddy device.


  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5 pb-12">
      {/* SOS — display-only. SOS is triggered and resolved from the Mind Buddy device. */}
      <Card className="p-6 text-center">
        <h2 className="text-xs font-medium text-muted-foreground tracking-wider mb-4">
          {isSos ? "EMERGENCY ACTIVE" : "YOU'RE SAFE"}
        </h2>
        {isSos ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-sos">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">SOS Active</span>
            </div>
            <p className="text-sm text-muted-foreground">{activeSos!.note}</p>
            <div className="mx-auto w-40 h-40 rounded-full bg-gradient-sos text-white font-bold text-2xl tracking-wider flex items-center justify-center shadow-sos animate-pulse-sos drop-shadow">
              SOS
            </div>
            <p className="text-xs text-muted-foreground">Resolve the alert from the Mind Buddy device.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="mx-auto w-40 h-40 rounded-full bg-gradient-safe text-white font-bold text-2xl tracking-wider flex items-center justify-center shadow-safe drop-shadow">
              <div className="flex flex-col items-center gap-1">
                <Shield className="w-8 h-8" />
                <span>SAFE</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              SOS is controlled from the Mind Buddy device. This panel mirrors its status.
            </p>
          </div>
        )}
      </Card>


      {/* Hardware status (read-only) */}
      <HardwareStatus
        pairingCode={device?.pairing_code ?? null}
        mode={device?.current_mode ?? null}
        meds={meds}
        lastSeenAt={device?.last_seen_at ?? null}
        deviceId={device?.id ?? null}
        patientUserId={user.id}
        firmwareVersion={device?.firmware_version ?? null}
        otaUrl={device?.ota_url ?? null}
        otaVersion={device?.ota_version ?? null}
        otaRequestedAt={device?.ota_requested_at ?? null}
        otaConsumedAt={device?.ota_consumed_at ?? null}
        otaProgress={device?.ota_progress ?? 0}
        otaStatus={device?.ota_status ?? "idle"}
        soundEnabled={soundEnabled}
        preferredVoice={preferredVoice}
        speakerVolume={speakerVolume}
        canManage
      />

      <MoodCheckIn userId={user.id} />


      {/* Chat launchers */}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" className="h-16 justify-start" onClick={() => setChatOpen("guardian_ai")}>
          <Sparkles className="w-4 h-4 mr-2" /> Mind Buddy AI
        </Button>
        <Button variant="outline" className="h-16 justify-start" onClick={() => setChatOpen("care")}>
          <MessageCircle className="w-4 h-4 mr-2" /> Caregiver
        </Button>
      </div>

      {/* History */}
      <Card className="p-5">
        <h3 className="font-medium mb-3">Recent SOS history</h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.slice(0, 2).map((e) => (
              <li key={e.id} className="flex items-center justify-between border-b border-border/40 last:border-0 pb-2">
                <div>
                  <div className="font-medium">
                    {e.status === "active" ? "🚨 Active" : "✓ Resolved"} · {e.source}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={chatOpen !== null} onOpenChange={(open) => !open && setChatOpen(null)}>
        <DialogContent className="max-w-none w-screen h-screen translate-x-[-50%] translate-y-[-50%] border-0 rounded-none p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{chatOpen === "care" ? "Caregiver messages" : "Mind Buddy AI"}</DialogTitle>
            <DialogDescription>{chatOpen === "care" ? "Private chat with your caregiver." : "Private supportive conversation."}</DialogDescription>
          </DialogHeader>
          {chatOpen === "guardian_ai" && (
            <ChatPanel
              userId={user.id}
              conversation="guardian_ai"
              mode={device?.current_mode ?? undefined}
              fullScreen
              soundEnabled={soundEnabled}
              preferredVoice={preferredVoice}
              speakerVolume={speakerVolume}
            />
          )}
          {chatOpen === "care" && caregiver && (
            <ChatPanel userId={user.id} conversation="care" peerId={caregiver.id} peerName={caregiver.display_name || "Caregiver"} fullScreen />
          )}
          {chatOpen === "care" && !caregiver && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No caregiver linked yet. Share your pairing code <span className="font-mono text-foreground">{device?.pairing_code || "—"}</span>.
            </Card>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { findDeviceForPairing } from "@/lib/devices.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link2, AlertTriangle, CheckCircle2, UserRound, MessageCircle } from "lucide-react";
import { showSosNotification } from "@/lib/notifications";
import { useAlarmRingtone } from "@/hooks/use-alarm-ringtone";
import { HardwareStatus } from "./HardwareStatus";
import { MoodChart } from "./MoodChart";
import { ChatPanel } from "./ChatPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Patient = {
  id: string;
  display_name: string | null;
};

type Device = {
  id: string;
  pairing_code: string;
  current_mode: string | null;
  last_seen_at: string | null;
  user_id: string;
  firmware_version?: string | null;
  ota_url?: string | null;
  ota_version?: string | null;
  ota_requested_at?: string | null;
  ota_consumed_at?: string | null;
  ota_progress?: number | null;
  ota_status?: string | null;
  sound_enabled?: boolean | null;
  preferred_voice?: string | null;
  speaker_volume?: number | null;
};

type SosEvent = { id: string; user_id: string; status: string; note: string | null; created_at: string; source: string };
type Med = { id: string; user_id: string; label: string; hour: number; minute: number; enabled: boolean };

export function CaregiverDashboard({ user }: { user: User }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [meds, setMeds] = useState<Med[]>([]);
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [pairCode, setPairCode] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const lookupDevice = useServerFn(findDeviceForPairing);
  const ringtone = useAlarmRingtone();

  useEffect(() => {
    void loadPatients();
  }, []);

  useEffect(() => {
    if (!activePatientId) return;
    void loadPatientData(activePatientId);
    const ch = supabase
      .channel(`caregiver-${activePatientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sos_events", filter: `user_id=eq.${activePatientId}` },
        (p) => {
          const ev = p.new as SosEvent;
          setEvents((prev) => [ev, ...prev]);
          toast.error("🚨 SOS from patient", { description: ev.note || "Emergency triggered" });
          void showSosNotification(ev.note || "Your patient triggered an SOS.", ev.id);
          ringtone.play(30_000);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sos_events", filter: `user_id=eq.${activePatientId}` },
        (p) => {
          const ev = p.new as SosEvent;
          setEvents((prev) => prev.map((e) => (e.id === ev.id ? ev : e)));
          if (ev.status === "resolved") ringtone.stop();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `user_id=eq.${activePatientId}` },
        (p) => {
          const next = p.new as Device | undefined;
          if (next && next.id) setDevice((prev) => ({ ...(prev ?? ({} as Device)), ...next }));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "medication_schedules", filter: `user_id=eq.${activePatientId}` },
        () => void loadMeds(activePatientId),
      )
      .subscribe();
    const tick = setInterval(() => {
      setDevice((d) => (d ? { ...d } : d));
      // Re-fetch so cached mode/pairing/OTA stay visible even when offline.
      void supabase
        .from("devices")
        .select("*")
        .eq("user_id", activePatientId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setDevice((prev) => ({ ...(prev ?? ({} as Device)), ...(data as Device) }));
        });
    }, 30_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(tick);
    };
  }, [activePatientId]);

  async function loadPatients() {
    const { data: links } = await supabase
      .from("caregiver_links")
      .select("patient_id")
      .eq("caregiver_id", user.id);
    const ids = (links || []).map((l) => l.patient_id);
    if (ids.length === 0) {
      setPatients([]);
      setActivePatientId(null);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    setPatients((profs || []) as Patient[]);
    if (!activePatientId && profs && profs.length > 0) setActivePatientId(profs[0].id);
  }

  async function loadPatientData(pid: string) {
    const [{ data: dev }, { data: ev }] = await Promise.all([
      supabase.from("devices").select("*").eq("user_id", pid).maybeSingle(),
      supabase.from("sos_events").select("*").eq("user_id", pid).order("created_at", { ascending: false }).limit(20),
    ]);
    setDevice((dev as Device) || null);
    setEvents((ev || []) as SosEvent[]);
    await loadMeds(pid);
  }
  async function loadMeds(pid: string) {
    const { data } = await supabase.from("medication_schedules").select("*").eq("user_id", pid).order("hour");
    setMeds((data || []) as Med[]);
  }

  async function linkPatient() {
    const code = pairCode.trim().toUpperCase();
    if (!code) return;
    setLinking(true);
    try {
      // RLS blocks direct SELECTs on devices owned by someone else, so we go
      // through a server fn (service role) that only returns id + user_id.
      let dev: { id: string; user_id: string } | null = null;
      try {
        const res = await lookupDevice({ data: { code } });
        dev = res?.device ?? null;
      } catch (e: any) {
        toast.error(`Lookup failed: ${e?.message || e}`);
        return;
      }
      if (!dev) {
        toast.error(`No device found with code "${code}".`);
        return;
      }
      if (dev.user_id === user.id) {
        toast.error("That's your own device.");
        return;
      }
      const { error: linkErr } = await supabase.from("caregiver_links").insert({
        caregiver_id: user.id,
        patient_id: dev.user_id,
        device_id: dev.id,
      });
      if (linkErr) {
        if (linkErr.code === "23505") toast.info("Already linked to this patient.");
        else toast.error(linkErr.message);
      } else {
        toast.success("Patient linked");
        setPairCode("");
        await loadPatients();
        setActivePatientId(dev.user_id);
      }
    } finally {
      setLinking(false);
    }
  }

  // SOS resolution is performed on the patient's Mind Buddy device only —
  // the caregiver dashboard mirrors the status but never clears the alert.


  const activePatient = patients.find((p) => p.id === activePatientId) || null;
  const activeSos = events.find((e) => e.status === "active");

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5 pb-12">
      <Button variant="outline" className="w-full h-12 justify-start" onClick={() => setLinkOpen(true)}>
        <Link2 className="w-4 h-4 mr-2" /> Link a patient
      </Button>

      {/* Patient selector */}
      {patients.length > 0 && (
        <Card className="p-3">
          <div className="flex gap-2 overflow-x-auto">
            {patients.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePatientId(p.id)}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition ${
                  activePatientId === p.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                <UserRound className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                {p.display_name || "Patient"}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!activePatient ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Link a patient using their device pairing code to start monitoring.
        </Card>
      ) : (
        <>
          {/* SOS status for patient */}
          <Card className="p-6 text-center">
            <h2 className="text-xs font-medium text-muted-foreground tracking-wider mb-3">
              {activeSos ? "PATIENT NEEDS HELP" : "PATIENT IS SAFE"}
            </h2>
            {activeSos ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-sos">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-semibold">SOS Active</span>
                </div>
                <p className="text-sm text-muted-foreground">{activeSos.note}</p>
                <p className="text-xs text-muted-foreground">
                  The patient must clear this alert from their Mind Buddy device.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="w-16 h-16 rounded-full bg-gradient-safe shadow-safe flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-safe-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No active alerts.</p>
              </div>
            )}
          </Card>

          {/* Read-only HW status */}
          <HardwareStatus
            pairingCode={device?.pairing_code ?? null}
            mode={device?.current_mode ?? null}
            meds={meds}
            lastSeenAt={device?.last_seen_at ?? null}
            deviceId={device?.id ?? null}
            patientUserId={activePatient.id}
            firmwareVersion={device?.firmware_version ?? null}
            otaUrl={device?.ota_url ?? null}
            otaVersion={device?.ota_version ?? null}
            otaRequestedAt={device?.ota_requested_at ?? null}
            otaConsumedAt={device?.ota_consumed_at ?? null}
            otaProgress={device?.ota_progress ?? 0}
            otaStatus={device?.ota_status ?? "idle"}
            soundEnabled={(device as any)?.sound_enabled ?? true}
            preferredVoice={(device as any)?.preferred_voice ?? "female"}
            speakerVolume={(device as any)?.speaker_volume ?? 70}
          />

          <MoodChart patientId={activePatient.id} />

          <Button variant="outline" className="w-full h-14 justify-start" onClick={() => setChatOpen(true)}>
            <MessageCircle className="w-4 h-4 mr-2" /> Open messages with {activePatient.display_name || "Patient"}
          </Button>

          {/* History */}
          <Card className="p-5">
            <h3 className="font-medium mb-3">SOS history</h3>
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
        </>
      )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link a patient</DialogTitle>
            <DialogDescription>Enter the device pairing code shown on your patient's Mind Buddy device.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="pair-code">Device code</Label>
            <div className="flex gap-2">
              <Input
                id="pair-code"
                placeholder="DEVICE CODE"
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.toUpperCase())}
                className="font-mono tracking-widest"
                maxLength={6}
              />
              <Button onClick={linkPatient} disabled={linking || !pairCode}>
                {linking ? "Linking…" : "Link"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-none w-screen h-screen translate-x-[-50%] translate-y-[-50%] border-0 rounded-none p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Messages</DialogTitle>
            <DialogDescription>Private care chat.</DialogDescription>
          </DialogHeader>
          {activePatient && (
            <ChatPanel
              userId={user.id}
              conversation="care"
              peerId={activePatient.id}
              peerName={activePatient.display_name || "Patient"}
              fullScreen
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
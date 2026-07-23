import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Heart, Pill, Cpu, Download, Upload, Volume2, Mic2, BellRing } from "lucide-react";
import { ConnectivityBadge } from "./ConnectivityBadge";
import { connectivityFrom } from "@/lib/connectivity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Med = { id: string; label: string; hour: number; minute: number; enabled: boolean };

const VOICE_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];


export function HardwareStatus({
  pairingCode,
  mode,
  meds,
  lastSeenAt,
  deviceId = null,
  patientUserId = null,
  firmwareVersion = null,
  otaUrl = null,
  otaVersion = null,
  otaRequestedAt = null,
  otaConsumedAt = null,
  otaProgress = 0,
  otaStatus = "idle",
  soundEnabled = true,
  preferredVoice = "female",
  speakerVolume = 70,
  canManage = false,
}: {
  pairingCode: string | null;
  mode: string | null;
  meds: Med[];
  lastSeenAt: string | null;
  deviceId?: string | null;
  patientUserId?: string | null;
  firmwareVersion?: string | null;
  otaUrl?: string | null;
  otaVersion?: string | null;
  otaRequestedAt?: string | null;
  otaConsumedAt?: string | null;
  otaProgress?: number | null;
  otaStatus?: string | null;
  soundEnabled?: boolean;
  preferredVoice?: string;
  speakerVolume?: number;
  canManage?: boolean;
}) {
  const conn = connectivityFrom(lastSeenAt);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sound, setSound] = useState(soundEnabled);
  const [voice, setVoice] = useState(preferredVoice);
  const [volume, setVolume] = useState(speakerVolume);
  const [savingPref, setSavingPref] = useState(false);

  // Track when the user last changed a preference locally so an in-flight /
  // stale refetch (or device sync) doesn't snap the control back to the old
  // database value before the write has propagated.
  const lastLocalEditRef = useRef(0);
  const DIRTY_WINDOW_MS = 8000;

  useEffect(() => {
    if (Date.now() - lastLocalEditRef.current < DIRTY_WINDOW_MS) return;
    setSound(soundEnabled);
  }, [soundEnabled]);
  useEffect(() => {
    if (Date.now() - lastLocalEditRef.current < DIRTY_WINDOW_MS) return;
    setVoice(preferredVoice);
  }, [preferredVoice]);
  useEffect(() => {
    if (Date.now() - lastLocalEditRef.current < DIRTY_WINDOW_MS) return;
    setVolume(speakerVolume);
  }, [speakerVolume]);

  async function savePrefs(patch: Record<string, unknown>) {
    if (!deviceId) return;
    lastLocalEditRef.current = Date.now();
    setSavingPref(true);
    const { error } = await (supabase as any)
      .from("devices")
      .update(patch)
      .eq("id", deviceId);
    setSavingPref(false);
    if (error) toast.error(error.message);
    else toast.success("Device preferences updated");
  }

  const updateInProgress = !!otaUrl && !!otaRequestedAt && !otaConsumedAt;
  const progress =
    typeof otaProgress === "number" && otaProgress > 0
      ? otaProgress
      : updateInProgress
        ? 5
        : 0;


  async function pushUpdate() {
    if (!deviceId || !patientUserId) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Select a firmware .bin file");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".bin")) {
      toast.error("Firmware must be a .bin file");
      return;
    }
    setUploading(true);
    const ts = Date.now();
    // Single, stable path per patient — upsert replaces the previous binary
    // so storage stays at one firmware file per device.
    const path = `${patientUserId}/firmware.bin`;
    const autoVersion = new Date(ts)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const up = await supabase.storage.from("firmware").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: "application/octet-stream",
    });
    if (up.error) {
      setUploading(false);
      toast.error(up.error.message);
      return;
    }
    const { error } = await (supabase as any)
      .from("devices")
      .update({
        ota_storage_path: path,
        ota_uploaded_at: new Date(ts).toISOString(),
        ota_url: null,
        ota_version: autoVersion,
        ota_requested_at: new Date(ts).toISOString(),
        ota_consumed_at: null,
        ota_progress: 0,
        ota_status: "requested",
      })
      .eq("id", deviceId);
    setUploading(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Firmware ${autoVersion} uploaded — device will fetch on next sync`);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function cancelUpdate() {
    if (!deviceId) return;
    const { error } = await (supabase as any)
      .from("devices")
      .update({
        ota_url: null,
        ota_storage_path: null,
        ota_version: null,
        ota_requested_at: null,
        ota_consumed_at: null,
        ota_progress: 0,
        ota_status: "idle",
      })
      .eq("id", deviceId);
    if (error) toast.error(error.message);
    else toast.success("Update cancelled");
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <h3 className="font-medium">Mind Buddy device</h3>
        </div>
        <ConnectivityBadge status={conn} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Support mode</div>
          <div className="mt-1 flex items-center gap-1.5">
            <Heart className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium text-sm">
              {mode ? mode.charAt(0) + mode.slice(1).toLowerCase() : "—"}
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pairing code</div>
          <div className="mt-1 font-mono tracking-wider text-sm">{pairingCode || "—"}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Change from the Mind Buddy Setup portal.</div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Pill className="w-3.5 h-3.5 text-primary" />
          <div className="text-xs font-medium text-muted-foreground">Medication schedule</div>
        </div>
        {meds.length === 0 ? (
          <p className="text-xs text-muted-foreground">No reminders set on the device.</p>
        ) : (
          <ul className="space-y-1.5">
            {meds.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-sm">
                <span className={m.enabled ? "" : "text-muted-foreground line-through"}>{m.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {String(m.hour).padStart(2, "0")}:{String(m.minute).padStart(2, "0")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Device preferences: sound / voice / volume — only the device owner (patient) can manage */}
      {canManage && (
      <div className="border-t border-border/40 pt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing className="w-3.5 h-3.5 text-primary" />
            <Label htmlFor="sound-switch" className="text-xs font-medium text-muted-foreground">
              Notification &amp; alarm sound
            </Label>
          </div>
          <Switch
            id="sound-switch"
            checked={sound}
            disabled={!canManage || savingPref}
            onCheckedChange={(v) => {
              setSound(v);
              savePrefs({ sound_enabled: v });
            }}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Mic2 className="w-3.5 h-3.5 text-primary" />
            <Label className="text-xs font-medium text-muted-foreground">Assistant voice</Label>
          </div>
          <Select
            value={voice}
            disabled={!canManage || savingPref}
            onValueChange={(v) => {
              setVoice(v);
              savePrefs({ preferred_voice: v });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-primary" />
              <Label className="text-xs font-medium text-muted-foreground">Speaker volume</Label>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">{volume}%</span>
          </div>
          <Slider
            value={[volume]}
            min={0}
            max={100}
            step={5}
            disabled={!canManage || savingPref}
            onValueChange={([v]) => setVolume(v)}
            onValueCommit={([v]) => savePrefs({ speaker_volume: v })}
          />
        </div>
      </div>
      )}

      {/* Firmware update — only the device owner (patient) can manage */}
      {canManage && (
      <div className="border-t border-border/40 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Download className="w-3.5 h-3.5 text-primary" />
          <div className="text-xs font-medium text-muted-foreground">Firmware update</div>
          <span className="ml-auto text-[10px] font-mono text-muted-foreground">
            v{firmwareVersion || "—"}
          </span>
        </div>

        {updateInProgress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {otaStatus === "installing"
                  ? "Installing…"
                  : otaStatus === "downloading"
                    ? "Downloading…"
                    : "Queued — waiting for device"}
                {otaVersion ? ` (${otaVersion})` : ""}
              </span>
              <span className="font-mono">{progress}%</span>
            </div>
            <Progress value={progress} />
            {canManage && (
              <Button variant="ghost" size="sm" onClick={cancelUpdate} className="h-7 text-xs">
                Cancel update
              </Button>
            )}
          </div>
        ) : canManage ? (
          <div className="space-y-2">
            <div>
              <Label htmlFor="ota-file" className="sr-only">Firmware file</Label>
              <Input
                id="ota-file"
                ref={fileRef}
                type="file"
                accept=".bin,application/octet-stream"
                className="h-9 text-xs file:mr-2 file:text-xs"
              />
            </div>
            <Button
              onClick={pushUpdate}
              disabled={uploading || !deviceId || !patientUserId}
              size="sm"
              className="w-full h-8"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {uploading ? "Uploading…" : "Upload & push firmware"}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              The version label is generated automatically from the upload timestamp.
              Keep the device powered and on Wi-Fi while it updates.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No update in progress.</p>
        )}
      </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Use the <strong>Mind Buddy Setup portal</strong> on the device to pair it, change the
        pairing code, or reconnect Wi-Fi. Join the <span className="font-mono">MindBuddy-Setup</span> network
        from your phone and a configuration page opens automatically.
      </p>
    </Card>
  );
}

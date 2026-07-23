import { createFileRoute } from "@tanstack/react-router";

// Music command sent to the device. Now backed by the admin-curated music
// library (Supabase Storage); the device receives a direct signed URL it
// streams, or "stop". Legacy [[music:<id>]] directives are ignored — the
// catalogue is now driven by [[song:<uuid>]] which the AI handler resolves
// into `devices.current_song_url`.
function songCommandFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url; // hardware streams URLs that start with http(s)
}



const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Code",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export const Route = createFileRoute("/api/public/device/sync")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),

      // ESP32 polls this every few seconds. Returns mode, first enabled med
      // schedule, whether there is an unresolved SOS event, caregiver email,
      // and any pending OTA firmware update.
      GET: async ({ request }) => {
        const code =
          request.headers.get("x-device-code") ??
          new URL(request.url).searchParams.get("code") ??
          "";
        if (!code) return json({ error: "missing device code" }, 401);

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data: device, error: devErr } = (await (supabaseAdmin as any)
            .from("devices")
            .select(
              "id, user_id, current_mode, caregiver_email, ota_storage_path, ota_version, ota_consumed_at, ota_uploaded_at, sound_enabled, preferred_voice, speaker_volume, current_song_url, current_song_at",
            )
            .eq("pairing_code", code.trim().toUpperCase())
            .maybeSingle()) as { data: any; error: any };


          if (devErr) {
            console.error("[device/sync GET] device lookup", devErr);
            return json({ error: "device sync unavailable" }, 503);
          }
          if (!device) return json({ error: "device not paired" }, 404);

          // touch last_seen_at (best-effort)
          await supabaseAdmin
            .from("devices")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", device.id);

          // Up to 5 enabled medication schedules for this patient
          const { data: meds } = await supabaseAdmin
            .from("medication_schedules")
            .select("hour, minute, enabled, label")
            .eq("user_id", device.user_id)
            .eq("enabled", true)
            .order("hour", { ascending: true })
            .order("minute", { ascending: true })
            .limit(5);
          const med = meds && meds.length
            ? { hour: meds[0].hour, minute: meds[0].minute, enabled: meds[0].enabled }
            : { hour: 20, minute: 0, enabled: false };

          // Any unresolved SOS event for this patient
          const { data: sos } = await supabaseAdmin
            .from("sos_events")
            .select("id")
            .eq("user_id", device.user_id)
            .eq("status", "active")
            .is("resolved_at", null)
            .limit(1)
            .maybeSingle();

          // OTA: generate fresh signed URL if a new firmware blob is pending
          let ota: { url: string; version: string } | null = null;
          const uploadedAt = device.ota_uploaded_at
            ? new Date(device.ota_uploaded_at).getTime()
            : 0;
          const consumedAt = device.ota_consumed_at
            ? new Date(device.ota_consumed_at).getTime()
            : 0;
          if (device.ota_storage_path && uploadedAt > consumedAt) {
            const { data: signed, error: signErr } = await supabaseAdmin
              .storage
              .from("firmware")
              .createSignedUrl(device.ota_storage_path, 60 * 30); // 30 min
            if (signErr) {
              console.error("[device/sync GET] signed url", signErr);
            } else if (signed?.signedUrl) {
              ota = {
                url: signed.signedUrl,
                version: device.ota_version ?? "",
              };
            }
          }

          // Music: now sourced from devices.current_song_url, written by the
          // AI handler when it resolves a [[song:<uuid>]] directive. Direct
          // signed URL → device streams it. `null` URL = stop playback.
          let music: { query: string; at: number } | null = null;
          const songUrl = songCommandFromUrl(device.current_song_url);
          const songAt = device.current_song_at
            ? Math.floor(new Date(device.current_song_at as string).getTime() / 1000)
            : 0;
          if (songUrl && songAt) {
            music = { query: songUrl, at: songAt };
          } else if (device.current_song_at && !device.current_song_url) {
            music = { query: "stop", at: songAt };
          }

          const dev = device as {
            current_mode?: string | null;
            caregiver_email?: string | null;
            sound_enabled?: boolean | null;
            preferred_voice?: string | null;
            speaker_volume?: number | null;
          };


          return json({
            mode: dev.current_mode ?? "ANXIETY",
            med,
            meds: (meds ?? []).map((m) => ({
              hour: m.hour,
              minute: m.minute,
              enabled: m.enabled,
              label: m.label,
            })),
            sos_active: !!sos,
            caregiver_email: dev.caregiver_email ?? "",
            sound_enabled: dev.sound_enabled ?? true,
            preferred_voice:
              dev.preferred_voice === "male" ? "male" : "female",
            speaker_volume:
              typeof dev.speaker_volume === "number" ? dev.speaker_volume : 70,
            ota,
            music,
          });

        } catch (error) {
          console.error("[device/sync GET]", error);
          return json({ error: "device sync unavailable" }, 503);
        }
      },

      // ESP32 pushes voice-set mode / medication / SOS-resolved / OTA-consumed.
      POST: async ({ request }) => {
        const code = request.headers.get("x-device-code") ?? "";
        if (!code) return json({ error: "missing device code" }, 401);
        const body = (await request.json().catch(() => ({}))) as {
          mode?: string;
          med?: { hour?: number; minute?: number; enabled?: boolean };
          meds?: Array<{ hour?: number; minute?: number; enabled?: boolean; label?: string }>;
          caregiver_email?: string;
          sos_resolve?: boolean;
          ota_consumed?: boolean;
          ota_progress?: number;
          ota_status?: string;
          sound_enabled?: boolean;
          preferred_voice?: string;
          speaker_volume?: number;
        };

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data: device, error: devErr } = await supabaseAdmin
            .from("devices")
            .select("id, user_id")
            .eq("pairing_code", code.trim().toUpperCase())
            .maybeSingle();
          if (devErr || !device) {
            return json({ error: "device not paired" }, 404);
          }

          const deviceUpdate: Record<string, unknown> = {
            last_seen_at: new Date().toISOString(),
          };

          if (typeof body.mode === "string" && body.mode.length) {
            deviceUpdate.current_mode = body.mode;
            await supabaseAdmin.from("mode_history").insert({
              user_id: device.user_id,
              mode: body.mode,
            });
          }
          if (typeof body.caregiver_email === "string") {
            deviceUpdate.caregiver_email = body.caregiver_email;
          }
          if (typeof body.ota_progress === "number") {
            deviceUpdate.ota_progress = Math.max(0, Math.min(100, Math.round(body.ota_progress)));
          }
          if (typeof body.ota_status === "string" && body.ota_status.length) {
            deviceUpdate.ota_status = body.ota_status;
          }
          if (body.ota_consumed) {
            deviceUpdate.ota_consumed_at = new Date().toISOString();
            deviceUpdate.ota_status = "idle";
            deviceUpdate.ota_progress = 100;
          }
          if (typeof body.sound_enabled === "boolean") {
            deviceUpdate.sound_enabled = body.sound_enabled;
          }
          if (typeof body.preferred_voice === "string" && body.preferred_voice.length) {
            const v = body.preferred_voice.toLowerCase();
            if (["female", "male"].includes(v)) {
              deviceUpdate.preferred_voice = v;
            }
          }
          if (typeof body.speaker_volume === "number") {
            deviceUpdate.speaker_volume = Math.max(
              0,
              Math.min(100, Math.round(body.speaker_volume)),
            );
          }

          await (supabaseAdmin as any)
            .from("devices")
            .update(deviceUpdate)
            .eq("id", device.id);


          if (body.med && typeof body.med.hour === "number") {
            const { data: existing } = await supabaseAdmin
              .from("medication_schedules")
              .select("id")
              .eq("user_id", device.user_id)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();
            const payload = {
              user_id: device.user_id,
              label: "Medication",
              hour: body.med.hour,
              minute: body.med.minute ?? 0,
              enabled: body.med.enabled ?? true,
            };
            if (existing?.id) {
              await supabaseAdmin
                .from("medication_schedules")
                .update(payload)
                .eq("id", existing.id);
            } else {
              await supabaseAdmin
                .from("medication_schedules")
                .insert(payload);
            }
          }

          if (body.sos_resolve) {
            await supabaseAdmin
              .from("sos_events")
              .update({
                status: "resolved",
                resolved_at: new Date().toISOString(),
              })
              .eq("user_id", device.user_id)
              .eq("status", "active")
              .is("resolved_at", null);
          }

          return json({ ok: true });
        } catch (error) {
          console.error("[device/sync POST]", error);
          return json({ error: "device sync unavailable" }, 503);
        }
      },
    },
  },
});

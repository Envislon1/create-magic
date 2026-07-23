import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Code",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export const Route = createFileRoute("/api/public/device/sos")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const code =
          request.headers.get("x-device-code") ??
          new URL(request.url).searchParams.get("code") ??
          "";
        if (!code) return json({ error: "missing device code" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          note?: string;
        };

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data: device, error: devErr } = await supabaseAdmin
            .from("devices")
            .select("id, user_id, caregiver_email")
            .eq("pairing_code", code.trim().toUpperCase())
            .maybeSingle();
          if (devErr || !device) {
            return json({ error: "device not paired" }, 404);
          }

          // Don't open duplicate active SOS rows.
          const { data: existing } = await supabaseAdmin
            .from("sos_events")
            .select("id")
            .eq("user_id", device.user_id)
            .eq("status", "active")
            .is("resolved_at", null)
            .limit(1)
            .maybeSingle();

          if (existing?.id) {
            return json({ ok: true, id: existing.id, deduped: true });
          }

          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("sos_events")
            .insert({
              user_id: device.user_id,
              device_id: device.id,
              source: "device",
              status: "active",
              note: body.note ?? null,
            })
            .select("id")
            .single();

          if (insErr) {
            console.error("[device/sos]", insErr);
            return json({ error: "could not record sos" }, 503);
          }

          await supabaseAdmin
            .from("devices")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", device.id);


          return json({ ok: true, id: inserted.id });
        } catch (error) {
          console.error("[device/sos]", error);
          return json({ error: "device sos unavailable" }, 503);
        }
      },
    },
  },
});

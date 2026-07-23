import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";


export const triggerPatientSos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        deviceId: z.string().uuid().nullable().optional(),
        note: z.string().min(1).max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("sos_events")
      .select("id, source, note")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return { event: existing, created: false };

    const { data: device } = data.deviceId
      ? await (supabaseAdmin as any).from("devices").select("id, caregiver_email").eq("id", data.deviceId).eq("user_id", userId).maybeSingle()
      : await (supabaseAdmin as any).from("devices").select("id, caregiver_email").eq("user_id", userId).order("created_at").limit(1).maybeSingle();

    const { data: event, error } = await supabaseAdmin
      .from("sos_events")
      .insert({
        user_id: userId,
        device_id: device?.id ?? null,
        source: "app",
        note: data.note ?? "SOS triggered from the app",
      })
      .select("id, source, note")
      .single();
    if (error) throw new Error(error.message);


    return { event, created: true };
  });

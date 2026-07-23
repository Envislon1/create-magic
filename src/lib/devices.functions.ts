import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Caregivers cannot SELECT another user's device row via RLS, so we expose
// a narrow server-side lookup by pairing code that returns only the minimal
// fields needed to create the caregiver link. The caller must be signed in.
export const findDeviceForPairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ code: z.string().min(4).max(12) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const code = data.code.trim().toUpperCase().replace(/\s+/g, "");

    // Prefer the SECURITY DEFINER RPC from the latest SQL migration. It works
    // even when caregivers cannot directly read another user's `devices` row.
    const { data: rpcRows, error: rpcError } = await (context.supabase as any).rpc(
      "find_device_by_pairing_code",
      { _code: code },
    );
    if (!rpcError) {
      const dev = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      if (dev?.id && dev?.user_id) {
        return { device: { id: dev.id as string, user_id: dev.user_id as string } };
      }
    }

    // Fallback for projects where the RPC has not been applied yet or where
    // PostgREST returned an empty RPC result while the row still exists.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dev, error } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, pairing_code")
      .ilike("pairing_code", code)
      .maybeSingle();
    if (error) throw new Error(`${rpcError?.message || "RPC returned no matching device"}; fallback failed: ${error.message}`);
    if (dev?.id && dev?.user_id) return { device: { id: dev.id, user_id: dev.user_id } };

    const { data: rows, error: scanError } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, pairing_code")
      .limit(500);
    if (scanError) throw new Error(`${rpcError?.message || "RPC returned no matching device"}; scan failed: ${scanError.message}`);
    const normalized = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
    const match = (rows ?? []).find((row: any) => normalized(row.pairing_code) === code);
    return { device: match ? { id: match.id as string, user_id: match.user_id as string } : null };
  });

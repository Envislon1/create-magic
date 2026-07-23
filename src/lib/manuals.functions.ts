import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAILS = ["wuf.tech@gmail.com", "wuf.device@gmail.com"];
const isAdminEmail = (e?: string | null) =>
  ADMIN_EMAILS.includes((e || "").toLowerCase());

export type Manual = {
  id: string;
  file_url: string;
  file_name: string;
  version: string | null;
  size_bytes: number | null;
  created_at: string;
};

/** Public: fetch the current active manual (no auth required). */
export const getActiveManual = createServerFn({ method: "GET" }).handler(
  async () => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await (supabaseAdmin as any)
      .from("product_manuals")
      .select("id, file_url, file_name, version, size_bytes, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      // Table may not exist yet — fall back to the bundled file.
      return {
        manual: {
          id: "default",
          file_url: "/mind-buddy-manual.pdf",
          file_name: "mind-buddy-manual.pdf",
          version: "1.0",
          size_bytes: null,
          created_at: new Date().toISOString(),
        } as Manual,
      };
    }
    return {
      manual:
        (data as Manual) ?? {
          id: "default",
          file_url: "/mind-buddy-manual.pdf",
          file_name: "mind-buddy-manual.pdf",
          version: "1.0",
          size_bytes: null,
          created_at: new Date().toISOString(),
        },
    };
  },
);

/** Admin: list every manual ever uploaded (latest first). */
export const adminListManuals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = ((context.claims as any)?.email || "").toLowerCase();
    if (!isAdminEmail(email)) throw new Error("Forbidden");
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await (supabaseAdmin as any)
      .from("product_manuals")
      .select("id, file_url, file_name, version, size_bytes, created_at, is_active")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { manuals: (data ?? []) as (Manual & { is_active: boolean })[] };
  });

/** Admin: mint a signed upload URL for the manuals bucket. */
export const adminCreateManualUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        filename: z.string().min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = ((context.claims as any)?.email || "").toLowerCase();
    if (!isAdminEmail(email)) throw new Error("Forbidden");
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${Date.now()}_${safe}`;
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: signed, error } = await (supabaseAdmin as any).storage
      .from("manuals")
      .createSignedUploadUrl(path);
    if (error || !signed?.signedUrl)
      throw new Error(error?.message || "Could not sign upload URL");
    return { path, signedUrl: signed.signedUrl as string };
  });

/** Admin: register a newly uploaded manual as the active one. */
export const adminPublishManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        storage_path: z.string().min(1).max(400),
        file_name: z.string().min(1).max(200),
        version: z.string().max(40).optional(),
        size_bytes: z.number().int().nonnegative().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = ((context.claims as any)?.email || "").toLowerCase();
    if (!isAdminEmail(email)) throw new Error("Forbidden");
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: pub } = (supabaseAdmin as any).storage
      .from("manuals")
      .getPublicUrl(data.storage_path);
    const file_url = pub?.publicUrl as string;
    if (!file_url) throw new Error("Could not resolve public URL");

    // Deactivate previous manuals, then insert the new active row.
    await (supabaseAdmin as any)
      .from("product_manuals")
      .update({ is_active: false })
      .eq("is_active", true);

    const { error } = await (supabaseAdmin as any)
      .from("product_manuals")
      .insert({
        file_url,
        file_name: data.file_name,
        storage_path: data.storage_path,
        version: data.version ?? null,
        size_bytes: data.size_bytes ?? null,
        uploaded_by: (context as any).userId ?? null,
        is_active: true,
      });
    if (error) throw new Error(error.message);
    return { ok: true, file_url };
  });
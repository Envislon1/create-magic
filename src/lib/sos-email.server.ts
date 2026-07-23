import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Minimal SMTP-over-TLS client that runs in the Cloudflare Workers runtime
// (where nodemailer's raw node:net sockets are not available). Connects to
// Gmail's implicit-TLS endpoint on port 465 and authenticates with the
// account's app password.
async function sendGmailSmtp(opts: {
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}) {
  const { connect } = await import("cloudflare:sockets");
  const socket = connect(
    { hostname: "smtp.gmail.com", port: 465 },
    { secureTransport: "on", allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = "";

  async function expect(code: number) {
    // Read until we have a complete, final SMTP response line ("NNN <text>\r\n").
    // Multiline replies use "NNN-..." for intermediate lines.
    while (!/(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buffer)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed unexpectedly");
      buffer += dec.decode(value);
    }
    const match = buffer.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
    const received = match ? Number(match[1]) : 0;
    const full = buffer;
    buffer = "";
    if (received !== code) {
      throw new Error(`SMTP expected ${code} but got: ${full.trim()}`);
    }
  }

  async function send(line: string) {
    await writer.write(enc.encode(line + "\r\n"));
  }

  try {
    await expect(220);
    await send("EHLO mindbuddy");
    await expect(250);
    await send("AUTH LOGIN");
    await expect(334);
    await send(btoa(opts.user));
    await expect(334);
    await send(btoa(opts.pass));
    await expect(235);
    await send(`MAIL FROM:<${opts.user}>`);
    await expect(250);
    await send(`RCPT TO:<${opts.to}>`);
    await expect(250);
    await send("DATA");
    await expect(354);
    const message = [
      `From: ${opts.from}`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      // Dot-stuff lines that start with "." per RFC 5321.
      opts.text.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n.."),
      ".",
    ].join("\r\n");
    await send(message);
    await expect(250);
    await send("QUIT");
  } finally {
    try {
      await writer.close();
    } catch {
      /* ignore */
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SosEmailInput = {
  eventId: string;
  patientId: string;
  deviceId?: string | null;
  source: string;
  note?: string | null;
  caregiverEmail?: string | null;
};

function cleanEmail(email?: string | null) {
  const value = (email ?? "").trim().toLowerCase();
  return EMAIL_RE.test(value) ? value : null;
}

async function getUserEmail(userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return null;
  return cleanEmail(data.user?.email ?? null);
}

async function resolveCaregiverEmail(input: SosEmailInput) {
  const direct = cleanEmail(input.caregiverEmail);
  if (direct) return direct;

  if (input.deviceId) {
    const { data: device } = await (supabaseAdmin as any)
      .from("devices")
      .select("caregiver_email")
      .eq("id", input.deviceId)
      .maybeSingle();
    const fromDevice = cleanEmail(device?.caregiver_email ?? null);
    if (fromDevice) return fromDevice;
  }

  const { data: links } = await supabaseAdmin
    .from("caregiver_links")
    .select("caregiver_id")
    .eq("patient_id", input.patientId)
    .limit(1);
  const linkedCaregiverId = links?.[0]?.caregiver_id;
  return linkedCaregiverId ? getUserEmail(linkedCaregiverId) : null;
}

export async function sendSosEmailForEvent(input: SosEmailInput) {
  const { data: existing } = await (supabaseAdmin as any)
    .from("sos_events")
    .select("notification_sent_at")
    .eq("id", input.eventId)
    .maybeSingle();

  if (existing?.notification_sent_at) return { sent: false, reason: "already_sent" };

  const to = await resolveCaregiverEmail(input);
  if (!to) {
    await markSosEmailError(input.eventId, "No caregiver email configured");
    return { sent: false, reason: "missing_recipient" };
  }

  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!user || !pass) {
    await markSosEmailError(input.eventId, "Gmail SMTP credentials are not configured");
    return { sent: false, reason: "missing_smtp_credentials" };
  }

  const patientEmail = await getUserEmail(input.patientId);
  const when = new Date().toLocaleString();

  try {
    await sendGmailSmtp({
      user,
      pass,
      from: process.env.SOS_EMAIL_FROM || `Mind Buddy <${user}>`,
      to,
      subject: "Mind Buddy SOS alert triggered",
      text: [
        "A Mind Buddy SOS alert has been triggered.",
        "",
        `Source: ${input.source}`,
        `Patient: ${patientEmail ?? input.patientId}`,
        `Time: ${when}`,
        input.note ? `Note: ${input.note}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    await (supabaseAdmin as any)
      .from("sos_events")
      .update({ notification_sent_at: new Date().toISOString(), notification_error: null })
      .eq("id", input.eventId)
      .is("notification_sent_at", null);

    return { sent: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SMTP error";
    await markSosEmailError(input.eventId, message.slice(0, 500));
    return { sent: false, reason: "smtp_failed" };
  }
}

async function markSosEmailError(eventId: string, message: string) {
  await (supabaseAdmin as any).from("sos_events").update({ notification_error: message }).eq("id", eventId);
}

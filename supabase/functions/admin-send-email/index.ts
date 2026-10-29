import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Sends an email from an @polybelle.me address through Resend (https://resend.com) for a signed-in admin,
// and logs it in pb_emails. Needs the RESEND_API_KEY secret and polybelle.me verified in Resend.
const DOMAIN = "polybelle.me";
const MAX_RECIPIENTS = 20;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function addressList(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : [];
  const list = [...new Set(raw.map((a) => String(a).trim().toLowerCase()).filter(Boolean))];
  return list.every((a) => EMAIL_RE.test(a) && a.length <= 254) ? list : null;
}

// Plain-text message → simple branded HTML (links become clickable, line breaks kept)
function toHtml(body: string, fromName: string) {
  // find links in the raw text (before escaping), leaving trailing punctuation outside the link
  const text = body.split(/(https?:\/\/[^\s<>"]+)/).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const [, url, tail] = part.match(/^(.*?)([.,;:!?)\]'"]*)$/)!;
    return `<a href="${esc(url)}" style="color:#9C6B5E">${esc(url)}</a>${esc(tail)}`;
  }).join("");
  const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#F7F2EC;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#3A2A24">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E8DED3">
<div style="background:#3A2A24;padding:20px 28px;color:#E9CFA0;font-family:Georgia,serif;letter-spacing:.3em;font-size:18px">POLYBELLE</div>
<div style="padding:28px;font-size:15px;line-height:1.6">${paras}</div>
<div style="padding:16px 28px;border-top:1px solid #E8DED3;font-size:12px;color:#8A7A70">${esc(fromName)} · <a href="https://www.polybelle.me" style="color:#8A7A70">www.polybelle.me</a></div>
</div></body></html>`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });

  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "Sign in as an admin before sending email." });

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch (error) {
    console.error("Invalid send-email request body:", error);
    return reply(400, { error: "A valid JSON request is required." });
  }
  if (!input || typeof input !== "object") return reply(400, { error: "A valid JSON request is required." });

  const local = typeof input.from_local === "string" ? input.from_local.trim().toLowerCase() : "";
  if (!/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/.test(local)) return reply(400, { error: "Use letters, numbers, dots, hyphens or underscores for the sender address." });
  const fromName = (typeof input.from_name === "string" ? input.from_name : "").replace(/["<>\r\n]/g, "").trim().slice(0, 80) || "Polybelle";
  const to = addressList(input.to);
  const cc = addressList(input.cc ?? []);
  if (!to || !to.length) return reply(400, { error: "Enter at least one valid recipient email." });
  if (!cc) return reply(400, { error: "One of the CC emails isn't valid." });
  if (to.length + cc.length > MAX_RECIPIENTS) return reply(400, { error: `Send to at most ${MAX_RECIPIENTS} people at once.` });
  const replyTo = typeof input.reply_to === "string" && input.reply_to.trim() ? input.reply_to.trim().toLowerCase() : null;
  if (replyTo && !EMAIL_RE.test(replyTo)) return reply(400, { error: "The reply-to email isn't valid." });
  const subject = typeof input.subject === "string" ? input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!subject) return reply(400, { error: "Add a subject." });
  if (!body || body.length > 50000) return reply(400, { error: "Write a message (up to 50,000 characters)." });
  const bookingRef = typeof input.booking_ref === "string" && input.booking_ref.trim() ? input.booking_ref.trim().slice(0, 40) : null;
  const inboxId = typeof input.inbox_id === "string" && /^[0-9a-f-]{36}$/i.test(input.inbox_id) ? input.inbox_id : null;

  const attachments: { filename: string; content: string }[] = [];
  let attachmentBytes = 0;
  for (const a of Array.isArray(input.attachments) ? input.attachments : []) {
    const filename = typeof a?.filename === "string" ? a.filename.replace(/[\\/\r\n"]/g, "_").slice(0, 120) : "";
    const content = typeof a?.content === "string" ? a.content : "";
    if (!filename || !/^[A-Za-z0-9+/=]+$/.test(content)) return reply(400, { error: "An attachment couldn't be read." });
    attachmentBytes += Math.floor(content.length * 3 / 4);
    attachments.push({ filename, content });
  }
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) return reply(400, { error: "Attachments must total 10 MB or less." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing Supabase environment variables for sending email.");
    return reply(500, { error: "Email sending is not configured on the server." });
  }
  if (!resendKey) return reply(500, { error: "Email sending isn't set up yet: add the RESEND_API_KEY secret in Supabase." });

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "Your admin session is invalid. Sign in again." });
  const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("pb_is_admin");
  if (adminCheckError) {
    console.error("Could not verify admin permissions:", adminCheckError.message);
    return reply(500, { error: "Could not verify admin permissions." });
  }
  if (!isAdmin) return reply(403, { error: "Admin access is required to send email." });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // A reply to an Inbox email: keep it in the same conversation in the customer's mail app
  let threadHeaders: Record<string, string> | undefined;
  if (inboxId) {
    const { data: original, error: originalError } = await serviceClient.from("pb_inbox")
      .select("message_id, references").eq("id", inboxId).maybeSingle();
    if (originalError) console.error("Could not load the email being replied to:", originalError.message);
    if (original?.message_id) {
      threadHeaders = {
        "In-Reply-To": original.message_id,
        "References": [original.references, original.message_id].filter(Boolean).join(" ").slice(-4000)
      };
    }
  }

  const from = `${local}@${DOMAIN}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${from}>`,
      to, cc: cc.length ? cc : undefined,
      reply_to: replyTo || undefined,
      subject,
      text: body,
      html: toHtml(body, fromName),
      attachments: attachments.length ? attachments : undefined,
      headers: threadHeaders
    })
  });
  const result = await res.json().catch(() => ({}));
  const sendError = res.ok ? null : (result?.message || `Resend returned ${res.status}`);
  if (sendError) console.error("Resend could not send email:", sendError);

  const { error: logError } = await serviceClient.from("pb_emails").insert({
    sent_by: authData.user.email || authData.user.id,
    from_address: from, to_addresses: to, cc_addresses: cc, reply_to: replyTo,
    subject, body, attachments: attachments.map((a) => a.filename), booking_ref: bookingRef, inbox_id: inboxId,
    status: sendError ? "Failed" : "Sent", provider_id: result?.id || null, error: sendError
  });
  if (logError) console.error("Could not log email:", logError.message);
  if (!sendError && inboxId) {
    const { error: repliedError } = await serviceClient.from("pb_inbox").update({ replied_at: new Date().toISOString(), is_read: true }).eq("id", inboxId);
    if (repliedError) console.error("Could not mark the email as replied:", repliedError.message);
  }

  if (sendError) return reply(502, { error: "The email wasn't sent: " + sendError });
  return reply(200, { success: true, id: result?.id || null, from, logged: !logError });
});

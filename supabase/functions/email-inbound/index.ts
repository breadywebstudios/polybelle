import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Resend "email.received" webhook → pb_inbox (Admin → Inbox).
// Public endpoint (verify_jwt = false): every request must carry a valid Resend (Svix) signature made with
// RESEND_WEBHOOK_SECRET. The webhook only has metadata, so the full email and its attachments are fetched
// from the Resend API with RESEND_API_KEY. Attachment links from Resend expire after an hour, so the files
// are copied into the private "inbox" bucket.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const TOLERANCE_SECONDS = 5 * 60;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Svix / Standard Webhooks: HMAC-SHA256 of "id.timestamp.body", keyed with the base64 part of whsec_…
async function validSignature(headers: Headers, body: string, secret: string) {
  const id = headers.get("svix-id"), ts = headers.get("svix-timestamp"), sigs = headers.get("svix-signature");
  if (!id || !ts || !sigs) return false;
  const t = Number(ts), now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(t) || Math.abs(now - t) > TOLERANCE_SECONDS) return false;
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = "v1," + btoa(String.fromCharCode(...mac));
  return sigs.split(" ").some((s) => sameText(s, expected));
}

// "Name <a@b.com>" or "a@b.com" → { address, name }
function parseAddress(value: unknown) {
  const s = String(value ?? "").trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { address: m[2].trim().toLowerCase(), name: m[1].trim() || null } : { address: s.toLowerCase(), name: null };
}
const addresses = (list: unknown) => (Array.isArray(list) ? list : list ? [list] : []).map((a) => parseAddress(a).address.replace(/\u0000/g, "")).filter(Boolean);
const header = (headers: Record<string, unknown> | null | undefined, name: string) => {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
  return key ? String(headers![key]) : null;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !resendKey || !supabaseUrl || !serviceRoleKey) {
    console.error("email-inbound is missing RESEND_WEBHOOK_SECRET, RESEND_API_KEY or Supabase variables.");
    return json(500, { error: "Not configured." });
  }

  const raw = await request.text();   // the signature covers the exact raw body
  if (!(await validSignature(request.headers, raw, secret))) return json(401, { error: "Invalid signature." });

  let event: { type?: string; data?: { email_id?: string; received_for?: unknown } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (event.type !== "email.received") return json(200, { ignored: event.type ?? null });
  const emailId = event.data?.email_id;
  if (!emailId) return json(400, { error: "Missing email_id." });

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: existing, error: lookupError } = await db.from("pb_inbox").select("id").eq("resend_id", emailId).maybeSingle();
  if (lookupError) {
    console.error("Could not check the inbox:", lookupError.message);
    return json(500, { error: "Database unavailable." });
  }
  if (existing) return json(200, { duplicate: true });   // Resend retries and replays reuse the same email

  const api = (path: string) => fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${resendKey}` } });
  const res = await api(`/emails/receiving/${encodeURIComponent(emailId)}`);
  if (!res.ok) {
    console.error("Could not fetch received email", emailId, res.status, await res.text().catch(() => ""));
    return json(502, { error: "Could not fetch the email from Resend." });   // non-2xx → Resend retries later
  }
  const mail = await res.json();
  const from = parseAddress(header(mail.headers, "from") || mail.from);

  // Copy the attachments. Inline images already shown in the HTML (as data: URIs) are skipped; inline
  // documents (e.g. a PDF from iPhone Mail) are kept. A temporary failure answers 502 before anything is
  // stored, so Resend delivers the webhook again and the copy is retried with fresh download links.
  const attachments: Record<string, unknown>[] = [];
  if (Array.isArray(mail.attachments) && mail.attachments.length) {
    const listRes = await api(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`);
    if (!listRes.ok) {
      console.error("Could not list attachments for", emailId, listRes.status, await listRes.text().catch(() => ""));
      return json(502, { error: "Could not list the attachments." });
    }
    const list = (await listRes.json()).data || [];
    for (const [i, a] of list.entries()) {
      const shownInHtml = a.content_disposition === "inline" && a.content_id && typeof mail.html === "string" && mail.html
        && String(a.content_type || "").toLowerCase().startsWith("image/")
        && !mail.html.includes(`cid:${String(a.content_id).replace(/^<|>$/g, "")}`);
      if (shownInHtml) continue;
      const filename = String(a.filename || `attachment-${i + 1}`).replace(/[\\/\r\n"\u0000]/g, "_").slice(0, 120);
      const meta = { filename, content_type: a.content_type || "application/octet-stream", size: a.size ?? null, path: null as string | null };
      if (a.size > MAX_ATTACHMENT_BYTES) { attachments.push({ ...meta, error: "Too large to keep (over 25 MB)" }); continue; }
      try {
        const file = await fetch(a.download_url);
        if (!file.ok) throw new Error(`download ${file.status}`);
        const path = `${emailId}/${i + 1}-${filename.replace(/[^\w.\-]+/g, "_")}`;
        const { error } = await db.storage.from("inbox").upload(path, await file.arrayBuffer(), { contentType: meta.content_type, upsert: true });
        if (error) throw error;
        attachments.push({ ...meta, path });
      } catch (error) {
        console.error("Could not keep attachment", filename, "of", emailId, error);
        return json(502, { error: "Could not save an attachment." });
      }
    }
  }

  // Postgres text can't hold NUL characters, which badly encoded mail sometimes contains
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\u0000/g, "") : null);
  const { error: insertError } = await db.from("pb_inbox").insert({
    resend_id: emailId,
    received_at: mail.created_at || new Date().toISOString(),
    from_address: clean(from.address) || "unknown",
    from_name: clean(from.name),
    to_addresses: addresses(mail.to),
    cc_addresses: addresses(mail.cc),
    received_for: addresses(mail.received_for ?? event.data?.received_for),
    reply_to: addresses(mail.reply_to),
    subject: (clean(mail.subject) ?? "").slice(0, 1000),
    body_text: clean(mail.text),
    body_html: clean(mail.html),
    message_id: clean(mail.message_id || header(mail.headers, "message-id")),
    references: clean(header(mail.headers, "references")),
    attachments,
    auth: mail.authentication ? JSON.parse(JSON.stringify(mail.authentication).replace(/\\u0000/g, "")) : null
  });
  if (insertError && insertError.code !== "23505") {   // 23505: a parallel retry already stored it
    console.error("Could not store received email", emailId, insertError.message);
    return json(500, { error: "Could not store the email." });
  }
  return json(200, { stored: true });
});

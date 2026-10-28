// Public invoice link: https://www.polybelle.me/i/<code>  (Vercel rewrites it to this function)
// Looks the short code up in pb_invoice_files and streams that booking's latest invoice PDF from the
// private "invoices" bucket. The PDF itself is never public; only someone with the link can open it.
import { createClient } from "jsr:@supabase/supabase-js@2";

const page = (title: string, msg: string, status: number) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · Polybelle</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FAF6F1;color:#2B211D;font:16px/1.6 system-ui,sans-serif;text-align:center;padding:24px}
b{display:block;font:500 28px/1.2 Georgia,serif;letter-spacing:.22em;color:#B8923E;margin-bottom:18px}a{color:#77551F}</style></head>
<body><div><b>POLYBELLE</b><h1 style="font:500 22px Georgia,serif;margin:0 0 8px">${title}</h1><p>${msg}</p>
<p><a href="https://www.polybelle.me">www.polybelle.me</a></p></div></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const code = (url.searchParams.get("c") || url.pathname.split("/").filter(Boolean).pop() || "").trim();
  if (!/^[A-Za-z0-9]{8,16}$/.test(code)) return page("Invoice not found", "Please check the link, or message us on WhatsApp for a new one.", 404);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: row, error } = await sb.from("pb_invoice_files").select("path, file_name").eq("code", code).maybeSingle();
  if (error) { console.error(error.message); return page("Something went wrong", "Please try again in a moment.", 500); }
  if (!row) return page("Invoice not found", "This link is no longer valid. Please message us on WhatsApp for a new one.", 404);

  const { data: file, error: dlErr } = await sb.storage.from("invoices").download(row.path);
  if (dlErr || !file) { console.error(dlErr?.message); return page("Invoice unavailable", "Please message us on WhatsApp and we'll resend it.", 404); }
  const name = String(row.file_name).replace(/[^A-Za-z0-9 ._-]/g, "-");
  return new Response(req.method === "HEAD" ? null : file.stream(), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
});

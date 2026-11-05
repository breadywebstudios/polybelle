// Short photo link: https://www.polybelle.me/p/<code>  (vercel.json rewrites /p/:code to this function)
// <code> is the first 8 characters of a gallery photo's or hall's id (e.g. 2c556676), or "other" for Other venues.
// It shows the photo on a small Polybelle page, and its link-preview tags make WhatsApp show the photo in the chat.
const SB_URL = "https://ntohdxudxfggsmhxhvho.supabase.co";
const SB_KEY = "sb_publishable_81P5_TSD4SuHALFDM4Ao-w_W7C5UkuI";   // public key, the same one the website uses
const SITE = "https://www.polybelle.me";
const FALLBACK_WA = "971528653208";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sb(path, init) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, "content-type": "application/json", ...(init && init.headers) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
// rows whose uuid starts with the 8-character code
const byPrefix = (table, cols, code) =>
  sb(`${table}?select=${cols}&active=eq.true&id=gte.${code}-0000-0000-0000-000000000000&id=lte.${code}-ffff-ffff-ffff-ffffffffffff&limit=1`);

async function findPhoto(code) {
  if (code === "other") {
    const o = await sb("rpc/pb_public_other_venue", { method: "POST", body: "{}" }).catch(() => null);
    if (o && o.show !== false && o.image) return { src: o.image, title: o.name || "Other venues", sub: o.tagline || "At your location", back: "#venues" };
    return null;
  }
  const [g] = await byPrefix("pb_gallery", "image_url,caption,category", code);
  if (g) return { src: g.image_url, title: g.caption || g.category || "Event photo", sub: g.caption && g.category ? g.category : "Event photo", back: "#gallery" };
  const [v] = await byPrefix("pb_venues", "name,capacity,image_url", code);
  if (v && v.image_url) return { src: v.image_url, title: v.name, sub: v.capacity != null ? `Event hall · up to ${v.capacity} guests` : "Event hall", back: "#venues" };
  return null;
}

function page({ status, title, sub, src, back, wa, code }) {
  const found = status === 200;
  const heading = found ? `${title}${sub ? ` · ${sub}` : ""}` : "Photo not found";
  const short = `www.polybelle.me/p/${code}`;
  const ask = `Hi Polybelle! I'd like to ask about this photo from your website (${heading}):\n${short}`;
  const ogImg = src || `${SITE}/assets/og-image.jpg`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)} | Polybelle Events</title>
<meta name="robots" content="noindex">
<meta name="description" content="${esc(found ? "A celebration styled by Polybelle Event Halls & Studio, Abu Dhabi." : "This photo is no longer on our website.")}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Polybelle Events">
<meta property="og:title" content="${esc(heading)} | Polybelle Events">
<meta property="og:description" content="Polybelle Event Halls &amp; Studio · Abu Dhabi">
<meta property="og:url" content="${SITE}/p/${esc(code)}">
<meta property="og:image" content="${esc(ogImg)}">
<meta property="og:image:alt" content="${esc(heading)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Jost:wght@400;500&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#FAF6F1;color:#2B211D;font:16px/1.6 Jost,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:28px 16px 40px}
.mark{text-decoration:none;color:#B8923E;font:500 26px/1 "Cormorant Garamond",Georgia,serif;letter-spacing:.32em;text-align:center}
.mark small{display:block;margin-top:8px;font:500 10px/1 Jost,sans-serif;letter-spacing:.28em;color:#7a6a5e}
figure{margin:26px 0 0;width:100%;max-width:760px;text-align:center}
img{display:block;width:100%;max-height:72vh;object-fit:contain;border-radius:6px;background:#efe6da;box-shadow:0 10px 30px rgba(43,33,29,.12)}
h1{font:500 clamp(24px,5vw,32px)/1.2 "Cormorant Garamond",Georgia,serif;margin:20px 0 4px}
p{margin:0;color:#7a6a5e}
.acts{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:22px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border:1px solid #2B211D;color:#2B211D;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:.14em;text-transform:uppercase}
.btn.wa{background:#0B6B4F;border-color:#0B6B4F;color:#fff}.btn svg{width:17px;height:17px}
.btn:hover{opacity:.88}
</style></head><body>
<a class="mark" href="${SITE}">POLYBELLE<small>EVENT HALLS &amp; STUDIO · ABU DHABI</small></a>
<figure>
${found ? `<img src="${esc(src)}" alt="${esc(heading)}">` : ""}
<h1>${esc(found ? title : "Photo not found")}</h1>
<p>${esc(found ? sub : "This photo is no longer on our website. Browse our latest events below.")}</p>
<div class="acts">
${found ? `<a class="btn wa" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(ask)}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.1Z"/></svg>Ask about this</a>` : ""}
<a class="btn" href="${SITE}/${back || "#gallery"}">${found && back === "#venues" ? "See our halls" : "See more events"}</a>
<a class="btn" href="${SITE}/#book">Reserve your date</a>
</div>
</figure>
</body></html>`;
}

module.exports = async (req, res) => {
  const code = String((req.query && req.query.c) || "").toLowerCase().trim();
  let photo = null, wa = FALLBACK_WA, failed = false;
  if (/^([0-9a-f]{8}|other)$/.test(code)) {
    try {
      const [p, s] = await Promise.all([findPhoto(code), sb("rpc/pb_public_settings", { method: "POST", body: "{}" }).catch(() => null)]);
      photo = p;
      const num = String((s && s[0] && s[0].booking_whatsapp) || "").replace(/\D/g, "");
      if (num) wa = num.startsWith("0") ? "971" + num.slice(1) : num;
    } catch (e) { console.error(e); failed = true; }
  }
  const status = photo ? 200 : failed ? 503 : 404;
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("x-robots-tag", "noindex");
  res.setHeader("cache-control", photo ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store");
  res.end(page({ status, code: code || "", wa, ...(photo || {}) }));
};

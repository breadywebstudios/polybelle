(() => {
  const C = window.PB_CONFIG;
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STATUSES = ["Pending", "Confirmed", "Completed", "Cancelled"];
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const fmtStamp = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
  const intl = (n) => { let d = String(n || "").replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.startsWith("0")) d = "971" + d.slice(1); else if (d.length === 9 && d.startsWith("5")) d = "971" + d; return d; };
  // tidy WhatsApp text: swap typographic dashes/quotes for plain ones (emojis are kept)
  const waClean = (t) => String(t)
    .replace(/[\u2013\u2014\u2012\u2212]/g, "-").replace(/[\u00B7\u2022\u2219]/g, "-")
    .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, "...").replace(/\u00D7/g, "x")
    .replace(/[\u00A0\u2009\u202F]/g, " ")
    .replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
  // api.whatsapp.com keeps emojis intact (the short wa.me redirect can garble them in WhatsApp Desktop/Web)
  const waLink = (num, text) => `https://api.whatsapp.com/send?phone=${intl(num)}${text ? "&text=" + encodeURIComponent(waClean(text)) : ""}`;
  const S = { bookings: [], venues: [], admins: [], promos: [], statusFilter: "", user: null };

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); }

  // Shrink photos in the browser before uploading: fits within maxSide px and saves as WebP
  // (JPEG on browsers that can't make WebP). Keeps the original if it's already smaller or can't be read.
  const MAX_ORIGINAL = 25 * 1024 * 1024;
  async function shrinkImage(file, maxSide = 1600, quality = 0.8) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
      const toBlob = (c, type) => new Promise((r) => c.toBlob(r, type, quality));
      let blob = await toBlob(cv, "image/webp");
      if (!blob || blob.type !== "image/webp") {
        const flat = document.createElement("canvas"); flat.width = w; flat.height = h;
        const fx = flat.getContext("2d"); fx.fillStyle = "#fff"; fx.fillRect(0, 0, w, h); fx.drawImage(cv, 0, 0);
        blob = await toBlob(flat, "image/jpeg");
      }
      if (!blob || blob.size >= file.size) return file;
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + ext, { type: blob.type });
    } catch { return file; }
  }
  // Photo framing: which part of a photo shows in its website card (CSS position "x% y%")
  const posOk = (p) => (/^(100|\d{1,2})% (100|\d{1,2})%$/.test(p || "") ? p : "");
  const isGoogleMapsUrl = (value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (
        /^maps\.google\.(?:[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/.test(host) ||
        /^www\.google\.(?:[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/.test(host) && /^\/maps(?:\/|$)/.test(url.pathname) ||
        host === "maps.app.goo.gl" ||
        host === "goo.gl" && url.pathname.startsWith("/maps")
      );
    } catch {
      return false;
    }
  };
  const googleMapsInputUrl = (value) => {
    const input = value.trim();
    if (!input) return "";
    const iframeSrc = new DOMParser().parseFromString(input, "text/html").querySelector("iframe")?.getAttribute("src");
    return iframeSrc || input;
  };
  const frameBlock = (id, url, pos, shape) => `
        <div class="frame-wrap">
          <div class="preview-img frame ${shape}" id="${id}" tabindex="0" role="img" aria-label="Photo framing. Drag, or use the arrow keys, to choose what shows."
            style="${url ? `background-image:url('${esc(url)}');` : ""}background-position:${posOk(pos) || "50% 50%"}"></div>
          <p class="frame-hint" ${url ? "" : "hidden"}><span>Drag the photo to choose what shows on the website card.</span><button type="button" class="linkbtn" data-frame-reset>Center</button></p>
        </div>
        <input type="hidden" name="image_pos" value="${esc(posOk(pos))}">`;
  function wireFramer(el, form) {
    let nat = null, drag = null;
    const hint = el.parentElement.querySelector(".frame-hint");
    const imageField = form.elements.namedItem("image_url") || form.elements.namedItem("image");
    const positionField = form.elements.namedItem("image_pos");
    const cur = () => (posOk(positionField.value) || "50% 50%").split(" ").map(parseFloat);
    const clamp = (n) => Math.min(100, Math.max(0, n));
    const apply = (x, y) => {
      const v = `${Math.round(clamp(x))}% ${Math.round(clamp(y))}%`;
      positionField.value = v === "50% 50%" ? "" : v; el.style.backgroundPosition = v;
    };
    const span = () => {
      const W = el.clientWidth, H = el.clientHeight, s = Math.max(W / nat[0], H / nat[1]);
      return [nat[0] * s - W, nat[1] * s - H];
    };
    const load = () => {
      nat = null; const u = imageField.value;
      el.classList.toggle("has-img", !!u); hint.hidden = !u;
      if (!u) return;
      const im = new Image(); im.onload = () => { if (imageField.value === u) nat = [im.naturalWidth, im.naturalHeight]; }; im.src = u;
    };
    el.addEventListener("pointerdown", (e) => {
      if (!nat) return; e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
      const [px, py] = cur(); drag = { x: e.clientX, y: e.clientY, px, py }; el.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const [ox, oy] = span();
      apply(ox > 1 ? drag.px - ((e.clientX - drag.x) / ox) * 100 : 50, oy > 1 ? drag.py - ((e.clientY - drag.y) / oy) * 100 : 50);
    });
    const end = () => { drag = null; el.classList.remove("dragging"); };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: [4, 0], ArrowRight: [-4, 0], ArrowUp: [0, 4], ArrowDown: [0, -4] }[e.key];
      if (!k || !nat) return; e.preventDefault();
      const [ox, oy] = span(), [x, y] = cur();
      apply(ox > 1 ? x + k[0] : 50, oy > 1 ? y + k[1] : 50);
    });
    hint.querySelector("[data-frame-reset]").addEventListener("click", () => apply(50, 50));
    load();
    return { newPhoto(url) { el.style.backgroundImage = `url('${url}')`; apply(50, 50); load(); } };
  }

  async function prepPhoto(f, maxSide) {
    if (f.size > MAX_ORIGINAL) { toast("Photo is over 25 MB — please use a smaller one."); return null; }
    const out = await shrinkImage(f, maxSide);
    if (out.size > 5 * 1024 * 1024) { toast("Photo is still over 5 MB after resizing — please use a smaller one."); return null; }
    return out;
  }
  function setMsg(el, text, kind) { el.textContent = text || ""; el.className = "msg" + (text ? " " + kind : ""); }

  // ---------------- auth
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) return enter(session.user);
    showLogin();
  }
  function showLogin() { $("#loginView").style.display = ""; $("#appView").classList.remove("on"); }

  async function enter(user) {
    const { data: ok, error } = await sb.rpc("pb_is_admin");
    if (error || !ok) {
      await sb.auth.signOut();
      showLogin();
      return setMsg($("#loginMsg"), "This account doesn't have Polybelle admin access.", "err");
    }
    S.user = user;
    $("#whoEmail").textContent = user.email;
    $("#loginView").style.display = "none";
    $("#appView").classList.add("on");
    await Promise.all([loadVenues(), loadBookings(), loadSettings(), loadAdmins(), loadGallery(), loadReviews(), loadServices(), loadPromos()]);
    setInterval(() => { if (!document.hidden) loadBookings(true); }, 60000);
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setMsg($("#loginMsg"), "");
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: fd.get("email").trim(), password: fd.get("password") });
    btn.disabled = false;
    if (error) return setMsg($("#loginMsg"), error.message === "Invalid login credentials" ? "Wrong email or password." : error.message, "err");
    enter(data.user);
  });
  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  // ---------------- tabs
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".panel").forEach((p) => p.classList.toggle("on", p.id === "tab-" + b.dataset.tab));
  }));

  // ---------------- bookings
  async function loadBookings(quiet) {
    const [{ data, error }, { data: promos, error: promoError }] = await Promise.all([
      sb.from("pb_bookings").select("*").order("event_date", { ascending: true }).limit(2000),
      sb.from("pb_promo_redemptions").select("booking_ref,promo_code,discount_type,discount_value,required_item")
    ]);
    if (error) { if (!quiet) toast("Couldn't load bookings: " + error.message); return; }
    if (promoError) console.error("Couldn't load booking promotions:", promoError.message);
    const promoByBooking = new Map((promos || []).map((promo) => [promo.booking_ref, promo]));
    const bookings = data.map((booking) => ({ ...booking, promo: promoByBooking.get(booking.ref) || null }));
    const newPending = S.bookings.length && bookings.filter((b) => b.status === "Pending" && !S.bookings.some((o) => o.id === b.id)).length;
    S.bookings = bookings;
    renderBookings();
    if (quiet && newPending) toast(`${newPending} new booking request${newPending > 1 ? "s" : ""}`);
  }

  // ---------- overlaps (ignores cancelled bookings)
  const sessOverlap = (a, b) => a === b || a === "Whole day" || b === "Whole day";
  // a hall plus the halls it shares space with (either direction), e.g. "Hall A&B" ↔ "Hall B"
  function linkedHalls(id) {
    const v = S.venues.find((x) => x.id === id);
    return new Set([id, ...(v?.shares_with || []), ...S.venues.filter((x) => (x.shares_with || []).includes(id)).map((x) => x.id)]);
  }
  function overlapsFor(b) {
    const res = { clash: [], hallDay: [], occasion: [] };
    if (b.status === "Cancelled") return res;
    S.bookings.forEach((o) => {
      if (o.id === b.id || o.status === "Cancelled" || o.event_date !== b.event_date) return;
      const sameHall = !isServices(b) && !isServices(o) && o.venue_id && b.venue_id && linkedHalls(b.venue_id).has(o.venue_id);
      if (sameHall && sessOverlap(o.session, b.session)) res.clash.push(o);
      else if (sameHall) res.hallDay.push(o);
      if ((o.event_type || "").toLowerCase() === (b.event_type || "").toLowerCase()) res.occasion.push(o);
    });
    return res;
  }
  const hasOverlap = (b) => { const o = overlapsFor(b); return o.clash.length + o.hallDay.length + o.occasion.length > 0; };
  function overlapBadges(b) {
    const o = overlapsFor(b), refs = (l) => l.map((x) => `${x.ref} (${x.name}, ${x.session})`).join(", ");
    return [
      o.clash.length ? `<span class="ov ov-clash" title="Same or shared hall, overlapping session: ${esc(refs(o.clash))}">Hall clash</span>` : "",
      o.hallDay.length ? `<span class="ov ov-hall" title="Same or shared hall, same day: ${esc(refs(o.hallDay))}">Same hall</span>` : "",
      o.occasion.length ? `<span class="ov ov-occ" title="Same occasion, same day: ${esc(refs(o.occasion))}">Same occasion</span>` : ""
    ].join("");
  }

  function filtered() {
    const q = $("#q").value.trim().toLowerCase();
    const v = $("#fVenue").value, when = $("#fWhen").value, t = today();
    let list = S.bookings.filter((b) =>
      (!S.statusFilter || (S.statusFilter === "__overlap" ? hasOverlap(b) : b.status === S.statusFilter)) &&
      (!v || (v === "__services" ? isServices(b) : b.venue_id === v)) &&
      (when === "all" || (when === "upcoming" ? b.event_date >= t : b.event_date < t)) &&
      (!q || [b.ref, b.name, b.phone, b.email, b.venue_name, b.event_location, b.event_type].join(" ").toLowerCase().includes(q)));
    if ($("#fSort").value === "new") list = list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (when === "past") list = list.slice().reverse();
    return list;
  }

  // ---------- calendar (per hall, all statuses)
  const today0 = today();
  const AC = { hall: "", y: +today0.slice(0, 4), m: +today0.slice(5, 7) - 1, sel: null };
  const acIso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const SESS_SHORT = { Morning: "AM", Afternoon: "PM", Evening: "Eve", "Whole day": "All day" };
  const SESS_RANK = { Morning: 1, Afternoon: 2, Evening: 3, "Whole day": 0 };
  function acBookings(date) {
    const showCx = $("#acCancelled").checked;
    return S.bookings.filter((b) => b.event_date === date && (showCx || b.status !== "Cancelled") &&
      (!AC.hall || (AC.hall === "__services" ? isServices(b) : b.venue_id === AC.hall)))
      .sort((a, b) => (SESS_RANK[a.session] ?? 9) - (SESS_RANK[b.session] ?? 9));
  }
  function renderAdminCal() {
    const sel = $("#acHall");
    sel.innerHTML = `<option value="">All halls</option>` + S.venues.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("") + `<option value="__services">Other venues (customer's location)</option>`;
    sel.value = AC.hall;
    $("#acTitle").textContent = new Date(Date.UTC(AC.y, AC.m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const lead = (new Date(Date.UTC(AC.y, AC.m, 1)).getUTCDay() + 6) % 7, days = new Date(Date.UTC(AC.y, AC.m + 1, 0)).getUTCDate(), t = today();
    let html = '<div class="ac-blank"></div>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const iso = acIso(AC.y, AC.m, d), list = acBookings(iso);
      html += `<div class="ac-d ${iso === t ? "today" : ""} ${iso < t ? "past" : ""} ${iso === AC.sel ? "sel" : ""}" data-d="${iso}" role="button" tabindex="0" aria-label="${esc(fmtDate(iso))}: ${list.length} booking${list.length === 1 ? "" : "s"}">
        <span class="ac-top"><span class="ac-n">${d}</span>${iso >= t ? `<button type="button" class="ac-add" data-add="${iso}" aria-label="Add booking on ${esc(fmtDate(iso))}" title="Add booking">+</button>` : ""}</span>
        <div class="ac-chips">${list.map((b) => `<button type="button" class="ac-chip c-${b.status} ${overlapsFor(b).clash.length ? "clash" : ""}" data-id="${b.id}" title="${esc(`${b.session} · ${b.name} · ${whereText(b)} · ${b.status}`)}"><b>${SESS_SHORT[b.session] || esc(b.session)}</b> ${esc(b.name)}${isServices(b) ? ` <small class="ac-loc">📍 ${esc(b.event_location || "Location TBC")}</small>` : AC.hall ? "" : ` <small>${esc(b.venue_name)}</small>`}</button>`).join("")}</div>
        ${list.length ? `<span class="ac-dots">${list.map((b) => `<i class="c-${b.status} ${overlapsFor(b).clash.length ? "clash" : ""}"></i>`).join("")}</span>` : ""}
      </div>`;
    }
    $("#acGrid").innerHTML = html;
    $$("#acGrid .ac-chip").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); openBooking(fresh(c.dataset.id)); }));
    $$("#acGrid .ac-add").forEach((c) => c.addEventListener("click", (e) => { e.stopPropagation(); addBookingOn(c.dataset.add); }));
    $$("#acGrid .ac-d").forEach((c) => {
      const pick = () => { AC.sel = c.dataset.d; renderAdminCal(); };
      c.addEventListener("click", pick);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    renderAdminCalDay();
  }
  // new booking for a day, with the calendar's hall filter carried over
  function addBookingOn(date) {
    const hall = S.venues.find((v) => v.id === AC.hall);
    openBookingForm(null, { event_date: date, ...(hall ? { venue_id: hall.id } : AC.hall === "__services" ? { venue_id: null } : {}) });
  }
  function renderAdminCalDay() {
    const box = $("#acDay");
    if (!AC.sel) { box.innerHTML = `<p class="hint" style="margin:0">Tap a day to see its bookings or add one.</p>`; return; }
    const list = acBookings(AC.sel), hall = S.venues.find((v) => v.id === AC.hall);
    const other = AC.hall === "__services";
    const shared = hall ? linkedHalls(hall.id) : null;
    const live = (hall ? S.bookings.filter((b) => b.event_date === AC.sel && shared.has(b.venue_id)) : list)
      .filter((b) => b.status !== "Cancelled" && (other ? isServices(b) : !isServices(b)));
    const hits = (sess, pool) => pool.some((b) => b.session === sess || b.session === "Whole day" || sess === "Whole day");
    const confirmed = live.filter((b) => b.status === "Confirmed" || b.status === "Completed");
    box.innerHTML = `
      <div class="acd-head"><div><span class="eyebrow">${esc(other ? "Other venues" : hall ? hall.name : "All halls")}</span><h3>${esc(fmtDate(AC.sel))}</h3></div>
        <button type="button" class="btn btn-primary sm" id="acAdd">+ Add booking</button></div>
      ${hall || other ? `<div class="acd-sess">${C.sessions.map((x) => { const st = hits(x.id, confirmed) ? "bk" : hits(x.id, live) ? "rq" : "";
          return `<span class="${st}">${esc(x.id)} · ${st === "bk" ? "Booked" : st === "rq" ? "Requested" : "Free"}</span>`; }).join("")}</div>` : ""}
      ${list.length ? `<ul class="acd-list">${list.map((b) => `<li><button type="button" class="linkbtn" data-id="${b.id}">${esc(b.ref)}</button>
          <span>${esc(b.session)}</span><span>${esc(b.name)}</span><span>${isServices(b) ? `Other venues<small class="ac-loc">📍 ${esc(b.event_location || "Location not given yet")}</small>` : esc(b.venue_name)}</span><span>${esc(b.event_type)}</span>
          <span class="badge b-${b.status}">${b.status}</span>${overlapBadges(b)}</li>`).join("")}</ul>` : `<p class="hint" style="margin:0">No bookings on this day.</p>`}`;
    $$("#acDay [data-id]").forEach((x) => x.addEventListener("click", () => openBooking(fresh(x.dataset.id))));
    $("#acAdd").addEventListener("click", () => addBookingOn(AC.sel));
  }
  $("#acHall").addEventListener("change", (e) => { AC.hall = e.target.value; renderAdminCal(); });
  $("#acCancelled").addEventListener("change", renderAdminCal);
  $("#acPrev").addEventListener("click", () => { AC.m--; if (AC.m < 0) { AC.m = 11; AC.y--; } renderAdminCal(); });
  $("#acNext").addEventListener("click", () => { AC.m++; if (AC.m > 11) { AC.m = 0; AC.y++; } renderAdminCal(); });
  $("#acToday").addEventListener("click", () => { const t = today(); AC.y = +t.slice(0, 4); AC.m = +t.slice(5, 7) - 1; AC.sel = t; renderAdminCal(); });

  function renderBookings() {
    renderAdminCal();
    const t = today();
    const up = S.bookings.filter((b) => b.event_date >= t);
    const count = (s) => up.filter((b) => b.status === s).length;
    const stats = [["", "Upcoming", up.length], ["Pending", "Pending", count("Pending")], ["Confirmed", "Confirmed", count("Confirmed")],
      ["Completed", "Completed", S.bookings.filter((b) => b.status === "Completed").length], ["Cancelled", "Cancelled", S.bookings.filter((b) => b.status === "Cancelled").length],
      ["__overlap", "Overlaps", up.filter(hasOverlap).length]];
    $("#stats").innerHTML = stats.map(([k, label, n]) => `<button class="stat ${S.statusFilter === k ? "active" : ""} ${k === "__overlap" && n ? "stat-warn" : ""}" data-k="${k}"><span>${label}</span><b>${n}</b></button>`).join("")
      + `<button class="stat" id="newBookingBtn" style="display:grid;place-items:center;border-style:dashed"><span style="color:var(--rose)">+ Add booking</span></button>`;
    $$("#stats .stat[data-k]").forEach((b) => b.addEventListener("click", () => {
      S.statusFilter = b.dataset.k;
      if (["Completed", "Cancelled"].includes(b.dataset.k)) $("#fWhen").value = "all";
      renderBookings();
    }));
    $("#newBookingBtn").addEventListener("click", () => openBooking(null));

    const list = filtered();
    $("#rows").innerHTML = list.length ? list.map((b) => { const ov = overlapsFor(b); return `
      <tr class="row ${ov.clash.length ? "row-clash" : ov.hallDay.length || ov.occasion.length ? "row-warn" : ""}" data-id="${b.id}">
        <td><b>${esc(fmtDate(b.event_date))}</b><small>${esc(b.session)}</small></td>
        <td>${isServices(b) ? `Other venues<small>${esc(b.event_location || "Location not given yet")}</small>` : esc(b.venue_name)}</td>
        <td>${esc(b.name)}<small>${esc(b.phone)}</small></td>
        <td class="hide-sm">${esc(b.event_type)}</td>
        <td class="hide-sm">${b.guests ?? "—"}</td>
        <td><span class="badge b-${b.status}">${b.status}</span><div class="ovs">${overlapBadges(b)}</div></td>
        <td class="hide-sm"><small>${esc(b.ref)}</small><small>${fmtStamp(b.created_at)}</small></td>
      </tr>`; }).join("") : `<tr><td colspan="7" class="empty">No bookings match these filters.</td></tr>`;
    $$("#rows tr.row").forEach((r) => r.addEventListener("click", () => openBooking(S.bookings.find((b) => b.id === r.dataset.id))));
  }
  ["#q", "#fVenue", "#fWhen", "#fSort"].forEach((s) => $(s).addEventListener("input", renderBookings));
  $("#refreshBtn").addEventListener("click", () => loadBookings().then(() => toast("Bookings refreshed")));

  $("#csvBtn").addEventListener("click", () => {
    const cols = ["ref", "status", "booking_type", "event_date", "session", "venue_name", "event_location", "event_type", "guests", "add_ons", "custom_items", "name", "phone", "email", "notes", "admin_notes", "created_at"];
    const cell = (v) => Array.isArray(v) && v.length && typeof v[0] === "object" ? cell(v.map((c) => `${ciText(c)} @ ${c.price} = ${ciTotal(c)}`)) : `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...filtered().map((b) => cols.map((c) => cell(b[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `polybelle-bookings-${today()}.csv`; a.click();
  });

  // drawers
  function openDrawer(id) { $("#drawerBg").classList.add("open"); $(id).classList.add("open"); }
  function closeDrawers() { $("#drawerBg").classList.remove("open"); $$(".drawer").forEach((d) => d.classList.remove("open")); }
  $("#drawerBg").addEventListener("click", closeDrawers);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawers(); });

  // full booking summary for the "WhatsApp customer" button
  const hallAddress = (b) => (S.venues || []).find((v) => v.id === b.venue_id)?.venue_address || "";
  // TEMPORARY test icon: sends the same customer message to the test number (config.js → whatsappIconNumber)
  const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.4.2.5.3.1.2.1.7-.1 1.3Z"/></svg>';
  const waTest = (text) => {
    const num = String(C.whatsappIconNumber || "").replace(/\D/g, "");
    return num ? `<a class="wa-test" target="_blank" rel="noopener" href="${waLink(num, text)}" title="Test: send this message to ${esc(num.replace(/^971/, "0"))}" aria-label="Test: send this message to the test number">${WA_ICON}</a>` : "";
  };
  // WhatsApp turns dates, times, phone numbers and addresses into green tappable links. An invisible
  // "word joiner" after each digit stops that, so those details show in normal text colour.
  const plain = (x) => String(x ?? "").replace(/\d/g, "$&\u2060");
  function customerMsg(b, status) {
    const sess = C.sessions.find((x) => x.id === b.session);
    const t = invTotals(b);
    const hasInvoice = !!b.invoice_no || t.total > 0;
    const details = [
      `🔖 *Booking Ref:* ${plain(b.ref)}`,
      ``,
      isServices(b) ? `🏡 *Venue:* Other venues (packages & services)` : `🏢 *Hall:* ${b.venue_name}`,
      !isServices(b) && hallAddress(b) ? `📍 *Hall address:* ${plain(hallAddress(b))}` : null,
      isServices(b) ? `📍 *Event location:* ${plain(b.event_location || "To be confirmed")}` : null,
      `📅 *Date:* ${plain(fmtDate(b.event_date))}`,
      `⏰ *Session:* ${b.session}${sess ? ` (${plain(sess.time)})` : ""}`,
      `🎈 *Occasion:* ${b.event_type}`,
      b.guests ? `👥 *Guests:* ${b.guests}` : null,
      b.add_ons?.length ? `\n🎁 *Packages & services:*\n${b.add_ons.map((a) => `🔹 ${a}`).join("\n")}` : null,
      b.custom_items?.length ? `\n➕ *Additional items:*\n${b.custom_items.map((c) => `🔹 ${ciText(c)}${ciTotal(c) ? ` (AED ${plain(money(ciTotal(c)))})` : ""}`).join("\n")}` : null,
      b.notes ? `\n📝 *Your notes:* ${b.notes}` : null,
      hasInvoice ? [
        ``,
        b.invoice_no ? `🧾 *Invoice No:* ${plain(b.invoice_no)}` : null,
        +b.discount ? `💸 *Discount:* AED ${plain(money(b.discount))}` : null,
        `💰 *Total:* AED ${plain(money(t.total))}`,
        t.paid ? `✅ *Paid:* AED ${plain(money(t.paid))}` : null,
        `⏳ *Balance due:* AED ${plain(money(t.balance))}`
      ].filter((l) => l !== null).join("\n") : null
    ].filter((l) => l !== null).join("\n");
    const pay = hasInvoice && t.balance > 0 && S.settings?.payment_details ? `\n\n🏦 *Payment details:*\n${S.settings.payment_details}` : "";
    const intro = {
      Confirmed: `Hi ${b.name}! 🎉 Your booking at Polybelle Event Halls & Studio is *CONFIRMED*.`,
      Pending: `Hi ${b.name}! Thank you for your booking request at Polybelle Event Halls & Studio 💛 Here are the details we received:`,
      Completed: `Hi ${b.name}! Thank you for celebrating with Polybelle Event Halls & Studio 💛 Here is a summary of your event:`,
      Updated: `Hi ${b.name}! Your booking at Polybelle Event Halls & Studio has been updated ✨ Here are the latest details:`,
      Cancelled: `Hi ${b.name}, regarding your booking request at Polybelle Event Halls & Studio: unfortunately we're unable to accommodate it on this date. 😔`
    }[status] || "";
    const outro = {
      Confirmed: `Thank you for choosing Polybelle! 💛 Message us anytime if you have questions.`,
      Pending: `⏳ We're checking availability and will get back to you shortly.`,
      Completed: `We'd love to hear how it went, and hope to celebrate with you again soon!`,
      Updated: `Please let us know if anything needs changing. Thank you for choosing Polybelle! 💛`,
      Cancelled: `Please message us and we'll gladly help you find another date or hall. 💛`
    }[status] || "";
    return `${intro}\n\n${details}${status === "Cancelled" ? "" : pay}\n\n${outro}`;
  }

  const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // customer-facing invoice summary for "Send invoice to customer"
  function invoiceMsg(b, docType = "Invoice", pdfUrl = "") {
    const t = invTotals(b);
    const sess = C.sessions.find((x) => x.id === b.session);
    const issue = new Date((b.invoice_date || today()) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const items = (b.invoice_items || []).filter((it) => it.description || it.amount);
    return [
      `Hi ${b.name}! 🧾 Here is your *${docType}* from Polybelle Event Halls & Studio.`,
      ``,
      `🧾 *${docType} No:* ${plain(b.invoice_no)}`,
      `📅 *Issue date:* ${plain(issue)}`,
      `🔖 *Booking Ref:* ${plain(b.ref)}`,
      `🎈 *Event:* ${whereText(b)} · ${b.event_type}`,
      `📆 *Date:* ${plain(fmtDate(b.event_date))}`,
      `⏰ *Session:* ${b.session}${sess ? ` (${plain(sess.time)})` : ""}`,
      b.guests ? `👥 *Guests:* ${b.guests}` : null,
      items.length ? `\n🎁 *Items:*\n${items.map((it) => `🔹 ${it.description}${it.amount ? ` — AED ${plain(money(it.amount))}` : ""}`).join("\n")}` : null,
      +b.discount ? `\n🧮 *Subtotal:* AED ${plain(money(t.subtotal))}\n💸 *Discount:* − AED ${plain(money(b.discount))}` : null,
      `\n💰 *Total:* AED ${plain(money(t.total))}`,
      t.paid ? `✅ *Paid:* AED ${plain(money(t.paid))}` : null,
      `⏳ *Balance due:* AED ${plain(money(t.balance))}`,
      b.invoice_notes ? `\n📝 *Note:* ${b.invoice_notes}` : null,
      t.balance > 0 && S.settings?.payment_details ? `\n🏦 *Payment details:*\n${S.settings.payment_details}` : null,
      pdfUrl ? `\n📄 *${docType} PDF:* ${pdfUrl}` : null,
      ``,
      `Please reply here if you have any questions. Thank you! 💛`
    ].filter((l) => l !== null).join("\n");
  }

  // A4 PDF of the invoice/receipt, drawn as real text (crisp, small, selectable) with the same layout,
  // sizes, colours and fonts as the printable invoice (Save & open invoice). Fonts: assets/fonts/pdf/*.ttf
  const PDF_FONTS = [
    ["Montserrat-Regular.ttf", "Montserrat", "normal"], ["Montserrat-SemiBold.ttf", "Montserrat", "bold"],
    ["Lora-SemiBold.ttf", "Lora", "bold"], ["CormorantGaramond-Medium.ttf", "Cormorant", "normal"]
  ];
  let pdfFontData = null;
  async function loadPdfFonts() {
    if (pdfFontData) return pdfFontData;
    const toB64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
    pdfFontData = await Promise.all(PDF_FONTS.map(async ([file, fam, style]) => {
      const r = await fetch(`assets/fonts/pdf/${file}`);
      if (!r.ok) throw new Error(`font ${file} not found`);
      return [file, fam, style, toB64(await r.arrayBuffer())];
    }));
    return pdfFontData;
  }
  async function invoicePdf(b, docType) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) return null;
    try {
      const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
      let fontsOk = true;
      try { (await loadPdfFonts()).forEach(([file, fam, style, data]) => { pdf.addFileToVFS(file, data); pdf.addFont(file, fam, style); }); }
      catch (err) { console.error("PDF fonts didn't load, using built-in fonts:", err); fontsOk = false; }
      const F = fontsOk ? { body: "Montserrat", head: "Lora", logo: "Cormorant" } : { body: "helvetica", head: "times", logo: "times" };
      const s = S.settings || {}, t = invTotals(b), isReceipt = docType === "Receipt";
      const sess = C.sessions.find((x) => x.id === b.session);
      const issue = new Date((b.invoice_date || today()) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      // only characters the PDF fonts carry (emoji and unsupported scripts are dropped)
      const clean = (x) => String(x ?? "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️‍]/gu, "").replace(/−/g, fontsOk ? "−" : "-");
      const px = (n) => n * 0.2646, pt = (n) => n * 0.75;           // CSS px -> mm / pt (96 dpi)
      const GOLD = [184, 146, 62], INK = [43, 43, 43], L = 18, R = 192, W = R - L, BOTTOM = 297 - 16;
      const font = (fam, style, sizePx, color = INK) => { pdf.setFont(fam, style); pdf.setFontSize(pt(sizePx)); pdf.setTextColor(...color); };
      const lh = (sizePx) => px(sizePx * 1.45);
      let y = 20;
      const page = (need) => { if (y + need > BOTTOM) { pdf.addPage(); y = 20; } };
      const lines = (txt, x, width, sizePx, opts = {}) => {
        const out = []; clean(txt).split("\n").forEach((ln) => out.push(...(width ? pdf.splitTextToSize(ln, width) : [ln])));
        out.forEach((ln) => { pdf.text(ln, x, y, { baseline: "top", ...opts }); y += lh(sizePx); });
        return out.length;
      };
      // top: logo + tagline (left), business name & address (right)
      font(F.logo, "normal", 40, GOLD);
      pdf.text("POLYBELLE", L, y, { baseline: "top", charSpace: px(40 * 0.26) });
      font(F.body, "bold", 7.6, GOLD);
      pdf.text("MAKING MEMORABLE MEMORIES, ONE MILESTONE AT A TIME", L, y + px(40) + px(6), { baseline: "top", charSpace: px(7.6 * 0.06) });
      // right column (business address + event details): 62mm wide, or wider if a line needs it
      const eventLines = `${isServices(b) ? whereText(b) : b.venue_name} · ${b.event_type}\n${fmtDate(b.event_date)}\n${b.session}${sess ? ` (${sess.time})` : ""}${b.guests ? ` · ${b.guests} guests` : ""}`;
      const widest = (txt, sizePx, fam = F.body) => { pdf.setFont(fam, "normal"); pdf.setFontSize(pt(sizePx)); return Math.max(0, ...clean(txt).split("\n").map((l) => pdf.getTextWidth(l))); };
      const BX = Math.max(L + 70, Math.min(130, R - Math.max(widest([s.business_name, s.business_address].filter(Boolean).join("\n"), 11.5), widest(eventLines, 12.5)) - 1));
      font(F.body, "normal", 11.5);
      const y0 = y; lines([s.business_name, s.business_address].filter(Boolean).join("\n"), BX, R - BX, 11.5);
      y = Math.max(y, y0 + px(40) + px(6) + px(11));
      // invoice details (left) + event details (right)
      const head = (txt, x) => { font(F.head, "bold", 13.5, GOLD); pdf.text(clean(txt).toUpperCase(), x, y, { baseline: "top", charSpace: px(13.5 * 0.06) }); };
      y += px(26); const ySec = y;
      head(docType, L); y += px(13.5 * 1.45) + px(3); font(F.body, "normal", 12.5);
      lines(`No: ${b.invoice_no || ""}\nIssue Date: ${issue}\nBooking Ref: ${b.ref}`, L, BX - L - 6, 12.5);
      const yLeft = y; y = ySec;
      head("Event Details", BX); y += px(13.5 * 1.45) + px(3); font(F.body, "normal", 12.5);
      lines(eventLines, BX, R - BX, 12.5);
      y = Math.max(y, yLeft);
      // customer
      y += px(26); head("Customer Contact Details", L); y += px(13.5 * 1.45) + px(3); font(F.body, "normal", 12.5);
      lines([b.name, b.customer_address || "", [b.phone, b.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), L, W, 12.5);
      // items table
      y += px(26);
      const thH = px(6) * 2 + px(13 * 1.45), AMTW = 32, cellX = px(12);
      const tableHead = () => {
        pdf.setFillColor(220, 202, 185); pdf.rect(L, y, W, thH, "F");
        font(F.head, "bold", 13, [176, 138, 74]);
        const ty = y + px(6);
        pdf.text("DESCRIPTION", L + cellX, ty, { baseline: "top", charSpace: px(13 * 0.06) });
        pdf.text("AMOUNT", R - cellX, ty, { baseline: "top", align: "right", charSpace: px(13 * 0.06) });
        y += thH;
      };
      tableHead();
      const items = (b.invoice_items || []).filter((it) => it.description || it.amount);
      font(F.body, "normal", 12.5);
      if (!items.length) { y += px(22); font(F.body, "normal", 12.5, [153, 153, 153]); lines("No items yet", L + cellX, 0, 12.5); y += px(3); }
      items.forEach((it, i) => {
        font(F.body, "normal", 12.5);
        const desc = pdf.splitTextToSize(clean(it.description), W - AMTW - cellX * 2);
        const rowH = px(i === 0 ? 22 : 3) + desc.length * lh(12.5) + px(3);
        if (y + rowH > BOTTOM) { pdf.addPage(); y = 20; tableHead(); font(F.body, "normal", 12.5); }
        y += px(i === 0 ? 22 : 3);
        if (it.amount) pdf.text(money(it.amount), R - cellX, y, { baseline: "top", align: "right" });
        desc.forEach((ln) => { pdf.text(ln, L + cellX, y, { baseline: "top" }); y += lh(12.5); });
        y += px(3);
      });
      // totals (80mm wide, right aligned)
      const TX = R - 80, row = (label, value, opt = {}) => {
        const size = opt.grand ? 13 : 12.5, pad = opt.due ? px(6) : px(3), h = pad * 2 + lh(size);
        page(h + px(opt.due ? 4 : 0));
        if (opt.due) { y += px(4); pdf.setFillColor(244, 236, 227); pdf.rect(TX, y, 80, h, "F"); }
        font(F.body, opt.grand || opt.due ? "bold" : "normal", size);
        pdf.text(label, TX + cellX, y + pad, { baseline: "top" });
        pdf.text(value, R - cellX, y + pad, { baseline: "top", align: "right" });
        y += h;
      };
      y += px(26);
      if (+b.discount) { row("Subtotal", `${money(t.subtotal)} AED`); row("Discount", `${fontsOk ? "−" : "-"} ${money(b.discount)} AED`); }
      row("Total Amount", `${money(t.total)} AED`, { grand: true });
      if (t.paid) row("Amount Paid", `${money(t.paid)} AED`);
      if (t.paid || !isReceipt) row("Balance Due", `${money(t.balance)} AED`, { due: true });
      if (isReceipt && t.balance === 0 && t.total > 0) {
        y += px(8); const sw = 26, sh = 9, sx = R - cellX - sw;
        pdf.setDrawColor(79, 122, 90); pdf.setLineWidth(0.6); pdf.roundedRect(sx, y, sw, sh, 1.5, 1.5, "S");
        font(F.body, "bold", 12, [79, 122, 90]); pdf.text("PAID", sx + sw / 2, y + sh / 2, { baseline: "middle", align: "center", charSpace: px(12 * 0.14) });
        y += sh;
      }
      // note
      if (b.invoice_notes) { y += px(22); font(F.body, "normal", 11.5, [85, 85, 85]); page(lh(11.5)); lines(b.invoice_notes, L, W, 11.5); }
      // footer: payment details + invoice footer, pinned to the bottom of the last page
      font(F.body, "normal", 11.5);
      const pay = pdf.splitTextToSize(clean(s.payment_details || ""), W), foot = pdf.splitTextToSize(clean(s.invoice_footer || ""), W);
      const footH = lh(13) + px(3) + pay.length * lh(11.5) + px(12) + foot.length * lh(11.5);
      if (y + px(30) + footH > BOTTOM) { pdf.addPage(); y = 20; }
      y = Math.max(y + px(30), BOTTOM - footH);
      font(F.body, "bold", 13); pdf.text("Payment Details", L, y, { baseline: "top" }); y += lh(13) + px(3);
      font(F.body, "normal", 11.5); pay.forEach((ln) => { pdf.text(ln, L, y, { baseline: "top" }); y += lh(11.5); });
      y += px(12); foot.forEach((ln) => { pdf.text(ln, L, y, { baseline: "top" }); y += lh(11.5); });
      pdf.setProperties({ title: `${docType} ${b.invoice_no || ""} – ${b.name || ""}`, author: s.business_name || "Polybelle", creator: "Polybelle admin" });
      return pdf;
    } catch (err) {
      console.error("Couldn't build the invoice PDF:", err);
      return null;
    }
  }
  async function invoiceFile(b, docType) {
    const doc = await invoicePdf(b, docType);
    if (!doc) return null;
    const blob = doc.output("blob");
    const name = `${docType}-${b.invoice_no || b.ref}-${b.name || ""}`.replace(/[^A-Za-z0-9 ._-]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-") + ".pdf";
    return { blob, name };
  }
  // Upload the PDF and return a clean link for the WhatsApp message: https://www.polybelle.me/i/<code>.
  // Each booking keeps one short code (table pb_invoice_files) that always opens its LATEST PDF; every send
  // uploads a fresh file to the private "invoices" bucket, so nobody ever sees an outdated copy. The link is
  // served by the "invoice" Edge Function (vercel.json rewrites /i/<code> to it).
  // If the table isn't set up yet, it falls back to a 7-day signed storage link.
  const newInvoiceCode = () => {
    const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz", r = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(r, (n) => abc[n % abc.length]).join("");
  };
  async function invoicePdfLink(b, pdf, docType = "Invoice") {
    if (!sb || !pdf) return "";
    const no = String(b.invoice_no || b.ref).replace(/[^\w.-]+/g, "-");
    const path = `${b.id}/${no}-${Date.now()}.pdf`;
    const up = await sb.storage.from("invoices").upload(path, pdf.blob, { contentType: "application/pdf", cacheControl: "60", upsert: false });
    if (up.error) { console.error("Couldn't upload the invoice PDF:", up.error.message); return ""; }
    const fileName = `${docType}-${no}.pdf`;
    const site = (C.siteUrl || "https://www.polybelle.me").replace(/\/$/, "");
    const { data: cur, error: findErr } = await sb.from("pb_invoice_files").select("code, path").eq("booking_id", b.id).maybeSingle();
    if (!findErr) {
      const row = { path, file_name: fileName, doc_type: docType, invoice_no: b.invoice_no || null, updated_at: new Date().toISOString() };
      if (cur) {
        const { error } = await sb.from("pb_invoice_files").update(row).eq("booking_id", b.id);
        if (!error) {
          if (cur.path && cur.path !== path) sb.storage.from("invoices").remove([cur.path]);   // tidy up the previous version
          return `${site}/i/${cur.code}`;
        }
        console.error("Couldn't update the invoice link:", error.message);
      } else {
        for (let i = 0; i < 3; i++) {
          const code = newInvoiceCode();
          const { error } = await sb.from("pb_invoice_files").insert({ code, booking_id: b.id, ...row });
          if (!error) return `${site}/i/${code}`;
          if (error.code !== "23505") { console.error("Couldn't save the invoice link:", error.message); break; }
        }
      }
    } else console.error("Invoice links table not available yet:", findErr.message);
    const signed = await sb.storage.from("invoices").createSignedUrl(path, 60 * 60 * 24 * 7);
    return signed.data?.signedUrl || "";
  }
  function downloadPdf(pdf) {
    const url = URL.createObjectURL(pdf.blob);
    const a = document.createElement("a");
    a.href = url; a.download = pdf.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const invTotals = (b) => {
    const subtotal = (b.invoice_items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const total = Math.max(0, subtotal - (Number(b.discount) || 0));
    return { subtotal, total, paid: Number(b.amount_paid) || 0, balance: Math.max(0, total - (Number(b.amount_paid) || 0)) };
  };
  const fresh = (id) => S.bookings.find((x) => x.id === id);
  // custom items: { id, description, qty, price } -> invoice line "qty × description", amount = qty × price
  const ciTotal = (c) => (Number(c.qty) || 0) * (Number(c.price) || 0);
  const ciText = (c) => ((Number(c.qty) || 1) > 1 ? `${Number(c.qty)} × ` : "") + c.description;
  const customLines = (b) => (b.custom_items || []).map((c) => ({ kind: "custom", cid: c.id, description: ciText(c), amount: ciTotal(c) }));
  const isServices = (b) => b.booking_type === "Services" || !b.venue_id;
  const whereText = (b) => (isServices(b) ? "Other venues" + (b.event_location ? " · " + b.event_location : "") : b.venue_name || "");
  const nextInvoiceNo = () => today().slice(2, 4) + "-" + ((S.settings?.invoice_counter ?? 0) + 1);

  // add-on checkboxes grouped like the website's tabs; selected items no longer in the catalog go under "Other"
  function addonGroups(selected) {
    const svc = S.services?.length ? S.services : C.addOns.map((name) => ({ name, category: "Event Services", active: true }));
    const order = C.serviceCategories || [];
    const known = new Set(svc.map((x) => x.name));
    const groups = new Map(order.map((c) => [c, []]));
    svc.filter((x) => x.active || selected.includes(x.name)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .forEach((x) => { const c = x.category || "Event Services"; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(x.name); });
    const other = selected.filter((n) => !known.has(n));
    if (other.length) groups.set("Other", other);
    return [...groups].filter(([, names]) => names.length).map(([cat, names]) => `
      <div class="ao-group"><div class="ao-head">${esc(cat)}<i>${names.filter((n) => selected.includes(n)).length || ""}</i></div>
        <div class="addons ao-items">${names.map((a) => `<span class="ao-item"><input type="checkbox" name="add_ons" value="${esc(a)}" ${selected.includes(a) ? "checked" : ""} aria-label="Include ${esc(a)}"><button type="button" class="ao-name" data-ao="${esc(a)}" aria-expanded="false">${esc(a)}</button></span>`).join("")}</div>
        <div class="ao-detail" hidden></div>
      </div>`).join("");
  }
  // details for an add-on (what's included / description), opened by tapping its name in the booking form
  function wireAddonDetails(root) {
    const close = (g) => { const box = $(".ao-detail", g); box.hidden = true; box.innerHTML = ""; $$(".ao-name", g).forEach((x) => x.setAttribute("aria-expanded", "false")); };
    $$(".ao-name", root).forEach((btn) => btn.addEventListener("click", () => {
      const g = btn.closest(".ao-group"), box = $(".ao-detail", g), open = btn.getAttribute("aria-expanded") === "true";
      $$(".ao-group", root).forEach(close);
      if (open) return;
      const cb = btn.previousElementSibling, sv = (S.services || []).find((x) => x.name === btn.dataset.ao);
      const inc = (sv?.inclusions || []).filter(Boolean), pkg = sv?.kind === "Package";
      const fill = () => {
        box.innerHTML = `
          <button type="button" class="ao-x" aria-label="Close details">×</button>
          <span class="ao-kind">${sv ? `${pkg ? "Package" : "Service"} · ${esc(sv.category || "Event Services")}` : "Not in the catalog"}</span>
          <b class="ao-title">${esc(btn.dataset.ao)}</b>
          ${sv?.description ? `<p>${esc(sv.description)}</p>` : sv ? "" : `<p>This item isn't in Halls &amp; Services any more, so there are no details saved for it.</p>`}
          ${pkg ? (inc.length ? `<span class="ao-sub">What's included</span><ul>${inc.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
            : `<p class="ao-note">No inclusions listed yet — add them in Halls &amp; Services.</p>`) : ""}
          <button type="button" class="btn ${cb.checked ? "btn-outline" : "btn-primary"} sm" data-ao-toggle>${cb.checked ? "Remove" : "Add"}</button>`;
        $(".ao-x", box).onclick = () => close(g);
        $("[data-ao-toggle]", box).onclick = () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); fill(); };
      };
      fill();
      box.hidden = false; btn.setAttribute("aria-expanded", "true");
    }));
    // keep the panel's button in sync when the checkbox itself is ticked
    $$(".ao-item input", root).forEach((cb) => cb.addEventListener("change", () => {
      const btn = cb.nextElementSibling;
      if (btn.getAttribute("aria-expanded") === "true") { const t = $(".ao-detail [data-ao-toggle]", cb.closest(".ao-group")); if (t) { t.textContent = cb.checked ? "Remove" : "Add"; t.className = `btn ${cb.checked ? "btn-outline" : "btn-primary"} sm`; } }
    }));
  }

  // ---------- booking add / edit form
  function openBookingForm(b, prefill) {
    const isNew = !b;
    b = b || { venue_id: S.venues.find((v) => v.active)?.id, event_date: "", session: "Evening", event_type: C.eventTypes[0], guests: "", name: "", phone: "", email: "", customer_address: "", notes: "", add_ons: [], status: "Confirmed", ...(prefill || {}) };
    const d = $("#drawer");
    const venueOpts = `<option value="" ${b.venue_id ? "" : "selected"}>Other venues – customer's location (packages / services)</option>` + S.venues.map((v) => `<option value="${v.id}" ${v.id === b.venue_id ? "selected" : ""}>${esc(v.name)} (up to ${v.capacity})${v.active ? "" : " – hidden"}</option>`).join("");
    const typeOpts = [...new Set([...C.eventTypes, b.event_type].filter(Boolean))].map((t) => `<option ${t === b.event_type ? "selected" : ""}>${esc(t)}</option>`).join("");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${isNew ? "New booking" : "Edit · " + esc(b.ref)}</span><h3>${isNew ? "Add a booking" : esc(b.name)}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="bkForm">
        <label class="field">Hall<select name="venue_id" id="bkVenue">${venueOpts}</select></label>
        <label class="field" id="bkLocWrap">Event location (Other venues)<input name="event_location" maxlength="200" value="${esc(b.event_location || "")}" placeholder="e.g. customer's villa, Khalifa City"></label>
        <div class="grid-2">
          <label class="field">Event date<input type="date" name="event_date" required value="${esc(b.event_date)}"></label>
          <label class="field">Session<select name="session">${C.sessions.map((s) => `<option value="${s.id}" ${s.id === b.session ? "selected" : ""}>${s.id} · ${s.time}</option>`).join("")}</select></label>
          <label class="field">Occasion<select name="event_type">${typeOpts}</select></label>
          <label class="field">Guests<input type="number" name="guests" min="1" value="${b.guests ?? ""}"></label>
          <label class="field">Customer name<input name="name" required maxlength="120" value="${esc(b.name)}"></label>
          <label class="field">Mobile<input name="phone" required maxlength="40" value="${esc(b.phone)}"></label>
        </div>
        <label class="field">Email<input type="email" name="email" value="${esc(b.email || "")}"></label>
        <label class="field">Customer address / company (shown on invoice)<textarea name="customer_address" rows="2" placeholder="e.g. Cocoa Parties & Events SPC LLC&#10;Abu Dhabi, UAE">${esc(b.customer_address || "")}</textarea></label>
        <div>
          <div class="ao-title">Packages &amp; services</div>
          ${addonGroups(b.add_ons || [])}
        </div>
        <div>
          <div class="ao-title">Custom items <span>(shown on the invoice)</span></div>
          <div id="ciRows" class="ci-rows"></div>
          <button type="button" class="btn btn-outline sm" id="ciAdd">+ Add custom item</button>
        </div>
        <label class="field">Customer notes<textarea name="notes">${esc(b.notes || "")}</textarea></label>
        ${isNew ? `<label class="field">Status<select name="status">${STATUSES.map((s) => `<option ${s === b.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>` : ""}
        <button class="btn btn-primary" type="submit">${isNew ? "Save booking" : "Save changes"}</button>
      </form>`;
    const ciRow = (c) => `
      <div class="ci-row" data-id="${esc(c.id)}">
        <label class="ci-f ci-d">Description<input class="ci-desc" placeholder="e.g. Scent bottle souvenirs 15 ml" maxlength="120" value="${esc(c.description || "")}"></label>
        <button type="button" class="xbtn ci-del" aria-label="Remove item">×</button>
        <label class="ci-f">Qty<input class="ci-qty" type="number" min="0" step="1" value="${c.qty ?? 1}"></label>
        <label class="ci-f">Unit price (AED)<input class="ci-price" type="number" min="0" step="0.01" value="${c.price ?? ""}" placeholder="0.00"></label>
        <div class="ci-f">Total (AED)<span class="ci-total">${money(ciTotal(c))}</span></div>
      </div>`;
    const ciWire = () => $$(".ci-row", d).forEach((r) => {
      const upd = () => ($(".ci-total", r).textContent = money(ciTotal({ qty: $(".ci-qty", r).value, price: $(".ci-price", r).value })));
      $(".ci-qty", r).oninput = upd; $(".ci-price", r).oninput = upd;
      $(".ci-del", r).onclick = () => r.remove();
    });
    $("#ciRows").innerHTML = (b.custom_items || []).map(ciRow).join("");
    ciWire();
    $("#ciAdd").addEventListener("click", () => {
      $("#ciRows").insertAdjacentHTML("beforeend", ciRow({ id: "c" + Date.now().toString(36), description: "", qty: 1, price: "" }));
      ciWire(); $("#ciRows .ci-row:last-child .ci-desc").focus();
    });
    $$(".ao-group input", d).forEach((cb) => cb.addEventListener("change", () => {
      const g = cb.closest(".ao-group"); $(".ao-head i", g).textContent = $$("input:checked", g).length || "";
    }));
    wireAddonDetails(d);
    const syncLoc = () => ($("#bkLocWrap").hidden = !!$("#bkVenue").value);
    $("#bkVenue").addEventListener("change", syncLoc); syncLoc();
    $("[data-close]", d).addEventListener("click", () => (isNew ? closeDrawers() : openBooking(fresh(b.id))));
    $("#bkForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, fd = new FormData(f);
      const v = S.venues.find((x) => x.id === fd.get("venue_id"));
      if (!v && !fd.getAll("add_ons").length) return toast("Choose a hall, or at least one package or service.");
      const row = {
        booking_type: v ? "Hall" : "Services", venue_id: v ? v.id : null, venue_name: v ? v.name : null,
        event_location: v ? null : fd.get("event_location").trim() || null, event_date: fd.get("event_date"), session: fd.get("session"),
        event_type: fd.get("event_type"), guests: fd.get("guests") || null, name: fd.get("name").trim(), phone: fd.get("phone").trim(),
        email: fd.get("email").trim() || null, customer_address: fd.get("customer_address").trim() || null,
        notes: fd.get("notes").trim() || null, add_ons: fd.getAll("add_ons"),
        custom_items: $$(".ci-row", f).map((r) => ({ id: r.dataset.id, description: $(".ci-desc", r).value.trim(),
          qty: Number($(".ci-qty", r).value) || 0, price: Number($(".ci-price", r).value) || 0 })).filter((c) => c.description)
      };
      let res;
      if (isNew) {
        row.status = fd.get("status");
        row.ref = "PB-" + today().slice(2).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
        res = await sb.from("pb_bookings").insert(row).select().single();
      } else {
        res = await sb.from("pb_bookings").update(row).eq("id", b.id).select().single();
      }
      if (res.error) return toast(res.error.message.includes("already has a confirmed") ? "That hall already has a confirmed booking for this date & session." : res.error.message);
      toast(isNew ? "Booking added" : "Booking updated");
      await loadBookings();
      const saved = fresh(res.data.id);
      openBooking(saved, isNew ? (saved.status === "Confirmed" ? "Confirmed" : null) : "Updated");
    });
    openDrawer("#drawer");
  }

  // ---------- booking details
  // notice: "Confirmed" | "Cancelled" | "Completed" | "Updated" — shows a prompt to message the customer
  const NOTICE = {
    Confirmed: "Booking confirmed. Send the confirmation and full details to the customer:",
    Updated: "Booking updated. Send the latest details to the customer:",
    Cancelled: "Booking cancelled. Let the customer know:",
    Completed: "Event marked as completed. Send a thank-you with the event summary:"
  };
  function openBooking(b, notice) {
    if (!b) return openBookingForm(null);
    const d = $("#drawer");
    const t = invTotals(b);
    d.innerHTML = `
      <div class="drawer-head">
        <div><span class="eyebrow">${esc(b.ref)}</span><h3>${esc(b.name)}</h3><span class="badge b-${b.status}">${b.status}</span></div>
        <button class="xbtn" data-close aria-label="Close">×</button>
      </div>
      <div class="drawer-body">
        ${notice && NOTICE[notice] ? `<div class="notify"><p>${NOTICE[notice]}</p><span class="wa-row"><a class="btn btn-wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, customerMsg(b, notice))}">Send on WhatsApp</a>${waTest(customerMsg(b, notice))}</span></div>` : ""}
        ${(() => { const o = overlapsFor(b); const item = (x) => `<li><button type="button" class="linkbtn" data-goto="${x.id}">${esc(x.ref)}</button> · ${esc(x.name)} · ${esc(whereText(x))} · ${esc(x.session)} · ${esc(x.event_type)} · ${esc(x.status)}</li>`;
          return [o.clash.length ? `<div class="ovbox ov-clash-box"><b>Hall clash</b> — same hall (or a hall sharing its space) with an overlapping session:<ul>${o.clash.map(item).join("")}</ul></div>` : "",
                  o.hallDay.length ? `<div class="ovbox ov-hall-box"><b>Same hall, same day</b> — plan setup and turnover:<ul>${o.hallDay.map(item).join("")}</ul></div>` : "",
                  o.occasion.length ? `<div class="ovbox ov-occ-box"><b>Same occasion, same day</b> — check staff, mascots and supplies:<ul>${o.occasion.map(item).join("")}</ul></div>` : ""].join(""); })()}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline sm" id="editBtn" type="button">✎ Edit booking</button>
          <button class="btn btn-outline sm" id="invBtn" type="button">🧾 Invoice${b.invoice_no ? " " + esc(b.invoice_no) : ""}</button>
        </div>
        <dl class="kv">
          <dt>Booking</dt><dd>${isServices(b) ? "Other venues · packages / services" : "Hall · " + esc(b.venue_name)}</dd>
          ${isServices(b) ? `<dt>Location</dt><dd>${esc(b.event_location || "Not given yet")}</dd>` : hallAddress(b) ? `<dt>Hall address</dt><dd style="white-space:pre-wrap">${esc(hallAddress(b))}</dd>` : ""}
          <dt>Event date</dt><dd>${esc(fmtDate(b.event_date))}</dd>
          <dt>Session</dt><dd>${esc(b.session)} <small style="color:var(--muted)">${esc(C.sessions.find((s) => s.id === b.session)?.time || "")}</small></dd>
          <dt>Occasion</dt><dd>${esc(b.event_type)}</dd>
          <dt>Guests</dt><dd>${b.guests ?? "—"}</dd>
          <dt>Add-ons</dt><dd>${b.add_ons?.length ? esc(b.add_ons.join(", ")) : "—"}</dd>
          ${b.custom_items?.length ? `<dt>Custom items</dt><dd>${b.custom_items.map((c) => `${esc(ciText(c))} · AED ${money(ciTotal(c))}`).join("<br>")}</dd>` : ""}
          <dt>Mobile</dt><dd><a href="tel:+${intl(b.phone)}">${esc(b.phone)}</a></dd>
          <dt>Email</dt><dd>${b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "—"}</dd>
          ${b.customer_address ? `<dt>Address</dt><dd style="white-space:pre-wrap">${esc(b.customer_address)}</dd>` : ""}
          <dt>Customer notes</dt><dd style="white-space:pre-wrap">${esc(b.notes || "—")}</dd>
          <dt>Requested</dt><dd>${fmtStamp(b.created_at)}</dd>
          ${b.invoice_no ? `<dt>Invoice</dt><dd>${esc(b.invoice_no)} · Total AED ${money(t.total)} · Paid AED ${money(t.paid)} · <b>Balance AED ${money(t.balance)}</b></dd>` : ""}
        </dl>
        <div>
          <div style="font-size:.86rem;color:var(--muted);margin-bottom:8px">Status</div>
          <div class="status-row">${STATUSES.map((s) => `<button type="button" data-st="${s}" class="${s === b.status ? "cur" : ""}">${s}</button>`).join("")}</div>
        </div>
        <label class="field">Internal notes (only admins see this)
          <textarea id="adminNotes" placeholder="Package, deposit, theme, supplier notes…">${esc(b.admin_notes || "")}</textarea>
        </label>
        <div><button class="btn btn-outline sm" id="saveNotes" type="button">Save notes</button></div>
      </div>
      <div class="drawer-foot">
        <a class="btn btn-wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, customerMsg(b, b.status))}">WhatsApp customer</a>${waTest(customerMsg(b, b.status))}
        <button class="btn btn-outline sm" id="delBtn" type="button" style="margin-left:auto">Delete</button>
      </div>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    $("#editBtn").addEventListener("click", () => openBookingForm(b));
    $$("[data-goto]", d).forEach((x) => x.addEventListener("click", () => openBooking(fresh(x.dataset.goto))));
    $("#invBtn").addEventListener("click", () => openInvoice(b));
    $$("[data-st]", d).forEach((btn) => btn.addEventListener("click", async () => {
      const st = btn.dataset.st;
      if (st === b.status) return;
      const { error } = await sb.from("pb_bookings").update({ status: st }).eq("id", b.id);
      if (error) return toast(error.message.includes("already has a confirmed") ? "Can't confirm: this hall already has a confirmed booking for that date & session." : error.message);
      await loadBookings();
      openBooking(fresh(b.id), NOTICE[st] ? st : null);
      toast(`Marked as ${st}`);
    }));
    $("#saveNotes").addEventListener("click", async () => {
      const { error } = await sb.from("pb_bookings").update({ admin_notes: $("#adminNotes").value }).eq("id", b.id);
      if (error) return toast(error.message);
      b.admin_notes = $("#adminNotes").value; toast("Notes saved");
    });
    $("#delBtn").addEventListener("click", async () => {
      if (!confirm(`Delete booking ${b.ref} for ${b.name}? This can't be undone. (Tip: use “Cancelled” to keep a record.)`)) return;
      const { error } = await sb.from("pb_bookings").delete().eq("id", b.id);
      if (error) return toast(error.message);
      toast("Booking deleted"); closeDrawers(); loadBookings();
    });
    openDrawer("#drawer");
  }

  // ---------- invoice editor
  const hallLine = (b) => `${b.venue_name} rental · ${b.event_type} · ${fmtDate(b.event_date)} (${b.session})`;
  const venueLine = (b) => `Event location: ${b.event_location || "customer's venue"} · ${b.event_type} · ${fmtDate(b.event_date)} (${b.session})`;
  // the priced "where" line: hall rental for hall bookings, event location for Other venues
  const placeLine = (b) => {
    const v = S.venues.find((x) => x.id === b.venue_id);
    return isServices(b) ? { kind: "venue", description: venueLine(b), amount: 0 } : { kind: "hall", description: hallLine(b), amount: v?.price_from ? Number(v.price_from) : 0 };
  };
  function defaultItems(b) {
    const items = [placeLine(b)];
    (b.add_ons || []).forEach((a) => items.push({ description: a, amount: 0 }));
    return [...items, ...customLines(b)];
  }

  function openInvoice(b) {
    // the hall-rental line always reflects the booking's current hall, occasion, date and session
    // hall line and custom items always mirror the booking; other lines keep what was saved on the invoice
    const cur = new Map(customLines(b).map((l) => [l.cid, l]));
    const items = (b.invoice_items?.length ? b.invoice_items : defaultItems(b))
      .filter((x) => !(x.kind === "hall" && isServices(b)) && !(x.kind === "venue" && !isServices(b)) && !(x.kind === "custom" && !cur.has(x.cid)))
      .map((x) => (x.kind === "hall" ? { ...x, description: hallLine(b) } : x.kind === "venue" ? { ...x, description: venueLine(b) } : x.kind === "custom" ? { ...cur.get(x.cid) } : { ...x }));
    cur.forEach((l, id) => { if (!items.some((x) => x.cid === id)) items.push(l); });
    const d = $("#drawer");
    const itemRow = (it, i) => `
      <div class="inv-row ${it.kind === "custom" ? "locked" : ""}" data-i="${i}" data-kind="${esc(it.kind || "")}" data-cid="${esc(it.cid || "")}" ${it.kind === "custom" ? 'title="Custom item from the booking — change it with Edit booking"' : ""}>
        <textarea class="inv-desc" rows="1" placeholder="Description, e.g. 15 pieces Scented Candles" ${it.kind === "custom" ? "readonly" : ""}>${esc(it.description)}</textarea>
        <input class="inv-amt" type="number" step="0.01" min="0" value="${it.amount || ""}" placeholder="0.00" aria-label="Amount (AED)" ${it.kind === "custom" ? "readonly" : ""}>
        ${it.kind === "custom" ? `<span class="inv-lock" aria-hidden="true">Booking</span>` : `<button type="button" class="xbtn inv-del" aria-label="Remove line">×</button>`}
      </div>`;
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${b.invoice_no ? "Invoice " + esc(b.invoice_no) : "New invoice"} · ${esc(b.ref)}</span><h3>${esc(b.name)}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="invForm">
        <p class="hint" style="margin:0">Customer and event details are taken from the booking each time you open the invoice, so edits to the booking show up automatically.</p>
        <div>
          <div style="font-size:.86rem;color:var(--muted);margin-bottom:8px">Line items (AED) <span class="hint" style="display:block;margin-top:2px">Put the ${isServices(b) ? "event location" : "hall"} price on its line. To add an extra item, use <b>Custom items</b> in Edit booking.</span></div>
          <div id="invItems" style="display:grid;gap:8px">${items.map(itemRow).join("")}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn btn-outline sm" id="resetLines" title="Rebuild lines from the booking's hall, date and add-ons">↻ Refresh from booking</button>
            <button type="button" class="btn btn-outline sm" id="addPlace">+ ${isServices(b) ? "Event location" : "Hall"} price</button>
          </div>
        </div>
        <div class="grid-2">
          <label class="field">Invoice number<input name="invoice_no" maxlength="30" value="${esc(b.invoice_no || "")}" placeholder="Auto: ${esc(nextInvoiceNo())}"></label>
          <div class="hint" style="align-self:end;margin:0 0 10px">${b.invoice_no ? "Change it if you need to match your own numbering." : "Leave blank to use the next number automatically."}</div>
          <label class="field">Discount (AED)<input type="number" step="0.01" min="0" name="discount" value="${b.discount || ""}" placeholder="0.00"></label>
          <label class="field">Amount paid (AED)<input type="number" step="0.01" min="0" name="amount_paid" value="${b.amount_paid || ""}" placeholder="0.00"></label>
          <label class="field">Issue date<input type="date" name="invoice_date" value="${esc(b.invoice_date || today())}"></label>
          <label class="field">Document title<select name="doc_type"><option>Invoice</option><option>Receipt</option></select></label>
        </div>
        <label class="field">Note on invoice (optional)<textarea name="invoice_notes" rows="2" placeholder="e.g. 50% deposit required to secure the date">${esc(b.invoice_notes || "")}</textarea></label>
        <div class="inv-sum" id="invSum"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-outline" type="submit" data-act="save">Save</button>
          <button class="btn btn-wa" type="submit" data-act="send">Send invoice to customer</button>
          <button class="btn btn-primary" type="submit" data-act="print">Save &amp; open invoice</button>
        </div>
      </form>`;
    const f = $("#invForm");
    const t0 = invTotals(b);
    if (b.invoice_no && t0.paid > 0 && t0.balance === 0) f.doc_type.value = "Receipt";
    const read = () => $$(".inv-row", d).map((r) => ({ ...(r.dataset.kind ? { kind: r.dataset.kind } : {}), ...(r.dataset.cid ? { cid: r.dataset.cid } : {}), description: $(".inv-desc", r).value.trim(), amount: Number($(".inv-amt", r).value) || 0 })).filter((x) => x.description || x.amount);
    let promoDiscountTouched = Number(b.discount) > 0;
    const sum = () => {
      if (b.promo && !promoDiscountTouched) {
        const itemTotal = read()
          .filter((item) => item.description.toLowerCase() === b.promo.required_item.toLowerCase())
          .reduce((total, item) => total + item.amount, 0);
        const value = Number(b.promo.discount_value);
        const discount = b.promo.discount_type === "fixed" ? Math.min(value, itemTotal) : itemTotal * value / 100;
        f.discount.value = discount.toFixed(2);
      }
      const t = invTotals({ invoice_items: read(), discount: f.discount.value, amount_paid: f.amount_paid.value });
      $("#invSum").innerHTML = `<div><span>Subtotal</span><b>AED ${money(t.subtotal)}</b></div>${+f.discount.value ? `<div><span>Discount</span><b>− AED ${money(f.discount.value)}</b></div>` : ""}<div><span>Total</span><b>AED ${money(t.total)}</b></div><div><span>Paid</span><b>AED ${money(t.paid)}</b></div><div class="due"><span>Balance due</span><b>AED ${money(t.balance)}</b></div>`;
    };
    const kindOf = isServices(b) ? "venue" : "hall";
    const syncPlace = () => ($("#addPlace").hidden = !!$(`.inv-row[data-kind="${kindOf}"]`, d));
    $("#addPlace").onclick = () => {
      $("#invItems").insertAdjacentHTML("afterbegin", itemRow(placeLine(b), 0));
      wire(); sum(); $(`.inv-row[data-kind="${kindOf}"] .inv-amt`, d).focus();
    };
    const wire = () => {
      syncPlace();
      $$(".inv-del", d).forEach((x) => (x.onclick = () => { x.closest(".inv-row").remove(); syncPlace(); sum(); }));
      $$(".inv-desc", d).forEach((ta) => { const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }; ta.oninput = fit; fit(); });
    };
    f.addEventListener("input", (e) => {
      if (e.target === f.discount) promoDiscountTouched = true;
      sum();
    });
    $("#resetLines").onclick = () => { if (!confirm("Replace the current lines with the hall and add-ons from the booking?")) return; $("#invItems").innerHTML = defaultItems(b).map(itemRow).join(""); wire(); sum(); };
    wire(); sum();
    $("[data-close]", d).addEventListener("click", () => openBooking(fresh(b.id)));

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const act = e.submitter?.dataset.act || "save";
      // opened before saving so the WhatsApp tab isn't blocked; filled in once the invoice is stored
      const win = act === "print" || act === "send" ? window.open("", "_blank") : null;
      const patch = { invoice_items: read(), discount: Number(f.discount.value) || 0, amount_paid: Number(f.amount_paid.value) || 0,
        invoice_date: f.invoice_date.value || today(), invoice_notes: f.invoice_notes.value.trim() || null,
        invoice_no: f.invoice_no.value.trim() || null };
      let { error } = await sb.from("pb_bookings").update(patch).eq("id", b.id);
      if (!error && !patch.invoice_no) ({ error } = await sb.rpc("pb_assign_invoice", { p_booking: b.id }));
      if (error) {
        if (win) win.close();
        return toast(error.code === "23505" ? `Invoice number ${patch.invoice_no} is already used on another booking.` : error.message);
      }
      await Promise.all([loadBookings(), loadSettings()]);
      const nb = fresh(b.id);
      const docTitle = f.doc_type.value;
      if (act === "send") {
        const pdf = await invoiceFile(nb, docTitle);
        const pdfLink = await invoicePdfLink(nb, pdf, docTitle);
        const url = nb.phone ? waLink(nb.phone, invoiceMsg(nb, docTitle, pdfLink)) : "";
        const moveTo = (u) => {
          if (win) { win.location.href = u; return true; }
          return !!window.open(u, "_blank", "noopener");
        };
        if (!url) {
          if (win) win.close();
          toast(`Invoice ${nb.invoice_no} saved, but this booking has no customer phone number.`);
        } else {
          // the PDF link works in the chat on any device; if it couldn't be uploaded, download the file to attach by hand
          if (pdf && !pdfLink) downloadPdf(pdf);
          const opened = moveTo(url);
          toast(!opened ? `Invoice ${nb.invoice_no} saved. Allow pop-ups to open WhatsApp.`
            : pdfLink ? `Invoice ${nb.invoice_no} sent to ${nb.name} on WhatsApp with the PDF link.`
            : pdf ? `Invoice ${nb.invoice_no} PDF downloaded — attach it in the WhatsApp chat.`
            : `Invoice ${nb.invoice_no} sent to ${nb.name} on WhatsApp.`);
        }
      } else {
        toast(`Invoice ${nb.invoice_no} saved`);
      }
      if (win && act === "print") renderInvoice(win, nb, docTitle);
      openInvoice(nb);
      $("#invForm").doc_type.value = docTitle;
    });
    openDrawer("#drawer");
  }

  // ---------- printable invoice (matches Polybelle receipt layout)
  function invoiceHtml(b, docType, pdf) {
    const s = S.settings || {};
    const t = invTotals(b);
    const nl = (x) => esc(x || "").replace(/\n/g, "<br>");
    const customer = [b.name, b.customer_address || "", [b.phone, b.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
    const issue = new Date((b.invoice_date || today()) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const sess = C.sessions.find((x) => x.id === b.session);
    const lines = (b.invoice_items || []).map((it) => `<tr><td>${nl(it.description)}</td><td class="amt">${it.amount ? money(it.amount) : ""}</td></tr>`).join("");
    const isReceipt = docType === "Receipt";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${docType} ${esc(b.invoice_no)} – ${esc(b.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Lora:wght@500;600&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #ECE6E0; font-family: Montserrat, Arial, sans-serif; color: #2B2B2B; font-size: 12.5px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bar { position: sticky; top: 0; background: #3A2A24; color: #fff; display: flex; gap: 10px; justify-content: center; padding: 10px; font-size: 13px; }
  .bar button { font: 500 13px Montserrat, sans-serif; border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer; background: #B8923E; color: #fff; }
  .bar button.alt { background: transparent; border: 1px solid rgba(255,255,255,.4); }
  .page { width: 210mm; min-height: 297mm; margin: 20px auto; background: #fff; padding: 20mm 18mm 16mm; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,.12); }
  .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  .logo b { display: block; font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; font-size: 40px; letter-spacing: .26em; color: #B8923E; line-height: 1; }
  .logo span { display: block; font-size: 7.6px; letter-spacing: .06em; color: #B8923E; font-weight: 600; margin-top: 6px; text-transform: uppercase; }
  .biz { font-size: 11.5px; min-width: 62mm; }
  h4 { font-family: Lora, Georgia, serif; color: #B8923E; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; font-size: 13.5px; margin: 0 0 3px; }
  .sec { margin-top: 26px; }
  .sec p { margin: 0; }
  .grid { display: flex; justify-content: space-between; gap: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 26px; }
  th { background: #DCCAB9; color: #B08A4A; font-family: Lora, Georgia, serif; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; font-size: 13px; text-align: left; padding: 6px 12px; }
  th.amt { width: 32mm; }
  td { padding: 3px 12px; vertical-align: top; }
  tbody tr:first-child td { padding-top: 22px; }
  .amt { text-align: right; white-space: nowrap; }
  .totals { margin: 26px 0 0 auto; width: 80mm; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 12px; }
  .totals .grand { font-weight: 600; font-size: 13px; }
  .totals .due { background: #F4ECE3; font-weight: 600; margin-top: 4px; padding: 6px 12px; }
  .note { margin-top: 22px; font-size: 11.5px; color: #555; }
  .foot { margin-top: auto; padding-top: 30px; font-size: 11.5px; }
  .foot b { font-size: 13px; display: block; margin-bottom: 3px; }
  .foot p { margin: 0 0 12px; }
  .stamp { display: inline-block; margin-top: 6px; border: 2px solid #4F7A5A; color: #4F7A5A; font-weight: 600; letter-spacing: .14em; padding: 4px 12px; border-radius: 6px; font-size: 12px; transform: rotate(-4deg); }
  @media print { body { background: #fff; } .bar { display: none; } .page { margin: 0; box-shadow: none; } }
  @media (max-width: 820px) { .page { width: 100%; min-height: auto; padding: 24px 18px; margin: 0; } .top, .grid { flex-direction: column; } .logo b { font-size: 32px; } }
  ${pdf ? "body { background: #fff; } .bar { display: none; } .page { margin: 0; box-shadow: none; }" : ""}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button><button class="alt" onclick="window.close()">Close</button></div>
<div class="page">
  <div class="top">
    <div class="logo"><b>POLYBELLE</b><span>Making memorable memories, one milestone at a time</span></div>
    <div class="biz">${nl(s.business_name)}<br>${nl(s.business_address)}</div>
  </div>
  <div class="grid">
    <div class="sec">
      <h4>${esc(docType)}</h4>
      <p>No: ${esc(b.invoice_no)}</p>
      <p>Issue Date: ${esc(issue)}</p>
      <p>Booking Ref: ${esc(b.ref)}</p>
    </div>
    <div class="sec" style="min-width:62mm">
      <h4>Event Details</h4>
      <p>${esc(isServices(b) ? whereText(b) : b.venue_name)} · ${esc(b.event_type)}</p>
      <p>${esc(fmtDate(b.event_date))}</p>
      <p>${esc(b.session)}${sess ? " (" + esc(sess.time) + ")" : ""}${b.guests ? " · " + b.guests + " guests" : ""}</p>
    </div>
  </div>
  <div class="sec">
    <h4>Customer Contact Details</h4>
    <p>${nl(customer)}</p>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead>
    <tbody>${lines || `<tr><td colspan="2" style="color:#999">No items yet</td></tr>`}</tbody>
  </table>
  <div class="totals">
    ${+b.discount ? `<div><span>Subtotal</span><span>${money(t.subtotal)} AED</span></div><div><span>Discount</span><span>− ${money(b.discount)} AED</span></div>` : ""}
    <div class="grand"><span>Total Amount</span><span>${money(t.total)} AED</span></div>
    ${t.paid ? `<div><span>Amount Paid</span><span>${money(t.paid)} AED</span></div>` : ""}
    ${t.paid || !isReceipt ? `<div class="due"><span>Balance Due</span><span>${money(t.balance)} AED</span></div>` : ""}
    ${isReceipt && t.balance === 0 && t.total > 0 ? `<div style="justify-content:flex-end"><span class="stamp">PAID</span></div>` : ""}
  </div>
  ${b.invoice_notes ? `<div class="note">${nl(b.invoice_notes)}</div>` : ""}
  <div class="foot">
    <b>Payment Details</b>
    <p>${nl(s.payment_details)}</p>
    <p>${nl(s.invoice_footer)}</p>
  </div>
</div></body></html>`;
  }
  function renderInvoice(win, b, docType) {
    win.document.open();
    win.document.write(invoiceHtml(b, docType));
    win.document.close();
  }

  // ---------------- venues
  async function loadVenues() {
    const { data, error } = await sb.from("pb_venues").select("*").order("sort_order").order("name");
    if (error) return toast(error.message);
    S.venues = data;
    renderAdminCal();
    $("#fVenue").innerHTML = `<option value="">All bookings</option>` + data.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("") + `<option value="__services">Other venues (customer's location)</option>`;
    renderVenues();
  }
  function renderVenues() {
    const other = S.otherVenue || C.otherVenue;
    const showOther = other.show !== false;
    $("#vgrid").innerHTML = `
      <div class="vcard">
        <div class="vimg" style="background-image:url('${esc(other.image || C.fallbackImages[0])}');background-position:${posOk(other.imagePos) || "center"}">
          <span class="badge ${showOther ? "b-Confirmed" : "b-Cancelled"}">${showOther ? "Shown on website" : "Hidden"}</span>
        </div>
        <div class="vb">
          <h3>${esc(other.name || "Other venues")}</h3>
          ${other.tagline ? `<p><i>${esc(other.tagline)}</i></p>` : ""}
          ${other.description ? `<p>${esc(other.description)}</p>` : ""}
          <p>Packages &amp; services at a customer's location</p>
        </div>
        <div class="vf"><button class="btn btn-outline sm" id="editOtherVenue">Edit</button></div>
      </div>` + S.venues.map((v, i) => `
      <div class="vcard">
        <div class="vimg" style="background-image:url('${esc(v.image_url || C.fallbackImages[i % C.fallbackImages.length])}');background-position:${posOk(v.image_pos) || "center"}">
          <span class="badge ${v.active ? "b-Confirmed" : "b-Cancelled"}">${v.active ? "Shown on website" : "Hidden"}</span>
        </div>
        <div class="vb">
          <h3>${esc(v.name)}</h3>
          ${v.venue_address ? `<p style="white-space:pre-wrap">📍 ${esc(v.venue_address)}</p>` : ""}<p>Up to ${v.capacity} guests${v.branch ? " · " + esc(v.branch) : ""}${v.price_from ? " · from AED " + Number(v.price_from).toLocaleString() : ""}</p>
          ${v.tagline ? `<p><i>${esc(v.tagline)}</i></p>` : ""}
          ${v.image_url ? "" : `<p style="color:var(--gold)">Using a sample photo — upload the real one.</p>`}
        </div>
        <div class="vf"><button class="btn btn-outline sm" data-edit="${v.id}">Edit</button></div>
      </div>`).join("") + `<button class="vcard add" id="addVenue"><span><b>+</b>Add a new hall</span></button>`;
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => openVenue(S.venues.find((v) => v.id === b.dataset.edit))));
    $("#editOtherVenue").addEventListener("click", openOtherVenue);
    $("#addVenue").addEventListener("click", () => openVenue(null));
  }

  function openVenue(v) {
    const isNew = !v;
    v = v || { name: "", tagline: "", description: "", capacity: 50, branch: "", google_maps_url: "", image_url: "", price_from: null, sort_order: (S.venues.at(-1)?.sort_order || 0) + 1, active: true };
    const d = $("#vdrawer");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${isNew ? "New hall" : "Edit hall"}</span><h3>${esc(v.name || "Add a hall")}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="venueForm">
        ${frameBlock("vPrev", v.image_url, v.image_pos, "portrait")}
        <label class="field">Photo (JPG/PNG/WebP — resized automatically)<input type="file" id="vFile" accept="image/jpeg,image/png,image/webp"></label>
        <input type="hidden" name="image_url" value="${esc(v.image_url || "")}">
        <label class="field">Hall name<input name="name" required maxlength="60" value="${esc(v.name)}" placeholder="e.g. Hall E"></label>
        <label class="field">Short tagline<input name="tagline" maxlength="60" value="${esc(v.tagline || "")}" placeholder="e.g. Garden-themed & bright"></label>
        <label class="field">Description<textarea name="description" maxlength="400">${esc(v.description || "")}</textarea></label>
        <label class="field">Venue / hall address<textarea name="venue_address" maxlength="300" placeholder="Enter the full address customers should use">${esc(v.venue_address || "")}</textarea></label>
        <div class="grid-2">
          <label class="field">Max guests<input type="number" name="capacity" min="1" required value="${v.capacity}"></label>
          <label class="field">Branch / location<select name="branch"><option value="">—</option>${C.branches.map((b) => `<option ${b.name === v.branch ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
          <label class="field">Starting price (AED, optional)<input type="number" name="price_from" min="0" step="1" value="${v.price_from ?? ""}"></label>
          <label class="field">Display order<input type="number" name="sort_order" value="${v.sort_order}"></label>
        </div>
        ${(() => { const others = S.venues.filter((x) => x.id !== v.id); if (!others.length) return "";
          const on = v.id ? linkedHalls(v.id) : new Set();
          return `<fieldset class="field share-set"><legend>Shares space with</legend>
            <div class="share-opts">${others.map((x) => `<label class="switch"><input type="checkbox" name="shares" value="${x.id}" ${on.has(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("")}</div>
            <small class="hint">Tick halls that use the same room (e.g. Hall A&amp;B and Hall B). A booking in one blocks that session in the other.</small></fieldset>`; })()}
        <label class="field">Google Maps link or embed code (optional)<input type="text" name="google_maps_url" maxlength="5000" value="${esc(v.google_maps_url || "")}" placeholder="Paste a Google Maps URL or iframe code"><small class="hint">Copy the link or full iframe code from Google Maps → Share → Embed a map.</small></label>
        <label class="switch"><input type="checkbox" name="active" ${v.active ? "checked" : ""}> Show on website &amp; accept bookings</label>
        <div class="venue-form-actions">
          <button class="btn btn-primary" type="submit">${isNew ? "Add hall" : "Save changes"}</button>
          ${isNew ? "" : `<button class="btn btn-outline" type="button" id="vDel">Delete hall</button>`}
        </div>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    const vFrame = wireFramer($("#vPrev"), $("#venueForm"));
    $("#vFile").addEventListener("change", async (e) => {
      let f = e.target.files[0]; if (!f) return;
      toast("Optimizing photo…");
      f = await prepPhoto(f, 1600); if (!f) return;
      toast("Uploading photo…");
      const path = `venues/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const { error } = await sb.storage.from(C.storageBucket).upload(path, f, { cacheControl: "31536000", upsert: false });
      if (error) return toast("Upload failed: " + error.message);
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      $("#venueForm").image_url.value = url;
      vFrame.newPhoto(url);
      toast("Photo uploaded — drag it to frame, then save");
    });
    $("#vDel")?.addEventListener("click", async () => {
      if (!confirm(`Delete “${v.name}”? This can't be undone. If it has booking history, deletion will be blocked; hide it instead to preserve records.`)) return;
      const { count, error: checkError } = await sb.from("pb_bookings").select("id", { count: "exact", head: true }).eq("venue_id", v.id);
      if (checkError) return toast("Couldn't check hall booking history: " + checkError.message);
      if (count) return toast("This hall has booking history and can't be deleted. Hide it instead to preserve its records.");
      const { error } = await sb.from("pb_venues").delete().eq("id", v.id);
      if (error) {
        if (error.code === "23503") return toast("This hall has booking history and can't be deleted. Hide it instead to preserve its records.");
        return toast("Couldn't delete hall: " + error.message);
      }
      toast("Hall deleted"); closeDrawers(); loadVenues();
    });
    $("#venueForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = {
        name: f.name.value.trim(), tagline: f.tagline.value.trim() || null, description: f.description.value.trim() || null,
        venue_address: f.venue_address.value.trim() || null,
        capacity: +f.capacity.value, branch: f.branch.value || null, price_from: f.price_from.value === "" ? null : +f.price_from.value,
        google_maps_url: googleMapsInputUrl(f.google_maps_url.value) || null,
        sort_order: +f.sort_order.value || 0, active: f.active.checked, image_url: f.image_url.value || null,
        image_pos: f.image_url.value ? posOk(f.image_pos.value) || null : null
      };
      if (!isGoogleMapsUrl(row.google_maps_url)) return toast("Paste a valid Google Maps URL or iframe embed code.");
      const shares = $$('input[name="shares"]:checked', f).map((x) => x.value);
      row.shares_with = shares;
      const q = isNew ? sb.from("pb_venues").insert(row).select("id").single() : sb.from("pb_venues").update(row).eq("id", v.id);
      const { data: saved, error } = await q;
      // keep the link two-way: add/remove this hall on the other halls too
      const myId = isNew ? saved?.id : v.id;
      if (!error && myId) {
        for (const o of S.venues.filter((x) => x.id !== myId)) {
          const has = (o.shares_with || []).includes(myId), want = shares.includes(o.id);
          if (has === want) continue;
          const next = want ? [...(o.shares_with || []), myId] : (o.shares_with || []).filter((x) => x !== myId);
          const r = await sb.from("pb_venues").update({ shares_with: next }).eq("id", o.id);
          if (r.error) toast(r.error.message);
        }
      }
      if (error) return toast(error.message);
      toast(isNew ? "Hall added — it's live on the website" : "Hall updated");
      closeDrawers(); loadVenues();
    });
    openDrawer("#vdrawer");
  }

  function openOtherVenue() {
    const current = S.otherVenue || C.otherVenue;
    const d = $("#vdrawer");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">Edit venue option</span><h3>${esc(current.name || "Other venues")}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="otherVenueForm">
        ${frameBlock("ovPrev", current.image || "", current.imagePos || "", "land")}
        <label class="field">Photo (JPG/PNG/WebP — resized automatically)<input type="file" id="ovFile" accept="image/jpeg,image/png,image/webp"></label>
        <input type="hidden" name="image" value="${esc(current.image || "")}">
        <label class="field">Name<input name="name" required maxlength="60" value="${esc(current.name || "")}"></label>
        <label class="field">Short tagline<input name="tagline" maxlength="100" value="${esc(current.tagline || "")}"></label>
        <label class="field">Description<textarea name="description" maxlength="500">${esc(current.description || "")}</textarea></label>
        <label class="switch"><input type="checkbox" name="show" ${current.show !== false ? "checked" : ""}> Show on website &amp; booking form</label>
        <button class="btn btn-primary" type="submit">Save changes</button>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    const ovFrame = wireFramer($("#ovPrev"), $("#otherVenueForm"));
    $("#ovFile").addEventListener("change", async (e) => {
      let f = e.target.files[0]; if (!f) return;
      toast("Optimizing photo…");
      f = await prepPhoto(f, 1600); if (!f) return;
      toast("Uploading photo…");
      const path = `venues/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const { error } = await sb.storage.from(C.storageBucket).upload(path, f, { cacheControl: "31536000", upsert: false });
      if (error) return toast("Upload failed: " + error.message);
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      $("#otherVenueForm").elements.namedItem("image").value = url;
      ovFrame.newPhoto(url);
      toast("Photo uploaded — drag it to frame, then save");
    });
    $("#otherVenueForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const value = (name) => f.elements.namedItem(name).value;
      const otherVenue = {
        show: f.elements.namedItem("show").checked, name: value("name").trim(), tagline: value("tagline").trim(),
        description: value("description").trim(), image: value("image").trim(),
        imagePos: value("image") ? posOk(value("image_pos")) || "" : ""
      };
      if (!otherVenue.name) return toast("Name is required.");
      const { error } = await sb.from("pb_settings").update({ other_venue: otherVenue }).eq("id", 1);
      if (error) return toast("Couldn't save Other venues: " + error.message);
      S.otherVenue = otherVenue;
      toast("Other venues updated");
      closeDrawers(); renderVenues();
    });
    openDrawer("#vdrawer");
  }

  // ---------------- packages & services
  // promo codes only work when the required item matches an active package / service name exactly
  const activeServiceName = (name) => (S.services || []).find((x) => x.active && x.name.toLowerCase() === (name || "").trim().toLowerCase())?.name;
  const fillServiceNames = () => { const dl = $("#svcNames"); if (dl) dl.innerHTML = (S.services || []).filter((x) => x.active).map((x) => `<option value="${esc(x.name)}">`).join(""); };
  async function loadServices() {
    const { data, error } = await sb.from("pb_services").select("*").order("sort_order").order("name");
    if (error) return toast(error.message);
    S.services = data; renderServicesAdmin(); fillServiceNames();
  }
  function renderServicesAdmin() {
    const order = C.serviceCategories || [];
    const rank = (c) => (order.indexOf(c) < 0 ? 99 : order.indexOf(c));
    const list = S.services.slice().sort((a, b) => rank(a.category) - rank(b.category) || a.sort_order - b.sort_order);
    let lastCat = null;
    $("#sgrid").innerHTML = list.map((sv) => (sv.category !== lastCat ? `<h4 class="sg-head">${esc((lastCat = sv.category) || "Other")}</h4>` : "") + `
      <div class="vcard">
        <div class="vimg" style="${sv.image_url ? `background-image:url('${esc(sv.image_url)}');background-position:${posOk(sv.image_pos) || "center"}` : ""}">
          <span class="badge ${sv.active ? "b-Confirmed" : "b-Cancelled"}">${sv.active ? "Shown" : "Hidden"}</span>
          ${sv.kind === "Package" ? `<span class="badge" style="left:auto;right:10px;background:var(--ink);color:#fff">Package</span>` : ""}
        </div>
        <div class="vb">
          <h3>${esc(sv.name)}</h3>
          ${sv.description ? `<p>${esc(sv.description)}</p>` : ""}
          ${sv.kind === "Package" ? `<p>${(sv.inclusions || []).length ? `${sv.inclusions.length} included item${sv.inclusions.length > 1 ? "s" : ""}` : `<span style="color:var(--gold)">No inclusions listed yet</span>`}</p>` : ""}
          ${sv.image_url ? "" : `<p style="color:var(--gold)">No photo yet — add one.</p>`}
        </div>
        <div class="vf"><button class="btn btn-outline sm" data-sedit="${sv.id}">Edit</button></div>
      </div>`).join("") + `<button class="vcard add" id="addService"><span><b>+</b>Add a package or service</span></button>`;
    $$("[data-sedit]").forEach((b) => b.addEventListener("click", () => openService(S.services.find((x) => x.id === b.dataset.sedit))));
    $("#addService").addEventListener("click", () => openService(null));
  }
  function openService(sv) {
    const isNew = !sv;
    sv = sv || { name: "", kind: "Service", category: "Event Services", description: "", image_url: "", sort_order: (S.services.at(-1)?.sort_order || 0) + 1, active: true };
    const cats = [...new Set([...(C.serviceCategories || []), sv.category].filter(Boolean))];
    const d = $("#vdrawer");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${isNew ? "New" : "Edit"} package / service</span><h3>${esc(sv.name || "Add an item")}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="svcForm">
        ${frameBlock("sPrev", sv.image_url, sv.image_pos, "land")}
        <label class="field">Photo (JPG/PNG/WebP — resized automatically)<input type="file" id="sFile" accept="image/jpeg,image/png,image/webp"></label>
        <input type="hidden" name="image_url" value="${esc(sv.image_url || "")}">
        <label class="field">Name<input name="name" required maxlength="60" value="${esc(sv.name)}" placeholder="e.g. Balloon Arch"></label>
        <div class="grid-2">
          <label class="field">Group (tab in the booking form)<select name="category">${cats.map((c) => `<option ${c === sv.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
          <label class="field">Type<select name="kind">${["Package", "Service"].map((k) => `<option ${k === sv.kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>
          <label class="field">Display order<input type="number" name="sort_order" value="${sv.sort_order}"></label>
        </div>
        <label class="field">Short description<input name="description" maxlength="140" value="${esc(sv.description || "")}" placeholder="One or two lines, shown when a customer taps the card"></label>
        <label class="field" id="incWrap">What's included (one item per line)
          <textarea name="inclusions" rows="8" placeholder="Example (type your own list):&#10;Event hall&#10;Balloon decorations&#10;Tables and chairs&#10;Catering&#10;Photobooth">${esc((sv.inclusions || []).join("\n"))}</textarea>
          <span class="hint" style="text-transform:none;letter-spacing:0">Shown to customers when they tap this package. Leave empty to say the team will share the inclusions.</span>
        </label>
        <label class="switch"><input type="checkbox" name="active" ${sv.active ? "checked" : ""}> Show in the booking form</label>
        ${isNew ? "" : `<p class="hint" style="margin:0">Renaming won't change bookings already made with the old name.</p>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit">${isNew ? "Add" : "Save changes"}</button>
          ${isNew ? "" : `<button class="btn btn-outline" type="button" id="sDel">Delete</button>`}
        </div>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    const syncInc = () => ($("#incWrap").hidden = $("#svcForm").kind.value !== "Package");
    $("#svcForm").kind.addEventListener("change", syncInc); syncInc();
    const sFrame = wireFramer($("#sPrev"), $("#svcForm"));
    $("#sFile").addEventListener("change", async (e) => {
      let f = e.target.files[0]; if (!f) return;
      toast("Optimizing photo…");
      f = await prepPhoto(f, 1000); if (!f) return;
      toast("Uploading photo…");
      const path = `services/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const { error } = await sb.storage.from(C.storageBucket).upload(path, f, { cacheControl: "31536000" });
      if (error) return toast("Upload failed: " + error.message);
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      $("#svcForm").image_url.value = url; sFrame.newPhoto(url);
      toast("Photo uploaded — drag it to frame, then save");
    });
    $("#sDel")?.addEventListener("click", async () => {
      if (!confirm(`Delete “${sv.name}”? Tip: untick “Show in the booking form” to hide it instead.`)) return;
      const { error } = await sb.from("pb_services").delete().eq("id", sv.id);
      if (error) return toast(error.message);
      toast("Deleted"); closeDrawers(); loadServices();
    });
    $("#svcForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = { name: f.name.value.trim(), kind: f.kind.value, category: f.category.value, description: f.description.value.trim() || null,
        image_url: f.image_url.value || null, image_pos: f.image_url.value ? posOk(f.image_pos.value) || null : null,
        sort_order: +f.sort_order.value || 0, active: f.active.checked,
        inclusions: f.kind.value === "Package" ? f.inclusions.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 40) : [] };
      if (!row.name) return toast("Name is required.");
      const { error } = isNew ? await sb.from("pb_services").insert(row) : await sb.from("pb_services").update(row).eq("id", sv.id);
      if (error) return toast(error.code === "23505" ? "There's already an item with that name." : error.message);
      toast(isNew ? "Added — it's now in the booking form" : "Saved"); closeDrawers(); loadServices();
    });
    openDrawer("#vdrawer");
  }

  // ---------------- gallery
  const catOpts = (sel) => C.galleryCategories.map((c) => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
  $("#gUpload").category.innerHTML = catOpts("Birthday");
  $("#gFilter").innerHTML = `<option value="">All occasions</option>` + catOpts("");
  $("#gFilter").value = "";
  $("#gFilter").addEventListener("input", renderGalleryAdmin);

  async function loadGallery() {
    const { data, error } = await sb.from("pb_gallery").select("*").order("sort_order").order("created_at", { ascending: false });
    if (error) return toast(error.message);
    S.gallery = data;
    await saveGalleryOrder(galleryOrdered(), true);   // keep the numbers 1, 2, 3… with no gaps or duplicates
    renderGalleryAdmin();
  }
  // Gallery order works like positions in a list: moving a photo to position N shifts the photos in between,
  // e.g. moving photo 6 to 26 makes photo 7 the new 6 (a number past the end puts it last).
  const galleryOrdered = () => (S.gallery || []).slice().sort((a, b) => a.sort_order - b.sort_order || new Date(b.created_at) - new Date(a.created_at));
  async function saveGalleryOrder(list, quiet) {
    const changes = list.map((g, i) => [g, i + 1]).filter(([g, n]) => g.sort_order !== n);
    if (!changes.length) return true;
    const res = await Promise.all(changes.map(([g, n]) => sb.from("pb_gallery").update({ sort_order: n }).eq("id", g.id)));
    const failed = res.find((r) => r.error);
    if (failed) { if (!quiet) toast("Couldn't save the new order: " + failed.error.message); return false; }
    changes.forEach(([g, n]) => (g.sort_order = n));
    return true;
  }
  async function moveGallery(id, pos) {
    const list = galleryOrdered(), from = list.findIndex((g) => g.id === id);
    if (from < 0) return;
    const [g] = list.splice(from, 1);
    const to = Math.min(Math.max(Math.round(+pos) || 1, 1), list.length + 1);
    list.splice(to - 1, 0, g);
    if (await saveGalleryOrder(list)) toast(to === from + 1 ? "Order unchanged" : `Moved to position ${to}${to === list.length ? " (last)" : ""}`);
    renderGalleryAdmin();
  }
  function renderGalleryAdmin() {
    const f = $("#gFilter").value;
    const list = galleryOrdered().filter((g) => !f || g.category === f);
    const samples = (S.gallery || []).filter((g) => g.is_sample).length;
    $("#gCount").textContent = `${list.length} photo${list.length === 1 ? "" : "s"}` + (samples ? ` · ${samples} sample photo${samples > 1 ? "s" : ""} to replace with real event photos` : "");
    $("#gAdmin").innerHTML = list.map((g) => `
      <div class="gcard ${g.active ? "" : "dim"}" data-id="${g.id}">
        <div class="gimg" style="background-image:url('${esc(g.image_url)}')">${g.is_sample ? `<span class="badge b-Pending">Sample</span>` : g.active ? "" : `<span class="badge b-Cancelled">Hidden</span>`}</div>
        <div class="gb">
          <input data-f="caption" value="${esc(g.caption || "")}" placeholder="Caption" maxlength="80">
          <select data-f="category">${catOpts(g.category)}</select>
          <div class="gf">
            <label><input type="checkbox" data-f="active" ${g.active ? "checked" : ""} style="width:auto"> Show</label>
            <input type="number" data-f="sort_order" min="1" value="${g.sort_order}" title="Position on the website (1 shows first)" style="width:64px">
            <span class="g-acts"><button class="linkbtn" data-gedit type="button">Edit</button><button class="linkbtn" data-del type="button">Delete</button></span>
          </div>
        </div>
      </div>`).join("") || `<p class="hint">No photos yet.</p>`;
    $$("#gAdmin .gcard").forEach((card) => {
      const id = card.dataset.id;
      $$("[data-f]", card).forEach((el) => el.addEventListener("change", async () => {
        if (el.dataset.f === "sort_order") return moveGallery(id, el.value);
        const v = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value || 0 : el.value.trim() || null;
        const { error } = await sb.from("pb_gallery").update({ [el.dataset.f]: v }).eq("id", id);
        if (error) return toast(error.message);
        Object.assign(S.gallery.find((g) => g.id === id), { [el.dataset.f]: v });
        if (el.dataset.f === "active") renderGalleryAdmin();
        toast("Saved");
      }));
      $("[data-gedit]", card).addEventListener("click", () => openGalleryEdit(S.gallery.find((x) => x.id === id)));
      $("[data-del]", card).addEventListener("click", async () => {
        if (!confirm("Delete this photo from the gallery?")) return;
        const g = S.gallery.find((x) => x.id === id);
        const { error } = await sb.from("pb_gallery").delete().eq("id", id);
        if (error) return toast(error.message);
        const marker = `/object/public/${C.storageBucket}/`;
        if (g.image_url.includes(marker)) sb.storage.from(C.storageBucket).remove([decodeURIComponent(g.image_url.split(marker)[1])]);
        S.gallery = S.gallery.filter((x) => x.id !== id); await saveGalleryOrder(galleryOrdered(), true); renderGalleryAdmin(); toast("Photo deleted");
      });
    });
  }
  // edit one gallery photo: bigger preview, replace the photo, caption, occasion, show and order
  const storagePath = (url) => { const marker = `/object/public/${C.storageBucket}/`; return url && url.includes(marker) ? decodeURIComponent(url.split(marker)[1]) : null; };
  function openGalleryEdit(g) {
    if (!g) return;
    const d = $("#vdrawer");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">Edit gallery photo</span><h3>${esc(g.caption || g.category || "Photo")}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="gEditForm">
        <div class="g-edit-prev"><img id="gEditImg" src="${esc(g.image_url)}" alt=""></div>
        <label class="field">Replace photo (JPG/PNG/WebP — resized automatically)<input type="file" id="gEditFile" accept="image/jpeg,image/png,image/webp"></label>
        <input type="hidden" name="image_url" value="${esc(g.image_url)}">
        <label class="field">Caption<input name="caption" maxlength="80" value="${esc(g.caption || "")}" placeholder="e.g. Princess-themed 7th birthday, Hall A&amp;B"></label>
        <div class="grid-2">
          <label class="field">Occasion<select name="category">${catOpts(g.category)}</select></label>
          <label class="field">Position (1 shows first)<input type="number" name="sort_order" min="1" value="${g.sort_order}"></label>
        </div>
        <label class="switch"><input type="checkbox" name="active" ${g.active ? "checked" : ""}> Show on website</label>
        <button class="btn btn-primary" type="submit">Save changes</button>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    const form = $("#gEditForm");
    $("#gEditFile").addEventListener("change", async (e) => {
      let f = e.target.files[0]; if (!f) return;
      toast("Optimizing photo…");
      f = await prepPhoto(f, 1600); if (!f) return;
      toast("Uploading photo…");
      const path = `gallery/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const { error } = await sb.storage.from(C.storageBucket).upload(path, f, { cacheControl: "31536000" });
      if (error) return toast("Upload failed: " + error.message);
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      form.image_url.value = url; $("#gEditImg").src = url;
      toast("New photo ready — press Save changes");
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const row = { image_url: form.image_url.value, caption: form.caption.value.trim() || null, category: form.category.value,
        active: form.active.checked };
      const newPos = +form.sort_order.value || g.sort_order;
      if (row.image_url !== g.image_url) row.is_sample = false;
      const { error } = await sb.from("pb_gallery").update(row).eq("id", g.id);
      if (error) return toast(error.message);
      const oldPath = row.image_url !== g.image_url ? storagePath(g.image_url) : null;
      if (oldPath) sb.storage.from(C.storageBucket).remove([oldPath]);   // tidy up the replaced file
      Object.assign(g, row); closeDrawers();
      const moved = newPos !== g.sort_order;
      if (moved) await moveGallery(g.id, newPos); else renderGalleryAdmin();
      toast(moved ? `Photo updated and moved to position ${g.sort_order}` : "Photo updated");
    });
    openDrawer("#vdrawer");
  }
  $("#gUpload").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, files = [...f.files.files], btn = f.querySelector("button");
    const big = files.filter((x) => x.size > MAX_ORIGINAL);
    if (big.length) return toast(`${big.length} photo(s) are over 25 MB — please use smaller ones.`);
    btn.disabled = true;
    const minOrder = Math.min(0, ...(S.gallery || []).map((g) => g.sort_order)) - files.length;
    let done = 0, failed = 0;
    for (let [i, file] of files.entries()) {
      $("#gProgress").textContent = `Optimizing & uploading ${i + 1} of ${files.length}…`;
      file = await shrinkImage(file, 1600);
      if (file.size > 5 * 1024 * 1024) { failed++; continue; }
      const path = `gallery/${Date.now()}-${i}-${file.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const up = await sb.storage.from(C.storageBucket).upload(path, file, { cacheControl: "31536000" });
      if (up.error) { failed++; continue; }
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from("pb_gallery").insert({ image_url: url, caption: f.caption.value.trim() || null, category: f.category.value, sort_order: minOrder + i });
      error ? failed++ : done++;
    }
    btn.disabled = false;
    $("#gProgress").textContent = `${done} photo${done === 1 ? "" : "s"} added${failed ? `, ${failed} failed` : ""}.`;
    f.files.value = ""; f.caption.value = "";
    loadGallery();
  });

  // ---------------- reviews
  const SOURCES = ["Website", "Facebook", "Google", "Instagram", "WhatsApp"];
  const RSTAT = { Pending: "b-Pending", Approved: "b-Confirmed", Hidden: "b-Cancelled" };
  const starStr = (n) => "★".repeat(n) + `<span class="off">${"★".repeat(5 - n)}</span>`;
  $("#rFilter").addEventListener("input", renderReviewsAdmin);
  $("#rAdd").addEventListener("click", () => openReview(null));

  async function loadReviews() {
    const { data, error } = await sb.from("pb_reviews").select("*").order("created_at", { ascending: false });
    if (error) return toast(error.message);
    S.reviews = data; renderReviewsAdmin();
  }
  function renderReviewsAdmin() {
    const pend = S.reviews.filter((r) => r.status === "Pending").length;
    $("#rPendingCount").hidden = !pend; $("#rPendingCount").textContent = pend;
    const f = $("#rFilter").value;
    const list = S.reviews.filter((r) => !f || r.status === f);
    const appr = S.reviews.filter((r) => r.status === "Approved");
    $("#rCount").textContent = `${list.length} shown · ${appr.length} on website` + (appr.length ? ` · average ${(appr.reduce((s, r) => s + r.rating, 0) / appr.length).toFixed(1)}★` : "");
    $("#rAdmin").innerHTML = list.map((r) => `
      <div class="rcard ${r.featured ? "feat" : ""}" data-id="${r.id}">
        <div class="rtop">
          <span class="stars">${starStr(r.rating)}</span>
          <b>${esc(r.name)}</b>
          <small>${[r.event_type, "via " + r.source, fmtStamp(r.created_at)].filter(Boolean).map(esc).join(" · ")}</small>
          <span class="badge ${RSTAT[r.status]}" style="margin-left:auto">${r.status}</span>
          ${r.featured ? `<span class="badge" style="background:#F6EBD6;color:#8A6420">★ Featured</span>` : ""}
        </div>
        <p>${r.comment ? esc(r.comment) : `<i style="color:var(--muted)">Rating only — no written review</i>`}</p>
        <div class="ract">
          ${r.status !== "Approved" ? `<button class="btn btn-primary sm" data-a="approve">Approve</button>` : ""}
          ${r.status !== "Hidden" ? `<button class="btn btn-outline sm" data-a="hide">Hide</button>` : ""}
          <button class="btn btn-outline sm" data-a="feature">${r.featured ? "Unfeature" : "Feature"}</button>
          <button class="btn btn-outline sm" data-a="edit">✎ Edit</button>
          <button class="linkbtn" data-a="delete" style="margin-left:auto">Delete</button>
        </div>
      </div>`).join("") || `<p class="hint">No reviews here yet.</p>`;
    $$("#rAdmin .rcard").forEach((card) => {
      const r = S.reviews.find((x) => x.id === card.dataset.id);
      $$("[data-a]", card).forEach((b) => b.addEventListener("click", async () => {
        const a = b.dataset.a;
        if (a === "edit") return openReview(r);
        if (a === "delete") {
          if (!confirm(`Delete the review from ${r.name}?`)) return;
          const { error } = await sb.from("pb_reviews").delete().eq("id", r.id);
          if (error) return toast(error.message);
          toast("Review deleted"); return loadReviews();
        }
        const patch = a === "approve" ? { status: "Approved" } : a === "hide" ? { status: "Hidden", featured: false } : { featured: !r.featured, ...(r.featured ? {} : { status: "Approved" }) };
        const { error } = await sb.from("pb_reviews").update(patch).eq("id", r.id);
        if (error) return toast(error.message);
        toast(a === "approve" ? "Approved — now on the website" : a === "hide" ? "Hidden from the website" : r.featured ? "Unfeatured" : "Featured — shows first on the website");
        loadReviews();
      }));
    });
  }
  function openReview(r) {
    const isNew = !r;
    r = r || { name: "", event_type: "", rating: 5, comment: "", source: "Facebook", status: "Approved", featured: false };
    const d = $("#vdrawer");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${isNew ? "Add review" : "Edit review"}</span><h3>${esc(r.name || "New review")}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="revForm">
        ${isNew ? `<p class="hint" style="margin:0">Only add reviews customers actually wrote (e.g. copied from your Facebook or Google reviews).</p>` : ""}
        <label class="field">Customer name<input name="name" required maxlength="80" value="${esc(r.name)}"></label>
        <div class="grid-2">
          <label class="field">Rating<select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${n === r.rating ? "selected" : ""}>${"★".repeat(n)} (${n})</option>`).join("")}</select></label>
          <label class="field">Occasion<select name="event_type"><option value="">—</option>${[...new Set([...C.eventTypes, r.event_type].filter(Boolean))].map((t) => `<option ${t === r.event_type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label class="field">Source<select name="source">${SOURCES.map((s) => `<option ${s === r.source ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label class="field">Status<select name="status">${["Pending", "Approved", "Hidden"].map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        </div>
        <label class="field">Review (optional — leave blank for a rating only)<textarea name="comment" maxlength="1200" rows="6" placeholder="Leave empty to show just the star rating">${esc(r.comment || "")}</textarea></label>
        <label class="switch"><input type="checkbox" name="featured" ${r.featured ? "checked" : ""}> Featured (shows first on the website)</label>
        <button class="btn btn-primary" type="submit">${isNew ? "Add review" : "Save changes"}</button>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    $("#revForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = { name: f.name.value.trim(), rating: +f.rating.value, event_type: f.event_type.value || null, source: f.source.value,
        status: f.status.value, comment: f.comment.value.trim(), featured: f.featured.checked };
      if (!row.name) return toast("Customer name is required.");
      const { error } = isNew ? await sb.from("pb_reviews").insert(row) : await sb.from("pb_reviews").update(row).eq("id", r.id);
      if (error) return toast(error.message);
      toast(isNew ? "Review added" : "Review updated"); closeDrawers(); loadReviews();
    });
    openDrawer("#vdrawer");
  }

  // ---------------- settings & admins
  async function loadSettings() {
    const { data, error } = await sb.from("pb_settings").select("*").eq("id", 1).maybeSingle();
    if (error) return toast("Couldn't load settings: " + error.message);
    if (!data) return;
    const f = $("#settingsForm");
    f.booking_whatsapp.value = data.booking_whatsapp.replace(/^971/, "0");
    f.display_phones.value = data.display_phones;
    S.settings = data;
    const g = $("#invoiceSettingsForm");
    g.business_name.value = data.business_name;
    g.business_address.value = data.business_address;
    g.payment_details.value = data.payment_details;
    g.invoice_footer.value = data.invoice_footer;
    g.next_no.value = data.invoice_counter + 1;
    S.otherVenue = data.other_venue || C.otherVenue;
    renderVenues();
  }
  $("#invoiceSettingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = e.target, next = parseInt(g.next_no.value, 10);
    if (!(next > 0)) return toast("Next invoice number must be a positive number.");
    const { error } = await sb.from("pb_settings").update({
      business_name: g.business_name.value.trim(), business_address: g.business_address.value.trim(),
      payment_details: g.payment_details.value.trim(), invoice_footer: g.invoice_footer.value.trim(), invoice_counter: next - 1
    }).eq("id", 1);
    if (error) return toast(error.message);
    toast("Invoice settings saved"); loadSettings();
  });
  $("#settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const num = intl(e.target.booking_whatsapp.value);
    if (num.length < 10) return toast("Please enter a valid WhatsApp number.");
    const { error } = await sb.from("pb_settings").update({ booking_whatsapp: num, display_phones: e.target.display_phones.value.trim() }).eq("id", 1);
    toast(error ? error.message : "Settings saved — the website uses them right away");
  });

  async function loadAdmins() {
    const { data } = await sb.from("pb_admins").select("email").order("email");
    S.admins = data || [];
    const me = (S.user.email || "").toLowerCase();
    $("#adminsList").innerHTML = S.admins.map((a) => a.email.toLowerCase() === me
      ? `<li><span>${esc(a.email)}</span><small style="color:var(--muted)">you</small></li>`
      : `<li class="adm-row"><span>${esc(a.email)}</span><span class="adm-acts"><button class="linkbtn" data-pw="${esc(a.email)}">Set password</button><button class="linkbtn" data-rm="${esc(a.email)}">Remove</button></span>
          <form class="adm-pw" hidden>
            <input type="password" name="password" minlength="8" autocomplete="new-password" placeholder="New password" required>
            <input type="password" name="confirm" minlength="8" autocomplete="new-password" placeholder="Repeat password" required>
            <button class="btn btn-primary sm" type="submit">Save</button><button class="btn btn-outline sm" type="button" data-cancel>Cancel</button>
          </form></li>`).join("");
    $$("[data-pw]").forEach((b) => b.addEventListener("click", () => {
      const f = $(".adm-pw", b.closest("li"));
      $$(".adm-pw").forEach((o) => { if (o !== f) o.hidden = true; });
      f.hidden = !f.hidden; if (!f.hidden) f.password.focus();
    }));
    $$(".adm-pw").forEach((f) => {
      $("[data-cancel]", f).addEventListener("click", () => { f.reset(); f.hidden = true; });
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = $("[data-pw]", f.closest("li")).dataset.pw;
        if (f.password.value.length < 8) return toast("Use a password with at least 8 characters.");
        if (f.password.value !== f.confirm.value) return toast("The two passwords don't match.");
        const btn = $("button[type=submit]", f); btn.disabled = true;
        const { data, error } = await sb.functions.invoke("admin-create-user", { body: { action: "set_password", email, password: f.password.value } });
        btn.disabled = false;
        if (error) {
          let message = error.message;
          try { const d = await error.context?.json?.(); if (d?.error) message = d.error; } catch (_) {}
          return toast("Couldn't set password: " + message);
        }
        if (data?.success !== true) return toast("The admin service returned an unexpected response. Please try again.");
        f.reset(); f.hidden = true;
        toast(`Password updated for ${email}. Share it with them securely.`);
      });
    });
    $$("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Remove admin access for ${b.dataset.rm}?`)) return;
      const { error } = await sb.from("pb_admins").delete().eq("email", b.dataset.rm);
      if (error) return toast(error.message);
      loadAdmins();
    }));
  }
  // change the signed-in admin's own password (current password checked first)
  $("#myPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value.length < 8) return toast("Use a password with at least 8 characters.");
    if (f.password.value !== f.confirm.value) return toast("The two new passwords don't match.");
    if (f.password.value === f.current.value) return toast("Choose a new password that's different from the current one.");
    const btn = $("button[type=submit]", f); btn.disabled = true;
    const { error: checkError } = await sb.auth.signInWithPassword({ email: S.user.email, password: f.current.value });
    if (checkError) { btn.disabled = false; return toast(checkError.message === "Invalid login credentials" ? "Your current password is incorrect." : checkError.message); }
    const { error } = await sb.auth.updateUser({ password: f.password.value });
    btn.disabled = false;
    if (error) return toast("Couldn't update your password: " + error.message);
    f.reset();
    toast("Your password has been updated.");
  });

  $("#addAdminForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    if (password.length < 8) return toast("Use a password with at least 8 characters.");
    const wasAlreadyAllowlisted = S.admins.some((admin) => admin.email.toLowerCase() === email);
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    let result;
    try {
      result = await sb.functions.invoke("admin-create-user", { body: { email, password } });
    } catch (error) {
      button.disabled = false;
      return toast("Couldn't add admin: " + (error.message || "The admin service could not be reached."));
    }
    button.disabled = false;
    const { data, error } = result;
    if (error) {
      let message = error.message;
      try {
        const details = await error.context?.json?.();
        if (details?.error) message = details.error;
      } catch (parseError) {
        console.warn("Could not read the admin creation error response:", parseError);
      }
      return toast("Couldn't add admin: " + message);
    }
    if (data?.success !== true || typeof data.email !== "string" || data.email.toLowerCase() !== email) {
      if (!wasAlreadyAllowlisted) {
        const { data: admin, error: verifyError } = await sb.from("pb_admins").select("email").eq("email", email).maybeSingle();
        if (verifyError) return toast("The service response was unclear and the new admin could not be verified: " + verifyError.message);
        if (admin) {
          form.reset();
          toast(`Admin ${admin.email} added. Refreshing the admin list.`);
          return loadAdmins();
        }
      }
      return toast("The admin service returned an unexpected response. Redeploy the latest admin-create-user function, then try again.");
    }
    form.reset();
    toast(`Admin ${email} added`);
    loadAdmins();
  });

  // ---------------- promo codes
  async function loadPromos() {
    const [{ data, error }, { data: stats, error: statsError }] = await Promise.all([
      sb.from("pb_promo_codes").select("*").order("created_at", { ascending: false }),
      sb.rpc("pb_admin_promo_stats")
    ]);
    if (error || statsError) {
      const message = error?.message || statsError?.message;
      $("#promoRows").innerHTML = `<tr><td colspan="6" class="empty">Couldn't load promo codes: ${esc(message)}</td></tr>`;
      return;
    }
    const counts = new Map((stats || []).map((item) => [item.promo_code, Number(item.used_count)]));
    S.promos = (data || []).map((promo) => ({ ...promo, used_count: counts.get(promo.code) || 0 }));
    renderPromos();
  }

  function renderPromos() {
    $("#promoRows").innerHTML = S.promos.length ? S.promos.map((promo) => `
      <tr data-promo-row="${esc(promo.code)}">
        <td class="promo-code">${esc(promo.code)}</td>
        <td><select data-promo-field="discount_type" aria-label="Discount type for ${esc(promo.code)}"><option value="percentage" ${promo.discount_type === "percentage" ? "selected" : ""}>%</option><option value="fixed" ${promo.discount_type === "fixed" ? "selected" : ""}>AED</option></select>
          <input type="number" min="0.01" ${promo.discount_type === "percentage" ? 'max="100"' : ""} step="0.01" data-promo-field="discount_value" value="${esc(promo.discount_value)}" aria-label="Discount value for ${esc(promo.code)}"></td>
        <td><input type="text" maxlength="120" list="svcNames" data-promo-field="required_item" value="${esc(promo.required_item)}" aria-label="Required selection for ${esc(promo.code)}"></td>
        <td><input type="number" min="1" step="1" data-promo-field="max_uses" value="${esc(promo.max_uses)}" aria-label="Maximum bookings for ${esc(promo.code)}"><small>${promo.used_count} used</small></td>
        <td><label class="switch"><input type="checkbox" data-promo-field="is_active" ${promo.is_active ? "checked" : ""}> ${promo.is_active ? "Active" : "Paused"}</label></td>
        <td><div class="promo-actions">
          <button type="button" class="btn btn-outline sm" data-promo-save="${esc(promo.code)}">Save</button>
          <button type="button" class="btn btn-outline sm" data-promo-delete="${esc(promo.code)}" ${promo.used_count ? "disabled title=\"This code has redemption history; pause it instead.\"" : ""}>Delete</button>
        </div></td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">No promo codes yet.</td></tr>`;
    $$("[data-promo-save]").forEach((button) => button.addEventListener("click", () => savePromo(button.dataset.promoSave)));
    $$("[data-promo-delete]").forEach((button) => button.addEventListener("click", () => deletePromo(button.dataset.promoDelete)));
    $$("#promoRows [data-promo-field='discount_type']").forEach((select) => select.addEventListener("change", () => {
      const input = $('[data-promo-field="discount_value"]', select.closest("td"));
      if (select.value === "percentage") input.max = "100";
      else input.removeAttribute("max");
    }));
    $$("#promoRows [data-promo-field='is_active']").forEach((checkbox) => checkbox.addEventListener("change", () => {
      checkbox.closest("label").lastChild.textContent = checkbox.checked ? " Active" : " Paused";
    }));
  }
  $("#promoForm [name='discount_type']").addEventListener("change", (e) => {
    const input = $("#promoForm [name='discount_value']");
    if (e.target.value === "percentage") input.max = "100";
    else input.removeAttribute("max");
  });

  async function savePromo(code) {
    const row = $(`[data-promo-row="${CSS.escape(code)}"]`);
    const discountType = $('[data-promo-field="discount_type"]', row).value;
    const discountValue = Number($('[data-promo-field="discount_value"]', row).value);
    const maxUses = Number($('[data-promo-field="max_uses"]', row).value);
    let requiredItem = $('[data-promo-field="required_item"]', row).value.trim();
    if (S.services?.length && !activeServiceName(requiredItem)) return toast(`“${requiredItem}” isn't an active package or service, so the code could never apply. Pick a name from the list.`);
    requiredItem = activeServiceName(requiredItem) || requiredItem;
    if (!(discountValue > 0) || (discountType === "percentage" && discountValue > 100) || !Number.isInteger(maxUses) || maxUses < 1 || !requiredItem) {
      return toast("Enter a positive discount value (up to 100% for percentage discounts), a required selection, and a positive whole-number limit.");
    }
    const { error } = await sb.from("pb_promo_codes").update({
      discount_type: discountType, discount_value: discountValue, required_item: requiredItem, max_uses: maxUses,
      is_active: $('[data-promo-field="is_active"]', row).checked
    }).eq("code", code);
    if (error) return toast("Couldn't save promo code: " + error.message);
    toast(`Promo code ${code} saved`);
    loadPromos();
  }

  async function deletePromo(code) {
    const promo = S.promos.find((item) => item.code === code);
    if (!promo) return toast("Couldn't find that promo code. Refresh the list and try again.");
    if (promo.used_count) return toast("This code has redemption history and can't be deleted. Pause it instead.");
    if (!confirm(`Delete promo code ${code}? This cannot be undone.`)) return;
    const { error } = await sb.from("pb_promo_codes").delete().eq("code", code);
    if (error) {
      if (error.code === "23503") return toast("This code now has redemption history and can't be deleted. Pause it instead.");
      return toast("Couldn't delete promo code: " + error.message);
    }
    S.promos = S.promos.filter((item) => item.code !== code);
    renderPromos();
    toast(`Promo code ${code} deleted`);
  }

  $("#promoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const code = form.code.value.trim().toUpperCase();
    const discountType = form.discount_type.value;
    const discountValue = Number(form.discount_value.value);
    const maxUses = Number(form.max_uses.value);
    let requiredItem = form.required_item.value.trim();
    if (S.services?.length && !activeServiceName(requiredItem)) return toast(`“${requiredItem}” isn't an active package or service, so the code could never apply. Pick a name from the list.`);
    requiredItem = activeServiceName(requiredItem) || requiredItem;
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return toast("Use 2–40 letters, numbers, hyphens, or underscores for the code.");
    if (!(discountValue > 0) || (discountType === "percentage" && discountValue > 100) || !Number.isInteger(maxUses) || maxUses < 1 || !requiredItem) {
      return toast("Enter a positive discount value (up to 100% for percentage discounts), a required selection, and a positive whole-number limit.");
    }
    const { error } = await sb.from("pb_promo_codes").insert({
      code, discount_type: discountType, discount_value: discountValue, required_item: requiredItem,
      max_uses: maxUses, is_active: form.is_active.checked
    });
    if (error) return toast(error.code === "23505" ? "That promo code already exists." : "Couldn't create promo code: " + error.message);
    form.reset();
    form.discount_type.value = "percentage";
    form.discount_value.value = "15";
    form.discount_value.max = "100";
    form.required_item.value = "";
    form.max_uses.value = "10";
    form.is_active.checked = true;
    toast(`Promo code ${code} created`);
    loadPromos();
  });

  boot();
})();

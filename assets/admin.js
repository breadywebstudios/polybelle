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
  const waLink = (num, text) => `https://wa.me/${intl(num)}${text ? "?text=" + encodeURIComponent(text) : ""}`;
  const S = { bookings: [], venues: [], admins: [], statusFilter: "", user: null };

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); }
  function setMsg(el, text, kind) { el.textContent = text || ""; el.className = "msg" + (text ? " " + kind : ""); }

  // ---------------- auth
  async function boot() {
    const isRecovery = location.hash.includes("type=recovery");
    sb.auth.onAuthStateChange((evt) => { if (evt === "PASSWORD_RECOVERY") showReset(); });
    const { data: { session } } = await sb.auth.getSession();
    if (isRecovery && session) return showReset();
    if (session) return enter(session.user);
    showLogin();
  }
  function showLogin() { $("#loginView").style.display = ""; $("#resetView").style.display = "none"; $("#appView").classList.remove("on"); }
  function showReset() { $("#loginView").style.display = "none"; $("#resetView").style.display = ""; $("#appView").classList.remove("on"); }

  async function enter(user) {
    const { data: ok, error } = await sb.rpc("pb_is_admin");
    if (error || !ok) {
      await sb.auth.signOut();
      showLogin();
      return setMsg($("#loginMsg"), "This account doesn't have Polybelle admin access.", "err");
    }
    S.user = user;
    $("#whoEmail").textContent = user.email;
    $("#loginView").style.display = "none"; $("#resetView").style.display = "none";
    $("#appView").classList.add("on");
    await Promise.all([loadVenues(), loadBookings(), loadSettings(), loadAdmins()]);
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
  $("#forgotBtn").addEventListener("click", async () => {
    const email = $("#loginForm").email.value.trim();
    if (!email) return setMsg($("#loginMsg"), "Type your email above first, then tap “Forgot password?”.", "err");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setMsg($("#loginMsg"), error ? error.message : "Check your email for a link to set your password.", error ? "err" : "ok");
  });
  $("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data, error } = await sb.auth.updateUser({ password: e.target.password.value });
    if (error) return setMsg($("#resetMsg"), error.message, "err");
    history.replaceState(null, "", location.pathname);
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
    const { data, error } = await sb.from("pb_bookings").select("*").order("event_date", { ascending: true }).limit(2000);
    if (error) { if (!quiet) toast("Couldn't load bookings: " + error.message); return; }
    const newPending = S.bookings.length && data.filter((b) => b.status === "Pending" && !S.bookings.some((o) => o.id === b.id)).length;
    S.bookings = data;
    renderBookings();
    if (quiet && newPending) toast(`${newPending} new booking request${newPending > 1 ? "s" : ""}`);
  }

  function filtered() {
    const q = $("#q").value.trim().toLowerCase();
    const v = $("#fVenue").value, when = $("#fWhen").value, t = today();
    let list = S.bookings.filter((b) =>
      (!S.statusFilter || b.status === S.statusFilter) &&
      (!v || b.venue_id === v) &&
      (when === "all" || (when === "upcoming" ? b.event_date >= t : b.event_date < t)) &&
      (!q || [b.ref, b.name, b.phone, b.email, b.venue_name, b.event_type].join(" ").toLowerCase().includes(q)));
    if ($("#fSort").value === "new") list = list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (when === "past") list = list.slice().reverse();
    return list;
  }

  function renderBookings() {
    const t = today();
    const up = S.bookings.filter((b) => b.event_date >= t);
    const count = (s) => up.filter((b) => b.status === s).length;
    const stats = [["", "Upcoming", up.length], ["Pending", "Pending", count("Pending")], ["Confirmed", "Confirmed", count("Confirmed")],
      ["Completed", "Completed", S.bookings.filter((b) => b.status === "Completed").length], ["Cancelled", "Cancelled", S.bookings.filter((b) => b.status === "Cancelled").length]];
    $("#stats").innerHTML = stats.map(([k, label, n]) => `<button class="stat ${S.statusFilter === k ? "active" : ""}" data-k="${k}"><span>${label}</span><b>${n}</b></button>`).join("")
      + `<button class="stat" id="newBookingBtn" style="display:grid;place-items:center;border-style:dashed"><span style="color:var(--rose)">+ Add booking</span></button>`;
    $$("#stats .stat[data-k]").forEach((b) => b.addEventListener("click", () => {
      S.statusFilter = b.dataset.k;
      if (["Completed", "Cancelled"].includes(b.dataset.k)) $("#fWhen").value = "all";
      renderBookings();
    }));
    $("#newBookingBtn").addEventListener("click", () => openBooking(null));

    const list = filtered();
    $("#rows").innerHTML = list.length ? list.map((b) => `
      <tr class="row" data-id="${b.id}">
        <td><b>${esc(fmtDate(b.event_date))}</b><small>${esc(b.session)}</small></td>
        <td>${esc(b.venue_name)}</td>
        <td>${esc(b.name)}<small>${esc(b.phone)}</small></td>
        <td class="hide-sm">${esc(b.event_type)}</td>
        <td class="hide-sm">${b.guests ?? "—"}</td>
        <td><span class="badge b-${b.status}">${b.status}</span></td>
        <td class="hide-sm"><small>${esc(b.ref)}</small><small>${fmtStamp(b.created_at)}</small></td>
      </tr>`).join("") : `<tr><td colspan="7" class="empty">No bookings match these filters.</td></tr>`;
    $$("#rows tr.row").forEach((r) => r.addEventListener("click", () => openBooking(S.bookings.find((b) => b.id === r.dataset.id))));
  }
  ["#q", "#fVenue", "#fWhen", "#fSort"].forEach((s) => $(s).addEventListener("input", renderBookings));
  $("#refreshBtn").addEventListener("click", () => loadBookings().then(() => toast("Bookings refreshed")));

  $("#csvBtn").addEventListener("click", () => {
    const cols = ["ref", "status", "event_date", "session", "venue_name", "event_type", "guests", "add_ons", "name", "phone", "email", "notes", "admin_notes", "created_at"];
    const cell = (v) => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
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

  function customerMsg(b, status) {
    const when = `${fmtDate(b.event_date)} (${b.session})`;
    const msgs = {
      Confirmed: `Hi ${b.name}! 🎉 Your booking at Polybelle Event Halls & Studio is CONFIRMED.\n\nRef: ${b.ref}\nHall: ${b.venue_name}\nDate: ${when}\nOccasion: ${b.event_type}\n\nThank you for choosing Polybelle! 💛`,
      Cancelled: `Hi ${b.name}, regarding your booking request ${b.ref} for ${b.venue_name} on ${when}: unfortunately we're unable to accommodate it. Please message us and we'll gladly help you find another date or hall. 💛`,
      Pending: `Hi ${b.name}! Thank you for your booking request at Polybelle 💛\n\nRef: ${b.ref}\nHall: ${b.venue_name}\nDate: ${when}\n\nWe're checking availability and will get back to you shortly.`
    };
    return msgs[status] || msgs.Pending;
  }

  function openBooking(b) {
    const isNew = !b;
    const d = $("#drawer");
    if (isNew) {
      d.innerHTML = `
        <div class="drawer-head"><div><span class="eyebrow">New booking</span><h3>Add a booking</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
        <form class="drawer-body" id="newForm">
          <label class="field">Hall<select name="venue_id" required>${S.venues.map((v) => `<option value="${v.id}">${esc(v.name)}${v.active ? "" : " (hidden)"}</option>`).join("")}</select></label>
          <div class="grid-2">
            <label class="field">Event date<input type="date" name="event_date" required></label>
            <label class="field">Session<select name="session">${C.sessions.map((s) => `<option>${s.id}</option>`).join("")}</select></label>
            <label class="field">Occasion<select name="event_type">${C.eventTypes.map((t) => `<option>${esc(t)}</option>`).join("")}</select></label>
            <label class="field">Guests<input type="number" name="guests" min="1"></label>
            <label class="field">Customer name<input name="name" required></label>
            <label class="field">Mobile<input name="phone" required></label>
          </div>
          <label class="field">Email<input type="email" name="email"></label>
          <label class="field">Status<select name="status">${STATUSES.map((s) => `<option ${s === "Confirmed" ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label class="field">Notes<textarea name="notes"></textarea></label>
          <button class="btn btn-primary" type="submit">Save booking</button>
        </form>`;
      $("#newForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const v = S.venues.find((x) => x.id === fd.venue_id);
        const row = { ...fd, venue_name: v.name, guests: fd.guests || null, email: fd.email || null, notes: fd.notes || null,
          ref: "PB-" + today().slice(2).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase() };
        const { error } = await sb.from("pb_bookings").insert(row);
        if (error) return toast(error.message);
        toast("Booking added"); closeDrawers(); loadBookings();
      });
    } else {
      d.innerHTML = `
        <div class="drawer-head">
          <div><span class="eyebrow">${esc(b.ref)}</span><h3>${esc(b.name)}</h3><span class="badge b-${b.status}">${b.status}</span></div>
          <button class="xbtn" data-close aria-label="Close">×</button>
        </div>
        <div class="drawer-body">
          <dl class="kv">
            <dt>Hall</dt><dd>${esc(b.venue_name)}</dd>
            <dt>Event date</dt><dd>${esc(fmtDate(b.event_date))}</dd>
            <dt>Session</dt><dd>${esc(b.session)} <small style="color:var(--muted)">${esc(C.sessions.find((s) => s.id === b.session)?.time || "")}</small></dd>
            <dt>Occasion</dt><dd>${esc(b.event_type)}</dd>
            <dt>Guests</dt><dd>${b.guests ?? "—"}</dd>
            <dt>Add-ons</dt><dd>${b.add_ons?.length ? esc(b.add_ons.join(", ")) : "—"}</dd>
            <dt>Mobile</dt><dd><a href="tel:+${intl(b.phone)}">${esc(b.phone)}</a></dd>
            <dt>Email</dt><dd>${b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "—"}</dd>
            <dt>Customer notes</dt><dd style="white-space:pre-wrap">${esc(b.notes || "—")}</dd>
            <dt>Requested</dt><dd>${fmtStamp(b.created_at)}</dd>
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
          <a class="btn btn-wa sm" id="waCust" target="_blank" rel="noopener" href="${waLink(b.phone, customerMsg(b, b.status))}">WhatsApp customer</a>
          <button class="btn btn-outline sm" id="delBtn" type="button" style="margin-left:auto">Delete</button>
        </div>`;
      $$("[data-st]", d).forEach((btn) => btn.addEventListener("click", async () => {
        const st = btn.dataset.st;
        if (st === b.status) return;
        const { error } = await sb.from("pb_bookings").update({ status: st }).eq("id", b.id);
        if (error) return toast(error.message.includes("already has a confirmed") ? "Can't confirm: this hall already has a confirmed booking for that date & session." : error.message);
        b.status = st;
        toast(`Marked as ${st}`);
        await loadBookings();
        openBooking(S.bookings.find((x) => x.id === b.id));
        if (st === "Confirmed" || st === "Cancelled") toast(`Marked as ${st} — tap “WhatsApp customer” to let them know`);
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
    }
    $("[data-close]", d).addEventListener("click", closeDrawers);
    openDrawer("#drawer");
  }

  // ---------------- venues
  async function loadVenues() {
    const { data, error } = await sb.from("pb_venues").select("*").order("sort_order").order("name");
    if (error) return toast(error.message);
    S.venues = data;
    $("#fVenue").innerHTML = `<option value="">All halls</option>` + data.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("");
    renderVenues();
  }
  function renderVenues() {
    $("#vgrid").innerHTML = S.venues.map((v, i) => `
      <div class="vcard">
        <div class="vimg" style="background-image:url('${esc(v.image_url || C.fallbackImages[i % C.fallbackImages.length])}')">
          <span class="badge ${v.active ? "b-Confirmed" : "b-Cancelled"}">${v.active ? "Shown on website" : "Hidden"}</span>
        </div>
        <div class="vb">
          <h3>${esc(v.name)}</h3>
          <p>Up to ${v.capacity} guests${v.branch ? " · " + esc(v.branch) : ""}${v.price_from ? " · from AED " + Number(v.price_from).toLocaleString() : ""}</p>
          ${v.tagline ? `<p><i>${esc(v.tagline)}</i></p>` : ""}
          ${v.image_url ? "" : `<p style="color:var(--gold)">Using a sample photo — upload the real one.</p>`}
        </div>
        <div class="vf"><button class="btn btn-outline sm" data-edit="${v.id}">Edit</button></div>
      </div>`).join("") + `<button class="vcard add" id="addVenue"><span><b>+</b>Add a new hall</span></button>`;
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => openVenue(S.venues.find((v) => v.id === b.dataset.edit))));
    $("#addVenue").addEventListener("click", () => openVenue(null));
  }

  function openVenue(v) {
    const isNew = !v;
    v = v || { name: "", tagline: "", description: "", capacity: 50, branch: "", image_url: "", price_from: null, sort_order: (S.venues.at(-1)?.sort_order || 0) + 1, active: true };
    const d = $("#vdrawer");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${isNew ? "New hall" : "Edit hall"}</span><h3>${esc(v.name || "Add a hall")}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="venueForm">
        <div class="preview-img" id="vPrev" style="background-image:url('${esc(v.image_url || "")}')"></div>
        <label class="field">Photo (JPG/PNG/WebP, max 5 MB)<input type="file" id="vFile" accept="image/jpeg,image/png,image/webp"></label>
        <input type="hidden" name="image_url" value="${esc(v.image_url || "")}">
        <label class="field">Hall name<input name="name" required maxlength="60" value="${esc(v.name)}" placeholder="e.g. Hall E"></label>
        <label class="field">Short tagline<input name="tagline" maxlength="60" value="${esc(v.tagline || "")}" placeholder="e.g. Garden-themed & bright"></label>
        <label class="field">Description<textarea name="description" maxlength="400">${esc(v.description || "")}</textarea></label>
        <div class="grid-2">
          <label class="field">Max guests<input type="number" name="capacity" min="1" required value="${v.capacity}"></label>
          <label class="field">Branch / location<select name="branch"><option value="">—</option>${C.branches.map((b) => `<option ${b.name === v.branch ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
          <label class="field">Starting price (AED, optional)<input type="number" name="price_from" min="0" step="1" value="${v.price_from ?? ""}"></label>
          <label class="field">Display order<input type="number" name="sort_order" value="${v.sort_order}"></label>
        </div>
        <label class="switch"><input type="checkbox" name="active" ${v.active ? "checked" : ""}> Show on website &amp; accept bookings</label>
        <button class="btn btn-primary" type="submit">${isNew ? "Add hall" : "Save changes"}</button>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    $("#vFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast("Photo is over 5 MB — please use a smaller one.");
      toast("Uploading photo…");
      const path = `venues/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const { error } = await sb.storage.from(C.storageBucket).upload(path, f, { cacheControl: "31536000", upsert: false });
      if (error) return toast("Upload failed: " + error.message);
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      $("#venueForm").image_url.value = url;
      $("#vPrev").style.backgroundImage = `url('${url}')`;
      toast("Photo uploaded — remember to save");
    });
    $("#venueForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = {
        name: f.name.value.trim(), tagline: f.tagline.value.trim() || null, description: f.description.value.trim() || null,
        capacity: +f.capacity.value, branch: f.branch.value || null, price_from: f.price_from.value === "" ? null : +f.price_from.value,
        sort_order: +f.sort_order.value || 0, active: f.active.checked, image_url: f.image_url.value || null
      };
      const q = isNew ? sb.from("pb_venues").insert(row) : sb.from("pb_venues").update(row).eq("id", v.id);
      const { error } = await q;
      if (error) return toast(error.message);
      toast(isNew ? "Hall added — it's live on the website" : "Hall updated");
      closeDrawers(); loadVenues();
    });
    openDrawer("#vdrawer");
  }

  // ---------------- settings & admins
  async function loadSettings() {
    const { data } = await sb.from("pb_settings").select("*").eq("id", 1).maybeSingle();
    if (!data) return;
    const f = $("#settingsForm");
    f.booking_whatsapp.value = data.booking_whatsapp.replace(/^971/, "0");
    f.display_phones.value = data.display_phones;
  }
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
    $("#adminsList").innerHTML = S.admins.map((a) => `<li>${esc(a.email)} ${a.email === S.user.email ? "<small style='color:var(--muted)'>you</small>" : `<button class="linkbtn" data-rm="${esc(a.email)}">Remove</button>`}</li>`).join("");
    $$("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Remove admin access for ${b.dataset.rm}?`)) return;
      const { error } = await sb.from("pb_admins").delete().eq("email", b.dataset.rm);
      if (error) return toast(error.message);
      loadAdmins();
    }));
  }
  $("#addAdminForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim().toLowerCase();
    const { error } = await sb.from("pb_admins").insert({ email });
    if (error) return toast(error.code === "23505" ? "Already an admin." : error.message);
    e.target.reset(); toast("Admin added"); loadAdmins();
  });

  boot();
})();

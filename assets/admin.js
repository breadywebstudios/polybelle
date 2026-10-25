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
    await Promise.all([loadVenues(), loadBookings(), loadSettings(), loadAdmins(), loadGallery(), loadReviews()]);
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
      (!v || (v === "__services" ? isServices(b) : b.venue_id === v)) &&
      (when === "all" || (when === "upcoming" ? b.event_date >= t : b.event_date < t)) &&
      (!q || [b.ref, b.name, b.phone, b.email, b.venue_name, b.event_location, b.event_type].join(" ").toLowerCase().includes(q)));
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
        <td>${isServices(b) ? `Services only<small>${esc(b.event_location || "Customer's venue")}</small>` : esc(b.venue_name)}</td>
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
    const cols = ["ref", "status", "booking_type", "event_date", "session", "venue_name", "event_location", "event_type", "guests", "add_ons", "name", "phone", "email", "notes", "admin_notes", "created_at"];
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
      Confirmed: `Hi ${b.name}! 🎉 Your booking at Polybelle Event Halls & Studio is CONFIRMED.\n\nRef: ${b.ref}\n${isServices(b) ? "Booking: " + whereText(b) : "Hall: " + b.venue_name}\nDate: ${when}\nOccasion: ${b.event_type}\n\nThank you for choosing Polybelle! 💛`,
      Cancelled: `Hi ${b.name}, regarding your booking request ${b.ref} for ${whereText(b)} on ${when}: unfortunately we're unable to accommodate it. Please message us and we'll gladly help you find another date or hall. 💛`,
      Pending: `Hi ${b.name}! Thank you for your booking request at Polybelle 💛\n\nRef: ${b.ref}\n${isServices(b) ? "Booking: " + whereText(b) : "Hall: " + b.venue_name}\nDate: ${when}\n\nWe're checking availability and will get back to you shortly.`
    };
    return msgs[status] || msgs.Pending;
  }

  const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invTotals = (b) => {
    const subtotal = (b.invoice_items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const total = Math.max(0, subtotal - (Number(b.discount) || 0));
    return { subtotal, total, paid: Number(b.amount_paid) || 0, balance: Math.max(0, total - (Number(b.amount_paid) || 0)) };
  };
  const fresh = (id) => S.bookings.find((x) => x.id === id);
  const isServices = (b) => b.booking_type === "Services" || !b.venue_id;
  const whereText = (b) => (isServices(b) ? "Package / services" + (b.event_location ? " · " + b.event_location : "") : b.venue_name || "");
  const nextInvoiceNo = () => today().slice(2, 4) + "-" + ((S.settings?.invoice_counter ?? 0) + 1);

  // ---------- booking add / edit form
  function openBookingForm(b) {
    const isNew = !b;
    b = b || { venue_id: S.venues.find((v) => v.active)?.id, event_date: "", session: "Evening", event_type: C.eventTypes[0], guests: "", name: "", phone: "", email: "", customer_address: "", notes: "", add_ons: [], status: "Confirmed" };
    const d = $("#drawer");
    const venueOpts = `<option value="" ${b.venue_id ? "" : "selected"}>No hall – package / services only</option>` + S.venues.map((v) => `<option value="${v.id}" ${v.id === b.venue_id ? "selected" : ""}>${esc(v.name)} (up to ${v.capacity})${v.active ? "" : " – hidden"}</option>`).join("");
    const typeOpts = [...new Set([...C.eventTypes, b.event_type].filter(Boolean))].map((t) => `<option ${t === b.event_type ? "selected" : ""}>${esc(t)}</option>`).join("");
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${isNew ? "New booking" : "Edit · " + esc(b.ref)}</span><h3>${isNew ? "Add a booking" : esc(b.name)}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="bkForm">
        <label class="field">Hall<select name="venue_id" id="bkVenue">${venueOpts}</select></label>
        <label class="field" id="bkLocWrap">Event location (for bookings without a hall)<input name="event_location" maxlength="200" value="${esc(b.event_location || "")}" placeholder="e.g. customer's villa, Khalifa City"></label>
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
          <div style="font-size:.86rem;color:var(--muted);margin-bottom:8px">Add-ons</div>
          <div class="addons">${[...new Set([...C.addOns, ...(b.add_ons || [])])].map((a) => `<label class="addon"><input type="checkbox" name="add_ons" value="${esc(a)}" ${(b.add_ons || []).includes(a) ? "checked" : ""}><span>${esc(a)}</span></label>`).join("")}</div>
        </div>
        <label class="field">Customer notes<textarea name="notes">${esc(b.notes || "")}</textarea></label>
        ${isNew ? `<label class="field">Status<select name="status">${STATUSES.map((s) => `<option ${s === b.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>` : ""}
        <button class="btn btn-primary" type="submit">${isNew ? "Save booking" : "Save changes"}</button>
      </form>`;
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
        notes: fd.get("notes").trim() || null, add_ons: fd.getAll("add_ons")
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
      openBooking(fresh(res.data.id));
    });
    openDrawer("#drawer");
  }

  // ---------- booking details
  function openBooking(b) {
    if (!b) return openBookingForm(null);
    const d = $("#drawer");
    const t = invTotals(b);
    d.innerHTML = `
      <div class="drawer-head">
        <div><span class="eyebrow">${esc(b.ref)}</span><h3>${esc(b.name)}</h3><span class="badge b-${b.status}">${b.status}</span></div>
        <button class="xbtn" data-close aria-label="Close">×</button>
      </div>
      <div class="drawer-body">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline sm" id="editBtn" type="button">✎ Edit booking</button>
          <button class="btn btn-outline sm" id="invBtn" type="button">🧾 Invoice${b.invoice_no ? " " + esc(b.invoice_no) : ""}</button>
        </div>
        <dl class="kv">
          <dt>Booking</dt><dd>${isServices(b) ? "Package / services only" : "Hall · " + esc(b.venue_name)}</dd>
          ${isServices(b) ? `<dt>Location</dt><dd>${esc(b.event_location || "Not given yet")}</dd>` : ""}
          <dt>Event date</dt><dd>${esc(fmtDate(b.event_date))}</dd>
          <dt>Session</dt><dd>${esc(b.session)} <small style="color:var(--muted)">${esc(C.sessions.find((s) => s.id === b.session)?.time || "")}</small></dd>
          <dt>Occasion</dt><dd>${esc(b.event_type)}</dd>
          <dt>Guests</dt><dd>${b.guests ?? "—"}</dd>
          <dt>Add-ons</dt><dd>${b.add_ons?.length ? esc(b.add_ons.join(", ")) : "—"}</dd>
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
        <a class="btn btn-wa sm" target="_blank" rel="noopener" href="${waLink(b.phone, customerMsg(b, b.status))}">WhatsApp customer</a>
        <button class="btn btn-outline sm" id="delBtn" type="button" style="margin-left:auto">Delete</button>
      </div>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    $("#editBtn").addEventListener("click", () => openBookingForm(b));
    $("#invBtn").addEventListener("click", () => openInvoice(b));
    $$("[data-st]", d).forEach((btn) => btn.addEventListener("click", async () => {
      const st = btn.dataset.st;
      if (st === b.status) return;
      const { error } = await sb.from("pb_bookings").update({ status: st }).eq("id", b.id);
      if (error) return toast(error.message.includes("already has a confirmed") ? "Can't confirm: this hall already has a confirmed booking for that date & session." : error.message);
      await loadBookings();
      openBooking(fresh(b.id));
      toast(st === "Confirmed" || st === "Cancelled" ? `Marked as ${st} — tap “WhatsApp customer” to let them know` : `Marked as ${st}`);
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
  function defaultItems(b) {
    const v = S.venues.find((x) => x.id === b.venue_id);
    const items = isServices(b) ? [] : [{ kind: "hall", description: hallLine(b), amount: v?.price_from ? Number(v.price_from) : 0 }];
    (b.add_ons || []).forEach((a) => items.push({ description: a, amount: 0 }));
    return items;
  }

  function openInvoice(b) {
    // the hall-rental line always reflects the booking's current hall, occasion, date and session
    const items = (b.invoice_items?.length ? b.invoice_items : defaultItems(b))
      .filter((x) => !(x.kind === "hall" && isServices(b)))
      .map((x) => (x.kind === "hall" ? { ...x, description: hallLine(b) } : { ...x }));
    const d = $("#drawer");
    const itemRow = (it, i) => `
      <div class="inv-row" data-i="${i}" data-kind="${esc(it.kind || "")}">
        <textarea class="inv-desc" rows="1" placeholder="Description, e.g. 15 pieces Scented Candles">${esc(it.description)}</textarea>
        <input class="inv-amt" type="number" step="0.01" min="0" value="${it.amount || ""}" placeholder="0.00" aria-label="Amount (AED)">
        <button type="button" class="xbtn inv-del" aria-label="Remove line">×</button>
      </div>`;
    d.innerHTML = `
      <div class="drawer-head"><div><span class="eyebrow">${b.invoice_no ? "Invoice " + esc(b.invoice_no) : "New invoice"} · ${esc(b.ref)}</span><h3>${esc(b.name)}</h3></div><button class="xbtn" data-close aria-label="Close">×</button></div>
      <form class="drawer-body" id="invForm">
        <p class="hint" style="margin:0">Customer and event details are taken from the booking each time you open the invoice, so edits to the booking show up automatically.</p>
        <div>
          <div style="font-size:.86rem;color:var(--muted);margin-bottom:8px">Line items (AED)</div>
          <div id="invItems" style="display:grid;gap:8px">${items.map(itemRow).join("")}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn btn-outline sm" id="addLine">+ Add line</button>
            <button type="button" class="btn btn-outline sm" id="resetLines" title="Rebuild lines from the booking's hall, date and add-ons">↻ Refresh from booking</button>
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
          <button class="btn btn-primary" type="submit" data-act="print">Save &amp; open invoice</button>
        </div>
      </form>`;
    const f = $("#invForm");
    const t0 = invTotals(b);
    if (b.invoice_no && t0.paid > 0 && t0.balance === 0) f.doc_type.value = "Receipt";
    const read = () => $$(".inv-row", d).map((r) => ({ ...(r.dataset.kind ? { kind: r.dataset.kind } : {}), description: $(".inv-desc", r).value.trim(), amount: Number($(".inv-amt", r).value) || 0 })).filter((x) => x.description || x.amount);
    const sum = () => {
      const t = invTotals({ invoice_items: read(), discount: f.discount.value, amount_paid: f.amount_paid.value });
      $("#invSum").innerHTML = `<div><span>Subtotal</span><b>AED ${money(t.subtotal)}</b></div>${+f.discount.value ? `<div><span>Discount</span><b>− AED ${money(f.discount.value)}</b></div>` : ""}<div><span>Total</span><b>AED ${money(t.total)}</b></div><div><span>Paid</span><b>AED ${money(t.paid)}</b></div><div class="due"><span>Balance due</span><b>AED ${money(t.balance)}</b></div>`;
    };
    const wire = () => {
      $$(".inv-del", d).forEach((x) => (x.onclick = () => { x.closest(".inv-row").remove(); sum(); }));
      $$(".inv-desc", d).forEach((ta) => { const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }; ta.oninput = fit; fit(); });
    };
    f.addEventListener("input", sum);
    $("#addLine").onclick = () => { $("#invItems").insertAdjacentHTML("beforeend", itemRow({ description: "", amount: 0 }, Date.now())); wire(); $("#invItems .inv-row:last-child .inv-desc").focus(); };
    $("#resetLines").onclick = () => { if (!confirm("Replace the current lines with the hall and add-ons from the booking?")) return; $("#invItems").innerHTML = defaultItems(b).map(itemRow).join(""); wire(); sum(); };
    wire(); sum();
    $("[data-close]", d).addEventListener("click", () => openBooking(fresh(b.id)));

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const act = e.submitter?.dataset.act || "save";
      const win = act === "print" ? window.open("", "_blank") : null;
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
      toast(`Invoice ${nb.invoice_no} saved`);
      if (win) renderInvoice(win, nb, f.doc_type.value);
      openInvoice(nb);
      $("#invForm").doc_type.value = f.doc_type.value;
    });
    openDrawer("#drawer");
  }

  // ---------- printable invoice (matches Polybelle receipt layout)
  function renderInvoice(win, b, docType) {
    const s = S.settings || {};
    const t = invTotals(b);
    const nl = (x) => esc(x || "").replace(/\n/g, "<br>");
    const customer = [b.name, b.customer_address || "", [b.phone, b.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
    const issue = new Date((b.invoice_date || today()) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const sess = C.sessions.find((x) => x.id === b.session);
    const lines = (b.invoice_items || []).map((it) => `<tr><td>${nl(it.description)}</td><td class="amt">${it.amount ? money(it.amount) : ""}</td></tr>`).join("");
    const isReceipt = docType === "Receipt";
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${docType} ${esc(b.invoice_no)} – ${esc(b.name)}</title>
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
</div></body></html>`);
    win.document.close();
  }

  // ---------------- venues
  async function loadVenues() {
    const { data, error } = await sb.from("pb_venues").select("*").order("sort_order").order("name");
    if (error) return toast(error.message);
    S.venues = data;
    $("#fVenue").innerHTML = `<option value="">All bookings</option>` + data.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("") + `<option value="__services">Services only (no hall)</option>`;
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

  // ---------------- gallery
  const catOpts = (sel) => C.galleryCategories.map((c) => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
  $("#gUpload").category.innerHTML = catOpts("Birthday");
  $("#gFilter").innerHTML = `<option value="">All occasions</option>` + catOpts("");
  $("#gFilter").value = "";
  $("#gFilter").addEventListener("input", renderGalleryAdmin);

  async function loadGallery() {
    const { data, error } = await sb.from("pb_gallery").select("*").order("sort_order").order("created_at", { ascending: false });
    if (error) return toast(error.message);
    S.gallery = data; renderGalleryAdmin();
  }
  function renderGalleryAdmin() {
    const f = $("#gFilter").value;
    const list = (S.gallery || []).filter((g) => !f || g.category === f);
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
            <input type="number" data-f="sort_order" value="${g.sort_order}" title="Order (lower shows first)" style="width:64px">
            <button class="linkbtn" data-del type="button">Delete</button>
          </div>
        </div>
      </div>`).join("") || `<p class="hint">No photos yet.</p>`;
    $$("#gAdmin .gcard").forEach((card) => {
      const id = card.dataset.id;
      $$("[data-f]", card).forEach((el) => el.addEventListener("change", async () => {
        const v = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value || 0 : el.value.trim() || null;
        const { error } = await sb.from("pb_gallery").update({ [el.dataset.f]: v }).eq("id", id);
        if (error) return toast(error.message);
        Object.assign(S.gallery.find((g) => g.id === id), { [el.dataset.f]: v });
        if (el.dataset.f === "active") renderGalleryAdmin();
        toast("Saved");
      }));
      $("[data-del]", card).addEventListener("click", async () => {
        if (!confirm("Delete this photo from the gallery?")) return;
        const g = S.gallery.find((x) => x.id === id);
        const { error } = await sb.from("pb_gallery").delete().eq("id", id);
        if (error) return toast(error.message);
        const marker = `/object/public/${C.storageBucket}/`;
        if (g.image_url.includes(marker)) sb.storage.from(C.storageBucket).remove([decodeURIComponent(g.image_url.split(marker)[1])]);
        S.gallery = S.gallery.filter((x) => x.id !== id); renderGalleryAdmin(); toast("Photo deleted");
      });
    });
  }
  $("#gUpload").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, files = [...f.files.files], btn = f.querySelector("button");
    const big = files.filter((x) => x.size > 5 * 1024 * 1024);
    if (big.length) return toast(`${big.length} photo(s) are over 5 MB — please resize them first.`);
    btn.disabled = true;
    const minOrder = Math.min(0, ...(S.gallery || []).map((g) => g.sort_order)) - files.length;
    let done = 0, failed = 0;
    for (const [i, file] of files.entries()) {
      $("#gProgress").textContent = `Uploading ${i + 1} of ${files.length}…`;
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
        <p>${esc(r.comment)}</p>
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
        <label class="field">Review<textarea name="comment" required maxlength="1200" rows="6">${esc(r.comment)}</textarea></label>
        <label class="switch"><input type="checkbox" name="featured" ${r.featured ? "checked" : ""}> Featured (shows first on the website)</label>
        <button class="btn btn-primary" type="submit">${isNew ? "Add review" : "Save changes"}</button>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    $("#revForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = { name: f.name.value.trim(), rating: +f.rating.value, event_type: f.event_type.value || null, source: f.source.value,
        status: f.status.value, comment: f.comment.value.trim(), featured: f.featured.checked };
      if (!row.name || !row.comment) return toast("Name and review are required.");
      const { error } = isNew ? await sb.from("pb_reviews").insert(row) : await sb.from("pb_reviews").update(row).eq("id", r.id);
      if (error) return toast(error.message);
      toast(isNew ? "Review added" : "Review updated"); closeDrawers(); loadReviews();
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
    S.settings = data;
    const g = $("#invoiceSettingsForm");
    g.business_name.value = data.business_name;
    g.business_address.value = data.business_address;
    g.payment_details.value = data.payment_details;
    g.invoice_footer.value = data.invoice_footer;
    g.next_no.value = data.invoice_counter + 1;
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

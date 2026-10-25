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
    await Promise.all([loadVenues(), loadBookings(), loadSettings(), loadAdmins(), loadGallery(), loadReviews(), loadServices()]);
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
  function customerMsg(b, status) {
    const sess = C.sessions.find((x) => x.id === b.session);
    const t = invTotals(b);
    const hasInvoice = !!b.invoice_no || t.total > 0;
    const details = [
      `*Booking Ref:* ${b.ref}`,
      isServices(b) ? `*Booking:* Package / services only` : `*Hall:* ${b.venue_name}`,
      isServices(b) ? `*Event location:* ${b.event_location || "To be confirmed"}` : null,
      `*Date:* ${fmtDate(b.event_date)}`,
      `*Session:* ${b.session}${sess ? ` (${sess.time})` : ""}`,
      `*Occasion:* ${b.event_type}`,
      b.guests ? `*Guests:* ${b.guests}` : null,
      b.add_ons?.length ? `\n*Packages & services:*\n${b.add_ons.map((a) => `- ${a}`).join("\n")}` : null,
      b.custom_items?.length ? `\n*Additional items:*\n${b.custom_items.map((c) => `- ${ciText(c)}${ciTotal(c) ? ` (AED ${money(ciTotal(c))})` : ""}`).join("\n")}` : null,
      b.notes ? `\n*Your notes:* ${b.notes}` : null,
      hasInvoice ? [
        ``,
        b.invoice_no ? `*Invoice No:* ${b.invoice_no}` : null,
        +b.discount ? `*Discount:* AED ${money(b.discount)}` : null,
        `*Total:* AED ${money(t.total)}`,
        t.paid ? `*Paid:* AED ${money(t.paid)}` : null,
        `*Balance due:* AED ${money(t.balance)}`
      ].filter((l) => l !== null).join("\n") : null
    ].filter((l) => l !== null).join("\n");
    const pay = hasInvoice && t.balance > 0 && S.settings?.payment_details ? `\n\n*Payment details:*\n${S.settings.payment_details}` : "";
    const intro = {
      Confirmed: `Hi ${b.name}! 🎉 Your booking at Polybelle Event Halls & Studio is *CONFIRMED*.`,
      Pending: `Hi ${b.name}! Thank you for your booking request at Polybelle Event Halls & Studio 💛 Here are the details we received:`,
      Completed: `Hi ${b.name}! Thank you for celebrating with Polybelle Event Halls & Studio 💛 Here is a summary of your event:`,
      Cancelled: `Hi ${b.name}, regarding your booking request at Polybelle Event Halls & Studio: unfortunately we're unable to accommodate it on this date.`
    }[status] || "";
    const outro = {
      Confirmed: `Thank you for choosing Polybelle! 💛 Message us anytime if you have questions.`,
      Pending: `We're checking availability and will get back to you shortly.`,
      Completed: `We'd love to hear how it went, and hope to celebrate with you again soon!`,
      Cancelled: `Please message us and we'll gladly help you find another date or hall. 💛`
    }[status] || "";
    return `${intro}\n\n${details}${status === "Cancelled" ? "" : pay}\n\n${outro}`;
  }

  const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const whereText = (b) => (isServices(b) ? "Package / services" + (b.event_location ? " · " + b.event_location : "") : b.venue_name || "");
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
        <div class="addons">${names.map((a) => `<label class="addon"><input type="checkbox" name="add_ons" value="${esc(a)}" ${selected.includes(a) ? "checked" : ""}><span>${esc(a)}</span></label>`).join("")}</div>
      </div>`).join("");
  }

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
    return [...items, ...customLines(b)];
  }

  function openInvoice(b) {
    // the hall-rental line always reflects the booking's current hall, occasion, date and session
    // hall line and custom items always mirror the booking; other lines keep what was saved on the invoice
    const cur = new Map(customLines(b).map((l) => [l.cid, l]));
    const items = (b.invoice_items?.length ? b.invoice_items : defaultItems(b))
      .filter((x) => !(x.kind === "hall" && isServices(b)) && !(x.kind === "custom" && !cur.has(x.cid)))
      .map((x) => (x.kind === "hall" ? { ...x, description: hallLine(b) } : x.kind === "custom" ? { ...cur.get(x.cid) } : { ...x }));
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
          <div style="font-size:.86rem;color:var(--muted);margin-bottom:8px">Line items (AED) <span class="hint" style="display:block;margin-top:2px">To add an extra item, use <b>Custom items</b> in Edit booking.</span></div>
          <div id="invItems" style="display:grid;gap:8px">${items.map(itemRow).join("")}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
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
    const read = () => $$(".inv-row", d).map((r) => ({ ...(r.dataset.kind ? { kind: r.dataset.kind } : {}), ...(r.dataset.cid ? { cid: r.dataset.cid } : {}), description: $(".inv-desc", r).value.trim(), amount: Number($(".inv-amt", r).value) || 0 })).filter((x) => x.description || x.amount);
    const sum = () => {
      const t = invTotals({ invoice_items: read(), discount: f.discount.value, amount_paid: f.amount_paid.value });
      $("#invSum").innerHTML = `<div><span>Subtotal</span><b>AED ${money(t.subtotal)}</b></div>${+f.discount.value ? `<div><span>Discount</span><b>− AED ${money(f.discount.value)}</b></div>` : ""}<div><span>Total</span><b>AED ${money(t.total)}</b></div><div><span>Paid</span><b>AED ${money(t.paid)}</b></div><div class="due"><span>Balance due</span><b>AED ${money(t.balance)}</b></div>`;
    };
    const wire = () => {
      $$(".inv-del", d).forEach((x) => (x.onclick = () => { x.closest(".inv-row").remove(); sum(); }));
      $$(".inv-desc", d).forEach((ta) => { const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }; ta.oninput = fit; fit(); });
    };
    f.addEventListener("input", sum);
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

  // ---------------- packages & services
  async function loadServices() {
    const { data, error } = await sb.from("pb_services").select("*").order("sort_order").order("name");
    if (error) return toast(error.message);
    S.services = data; renderServicesAdmin();
  }
  function renderServicesAdmin() {
    const order = C.serviceCategories || [];
    const rank = (c) => (order.indexOf(c) < 0 ? 99 : order.indexOf(c));
    const list = S.services.slice().sort((a, b) => rank(a.category) - rank(b.category) || a.sort_order - b.sort_order);
    let lastCat = null;
    $("#sgrid").innerHTML = list.map((sv) => (sv.category !== lastCat ? `<h4 class="sg-head">${esc((lastCat = sv.category) || "Other")}</h4>` : "") + `
      <div class="vcard">
        <div class="vimg" style="${sv.image_url ? `background-image:url('${esc(sv.image_url)}')` : ""}">
          <span class="badge ${sv.active ? "b-Confirmed" : "b-Cancelled"}">${sv.active ? "Shown" : "Hidden"}</span>
          ${sv.kind === "Package" ? `<span class="badge" style="left:auto;right:10px;background:var(--ink);color:#fff">Package</span>` : ""}
        </div>
        <div class="vb">
          <h3>${esc(sv.name)}</h3>
          ${sv.description ? `<p>${esc(sv.description)}</p>` : ""}
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
        <div class="preview-img" id="sPrev" style="${sv.image_url ? `background-image:url('${esc(sv.image_url)}')` : ""}"></div>
        <label class="field">Photo (JPG/PNG/WebP, max 5 MB)<input type="file" id="sFile" accept="image/jpeg,image/png,image/webp"></label>
        <input type="hidden" name="image_url" value="${esc(sv.image_url || "")}">
        <label class="field">Name<input name="name" required maxlength="60" value="${esc(sv.name)}" placeholder="e.g. Balloon Arch"></label>
        <div class="grid-2">
          <label class="field">Group (tab in the booking form)<select name="category">${cats.map((c) => `<option ${c === sv.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
          <label class="field">Type<select name="kind">${["Package", "Service"].map((k) => `<option ${k === sv.kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>
          <label class="field">Display order<input type="number" name="sort_order" value="${sv.sort_order}"></label>
        </div>
        <label class="field">Short description<input name="description" maxlength="90" value="${esc(sv.description || "")}" placeholder="One line shown under the name"></label>
        <label class="switch"><input type="checkbox" name="active" ${sv.active ? "checked" : ""}> Show in the booking form</label>
        ${isNew ? "" : `<p class="hint" style="margin:0">Renaming won't change bookings already made with the old name.</p>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit">${isNew ? "Add" : "Save changes"}</button>
          ${isNew ? "" : `<button class="btn btn-outline" type="button" id="sDel">Delete</button>`}
        </div>
      </form>`;
    $("[data-close]", d).addEventListener("click", closeDrawers);
    $("#sFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast("Photo is over 5 MB — please use a smaller one.");
      toast("Uploading photo…");
      const path = `services/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
      const { error } = await sb.storage.from(C.storageBucket).upload(path, f, { cacheControl: "31536000" });
      if (error) return toast("Upload failed: " + error.message);
      const url = sb.storage.from(C.storageBucket).getPublicUrl(path).data.publicUrl;
      $("#svcForm").image_url.value = url; $("#sPrev").style.backgroundImage = `url('${url}')`;
      toast("Photo uploaded — remember to save");
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
        image_url: f.image_url.value || null, sort_order: +f.sort_order.value || 0, active: f.active.checked };
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

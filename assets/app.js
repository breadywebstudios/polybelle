(() => {
  const C = window.PB_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sb = window.supabase ? window.supabase.createClient(C.supabaseUrl, C.supabaseKey) : null;

  const DEFAULT_VENUES = [
    { id: "", name: "Hall A", tagline: "Grand celebrations", description: "Our largest hall, styled for weddings, christenings and milestone birthdays.", capacity: 100 },
    { id: "", name: "Hall B", tagline: "Elegant & spacious", description: "A bright, versatile hall for big family gatherings and corporate get-togethers.", capacity: 100 },
    { id: "", name: "Hall C", tagline: "Cozy & intimate", description: "A warm mid-sized space, perfect for baby showers and kids' parties.", capacity: 60 },
    { id: "", name: "Hall D", tagline: "Small & special", description: "An intimate room for dedications, cake smash shoots and meetings.", capacity: 50 }
  ];

  const state = { venues: [], booked: [], whatsapp: C.bookingWhatsapp, phones: C.displayPhones };

  // ---------- helpers
  const imgFor = (v, i) => v.image_url || C.fallbackImages[i % C.fallbackImages.length];
  const telLink = (n) => "tel:+971" + n.replace(/\D/g, "").replace(/^0/, "");
  const waLink = (num, text) => `https://wa.me/${num.replace(/\D/g, "")}${text ? "?text=" + encodeURIComponent(text) : ""}`;
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—";
  const todayDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const money = (n) => "AED " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

  // ---------- static bits
  $("#year").textContent = new Date().getFullYear();
  $("#heroBg").style.backgroundImage = `url("${C.heroImage}")`;
  $("#packagePhoto").style.backgroundImage = `url("${C.fallbackImages[1]}")`;
  $("#menuBtn").addEventListener("click", (e) => {
    const open = $("#navLinks").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", open);
  });
  document.querySelectorAll("#navLinks a").forEach((a) => a.addEventListener("click", () => $("#navLinks").classList.remove("open")));

  $("#typeInput").innerHTML = `<option value="">Select occasion…</option>` + C.eventTypes.map((t) => `<option>${esc(t)}</option>`).join("");
  $("#addonPick").innerHTML = C.addOns.map((a) => `<label class="addon"><input type="checkbox" name="add_ons" value="${esc(a)}"><span>${esc(a)}</span></label>`).join("");
  $("#dateInput").min = todayDubai();

  function renderContact() {
    const phones = state.phones.split("|").map((p) => p.trim()).filter(Boolean);
    $("#topPhones").textContent = "📲 " + phones.join(" | ");
    $("#asidePhones").textContent = phones[0] || "";
    $("#asidePhones").href = phones[0] ? telLink(phones[0]) : "#contact";
    $("#contactPhones").textContent = `Call or WhatsApp ${phones.join(" | ")} — we're always happy to help.`;
    $("#footContact").innerHTML =
      phones.map((p) => `<li><a href="${telLink(p)}">📞 ${esc(p)}</a></li>`).join("") +
      `<li><a href="${waLink(state.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp us</a></li>` +
      `<li><a href="https://www.instagram.com/${C.instagram}" target="_blank" rel="noopener">📷 @${C.instagram}</a></li>` +
      `<li><a href="${C.facebook}" target="_blank" rel="noopener">👍 Facebook</a></li>`;
    $("#waFloat").href = waLink(state.whatsapp, "Hi Polybelle! I'd like to ask about booking an event.");
    $("#locGrid").innerHTML = C.branches.map((b) => `
      <div class="loc fade">
        <span class="eyebrow">Branch</span>
        <h3>${esc(b.name)}</h3>
        <p>${esc(b.address)}</p>
        <p>${esc(b.landmark)}</p>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.landmark + ", " + b.name + ", Abu Dhabi")}" target="_blank" rel="noopener">Get directions →</a>
      </div>`).join("");
    observe();
  }

  function renderVenues() {
    $("#statHalls").textContent = state.venues.length;
    $("#venueGrid").innerHTML = state.venues.map((v, i) => `
      <article class="venue fade">
        <div class="venue-img" style="background-image:url('${esc(imgFor(v, i))}')" role="img" aria-label="${esc(v.name)}">
          <span class="cap">Up to ${v.capacity} guests</span>
        </div>
        <div class="venue-body">
          ${v.tagline ? `<span class="tag">${esc(v.tagline)}</span>` : ""}
          <h3>${esc(v.name)}</h3>
          ${v.description ? `<p>${esc(v.description)}</p>` : ""}
          ${v.branch ? `<span class="meta">📍 ${esc(v.branch)}</span>` : ""}
          ${v.price_from ? `<span class="price">From ${money(v.price_from)}</span>` : ""}
          <button class="btn btn-outline" data-book="${esc(v.id || v.name)}">Book this hall</button>
        </div>
      </article>`).join("");
    $("#hallPick").innerHTML = state.venues.map((v) => `
      <label class="chip-radio"><input type="radio" name="venue" value="${esc(v.id || v.name)}" required>
        <span><b>${esc(v.name)}</b><small>Up to ${v.capacity} guests${v.branch ? " · " + esc(v.branch) : ""}</small></span></label>`).join("");
    document.querySelectorAll("[data-book]").forEach((b) => b.addEventListener("click", () => {
      const r = document.querySelector(`#hallPick input[value="${CSS.escape(b.dataset.book)}"]`);
      if (r) { r.checked = true; update(); }
      $("#book").scrollIntoView({ behavior: "smooth" });
    }));
    observe();
  }

  function renderSessions() {
    const venue = selectedVenue();
    const date = $("#dateInput").value;
    const taken = state.booked.filter((b) => venue && b.venue_id === venue.id && b.event_date === date).map((b) => b.session);
    const wholeTaken = taken.includes("Whole day");
    const current = document.querySelector('#sessionPick input:checked')?.value;
    $("#sessionPick").innerHTML = C.sessions.map((s) => {
      const blocked = wholeTaken || taken.includes(s.id) || (s.id === "Whole day" && taken.length > 0);
      return `<label class="chip-radio"><input type="radio" name="session" value="${esc(s.id)}" ${blocked ? "disabled" : ""} ${current === s.id && !blocked ? "checked" : ""} required>
        <span><b>${esc(s.id)}</b><small>${blocked ? "Already booked" : esc(s.time)}</small></span></label>`;
    }).join("");
    const hint = $("#availHint");
    if (!venue || !date) { hint.textContent = "Pick a hall and date to see open sessions."; hint.className = "hint"; }
    else if (taken.length === 0) { hint.textContent = `Good news — ${venue.name} is open all day on ${fmtDate(date)}.`; hint.className = "hint"; }
    else if (wholeTaken || C.sessions.every((s) => s.id === "Whole day" || taken.includes(s.id))) { hint.textContent = `${venue.name} is fully booked on this date. Please try another date or hall.`; hint.className = "hint warn"; }
    else { hint.textContent = "Some sessions are already booked — open ones are still available."; hint.className = "hint"; }
  }

  const selectedVenue = () => {
    const val = document.querySelector('#hallPick input:checked')?.value;
    return state.venues.find((v) => (v.id || v.name) === val);
  };

  function readForm() {
    const f = $("#bookForm");
    const fd = new FormData(f);
    return {
      venue: selectedVenue(),
      date: fd.get("date"),
      session: fd.get("session"),
      event_type: fd.get("event_type"),
      guests: fd.get("guests"),
      add_ons: fd.getAll("add_ons"),
      name: (fd.get("name") || "").trim(),
      phone: (fd.get("phone") || "").trim(),
      email: (fd.get("email") || "").trim(),
      notes: (fd.get("notes") || "").trim()
    };
  }

  function update() {
    renderSessions();
    const d = readForm();
    const set = (k, v) => ($(`[data-s="${k}"]`).textContent = v || "—");
    set("hall", d.venue?.name);
    set("date", d.date ? fmtDate(d.date) : "");
    set("session", d.session);
    set("type", d.event_type);
    set("guests", d.guests);
    set("addons", d.add_ons.length ? d.add_ons.length + " selected" : "");
    const cap = $("#capHint");
    if (d.venue && d.guests && +d.guests > d.venue.capacity) {
      cap.textContent = `${d.venue.name} fits up to ${d.venue.capacity} guests. Consider a larger hall, or tell us in the notes.`;
      cap.className = "hint warn";
    } else cap.textContent = "";
  }
  $("#bookForm").addEventListener("change", update);
  $("#bookForm").addEventListener("input", (e) => { if (e.target.name === "guests") update(); });

  function buildMessage(d, ref) {
    const sess = C.sessions.find((s) => s.id === d.session);
    return [
      `Hi Polybelle! I'd like to book an event 🎉`,
      ``,
      `*Booking Ref:* ${ref}`,
      `*Hall:* ${d.venue.name}`,
      `*Date:* ${fmtDate(d.date)}`,
      `*Session:* ${d.session}${sess ? ` (${sess.time})` : ""}`,
      `*Occasion:* ${d.event_type}`,
      d.guests ? `*Guests:* ${d.guests}` : null,
      d.add_ons.length ? `*Add-ons:* ${d.add_ons.join(", ")}` : null,
      ``,
      `*Name:* ${d.name}`,
      `*Mobile:* ${d.phone}`,
      d.email ? `*Email:* ${d.email}` : null,
      d.notes ? `*Notes:* ${d.notes}` : null,
      ``,
      `Please confirm availability and package rates. Thank you!`
    ].filter((l) => l !== null).join("\n");
  }

  function showError(msg) {
    const box = $("#formError");
    box.textContent = msg;
    box.style.display = msg ? "block" : "none";
    if (msg) box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  $("#bookForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const d = readForm();
    if (!d.venue) return showError("Please choose a hall.");
    if (!d.date) return showError("Please choose your event date.");
    if (d.date < todayDubai()) return showError("Please choose a future date.");
    if (!d.session) return showError("Please choose a session.");
    if (!d.event_type) return showError("Please choose the occasion.");
    if (!d.name) return showError("Please enter your name.");
    if (d.phone.replace(/\D/g, "").length < 7) return showError("Please enter a valid mobile number.");

    const btn = $("#submitBtn");
    btn.disabled = true;
    btn.lastChild.textContent = " Saving…";
    // open the WhatsApp tab now (inside the click) so popup blockers allow it
    const waWin = window.open("", "_blank");

    let ref;
    try {
      if (!sb || !d.venue.id) throw new Error("offline");
      const { data, error } = await sb.rpc("pb_request_booking", { p: {
        venue_id: d.venue.id, date: d.date, session: d.session, event_type: d.event_type,
        guests: d.guests || null, add_ons: d.add_ons, name: d.name, phone: d.phone, email: d.email, notes: d.notes
      } });
      if (error) throw error;
      ref = data;
    } catch (err) {
      const msg = err?.message || "";
      if (msg && msg !== "offline" && !/fetch|network/i.test(msg)) {
        if (waWin) waWin.close();
        btn.disabled = false; btn.lastChild.textContent = " Send on WhatsApp";
        await loadBooked(); renderSessions();
        return showError(msg);
      }
      ref = "PB-WEB-" + Date.now().toString(36).toUpperCase().slice(-5); // still let them reach us
    }

    const url = waLink(state.whatsapp, buildMessage(d, ref));
    if (waWin) waWin.location.href = url;
    $("#doneRef").textContent = ref;
    $("#doneWa").href = url;
    $("#doneModal").classList.add("open");
    btn.disabled = false; btn.lastChild.textContent = " Send on WhatsApp";
    $("#bookForm").reset();
    $("#dateInput").min = todayDubai();
    loadBooked().then(update);
  });
  $("#doneClose").addEventListener("click", () => $("#doneModal").classList.remove("open"));
  $("#doneModal").addEventListener("click", (e) => { if (e.target.id === "doneModal") e.currentTarget.classList.remove("open"); });

  // ---------- gallery
  const G = { items: [], filter: "All", shown: 9, view: [], idx: 0 };
  $("#gFb").href = C.facebook;
  function renderGallery() {
    const cats = ["All", ...C.galleryCategories.filter((c) => G.items.some((g) => g.category === c))];
    $("#gFilters").innerHTML = cats.length > 2 ? cats.map((c) => `<button type="button" role="tab" aria-selected="${c === G.filter}" class="${c === G.filter ? "on" : ""}" data-c="${esc(c)}">${esc(c === "All" ? "All events" : c)}</button>`).join("") : "";
    $$("#gFilters button").forEach((b) => b.addEventListener("click", () => { G.filter = b.dataset.c; G.shown = 9; renderGallery(); }));
    G.view = G.items.filter((g) => G.filter === "All" || g.category === G.filter);
    const list = G.view.slice(0, G.shown);
    $("#gGrid").innerHTML = list.length ? list.map((g, i) => `
      <button class="g-item" type="button" data-i="${i}" aria-label="View ${esc(g.caption || g.category)}">
        <img src="${esc(g.image_url)}" alt="${esc(g.caption || g.category)}" loading="lazy" onerror="this.style.visibility='hidden'">
        <span><small>${esc(g.category)}</small>${esc(g.caption || "")}</span>
      </button>`).join("") : `<p class="g-empty">New event photos coming soon.</p>`;
    $$("#gGrid .g-item").forEach((b) => b.addEventListener("click", () => openLb(+b.dataset.i)));
    $("#gMore").hidden = G.view.length <= G.shown;
  }
  $("#gMore").addEventListener("click", () => { G.shown += 9; renderGallery(); });
  function openLb(i) {
    G.idx = (i + G.view.length) % G.view.length;
    const g = G.view[G.idx];
    $("#lbImg").src = g.image_url; $("#lbImg").alt = g.caption || g.category;
    $("#lbCap").textContent = [g.caption, g.category].filter(Boolean).join(" · ");
    $("#lightbox").classList.add("open"); document.body.style.overflow = "hidden";
  }
  const closeLb = () => { $("#lightbox").classList.remove("open"); document.body.style.overflow = ""; };
  $("#lbClose").addEventListener("click", closeLb);
  $("#lbPrev").addEventListener("click", () => openLb(G.idx - 1));
  $("#lbNext").addEventListener("click", () => openLb(G.idx + 1));
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLb(); });
  document.addEventListener("keydown", (e) => {
    if (!$("#lightbox").classList.contains("open")) return;
    if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") openLb(G.idx - 1); if (e.key === "ArrowRight") openLb(G.idx + 1);
  });
  let touchX = null;
  $("#lightbox").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  $("#lightbox").addEventListener("touchend", (e) => { if (touchX === null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) openLb(G.idx + (dx < 0 ? 1 : -1)); touchX = null; });

  // ---------- data
  async function loadBooked() {
    if (!sb) return;
    const { data } = await sb.rpc("pb_booked_slots");
    if (data) state.booked = data;
  }

  async function init() {
    state.venues = DEFAULT_VENUES;
    renderVenues(); renderContact(); update();
    if (!sb) return;
    sb.from("pb_gallery").select("image_url,caption,category").eq("active", true).order("sort_order").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) { G.items = data; renderGallery(); } });
    const [venues, settings] = await Promise.all([
      sb.from("pb_venues").select("id,name,tagline,description,capacity,branch,image_url,price_from,sort_order").eq("active", true).order("sort_order").order("name"),
      sb.rpc("pb_public_settings"),
      loadBooked()
    ]);
    if (venues.data?.length) { state.venues = venues.data; renderVenues(); }
    const s = settings.data?.[0];
    if (s) { state.whatsapp = s.booking_whatsapp || state.whatsapp; state.phones = s.display_phones || state.phones; renderContact(); }
    update();
  }

  // ---------- reveal on scroll
  let io;
  function observe() {
    if (!("IntersectionObserver" in window)) { document.querySelectorAll(".fade").forEach((el) => el.classList.add("in")); return; }
    io = io || new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: .12 });
    document.querySelectorAll(".fade:not(.in)").forEach((el) => io.observe(el));
  }

  init();
})();

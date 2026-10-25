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
  const nav = $("#nav"), menuBtn = $("#menuBtn");
  const setMenu = (open) => { $("#navLinks").classList.toggle("open", open); nav.classList.toggle("menu-open", open); menuBtn.setAttribute("aria-expanded", open); };
  menuBtn.addEventListener("click", () => setMenu(!$("#navLinks").classList.contains("open")));
  $$("#navLinks a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  // header turns solid and WhatsApp button appears once past the hero
  const onScroll = () => {
    const y = window.scrollY, heroH = $(".hero").offsetHeight;
    nav.classList.toggle("solid", y > 40);
    $("#waFloat").classList.toggle("show", y > heroH * .6);
  };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  $("#typeInput").innerHTML = `<option value="">Select occasion…</option>` + C.eventTypes.map((t) => `<option>${esc(t)}</option>`).join("");
  // ---------- packages & services picker (photo cards, managed in the admin)
  let services = C.addOns.map((name) => ({ name, kind: /package/i.test(name) ? "Package" : "Service" }));
  function renderServices() {
    const picked = new Set($$('#addonPick input:checked').map((i) => i.value));
    $("#addonPick").innerHTML = services.map((sv) => `
      <label class="svc">
        <input type="checkbox" name="add_ons" value="${esc(sv.name)}" ${picked.has(sv.name) ? "checked" : ""}>
        <span class="svc-card">
          <span class="svc-img">${sv.image_url ? `<img src="${esc(sv.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span class="svc-ph" aria-hidden="true">${esc(sv.name.trim()[0] || "")}</span>
            ${sv.kind === "Package" ? `<span class="svc-tag">Package</span>` : ""}<span class="svc-check" aria-hidden="true"></span></span>
          <span class="svc-body"><b>${esc(sv.name)}</b>${sv.description ? `<small>${esc(sv.description)}</small>` : ""}</span>
        </span>
      </label>`).join("");
  }
  renderServices();
  $("#dateInput").min = todayDubai();

  function renderContact() {
    const phones = state.phones.split("|").map((p) => p.trim()).filter(Boolean);
    $("#asidePhones").textContent = phones[0] || "";
    $("#asidePhones").href = phones[0] ? telLink(phones[0]) : "#contact";
    $("#contactPhones").innerHTML = "Call or WhatsApp " + phones.map((p) => `<a href="${telLink(p)}">${esc(p)}</a>`).join(" &nbsp;·&nbsp; ");
    const ICONS = {
      Facebook: '<path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9H17l.5-4h-4V8.9c0-.6.3-.9.9-.9Z"/>',
      Instagram: '<path d="M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3Zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 3.6c2.7 0 3 0 4.1.1 2.7.1 4 1.4 4.1 4.1.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 2.7-1.4 4-4.1 4.1-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-2.7-.1-4-1.4-4.1-4.1C3.7 15 3.6 14.7 3.6 12s0-3 .1-4.1c.1-2.7 1.4-4 4.1-4.1C8.9 3.6 9.3 3.6 12 3.6ZM12 2C9.3 2 8.9 2 7.9 2.1 4.2 2.2 2.2 4.2 2.1 7.9 2 8.9 2 9.3 2 12s0 3.1.1 4.1c.1 3.6 2.1 5.7 5.8 5.8 1 .1 1.4.1 4.1.1s3.1 0 4.1-.1c3.6-.1 5.7-2.1 5.8-5.8.1-1 .1-1.4.1-4.1s0-3.1-.1-4.1c-.1-3.6-2.1-5.7-5.8-5.8C15.1 2 14.7 2 12 2Z"/>',
      TikTok: '<path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.1-2.8V9.2a6.3 6.3 0 1 0 5.5 6.2V8.7a8 8 0 0 0 4.4 1.4V6.7a4.6 4.6 0 0 1-4.4-4.7Z"/>',
      WhatsApp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.1Z"/>'
    };
    const socials = [...(C.socials || []).filter((s) => s.url), { name: "WhatsApp", url: waLink(state.whatsapp, "Hi Polybelle! I'd like to ask about booking an event.") }];
    $$("[data-socials]").forEach((el) => (el.innerHTML = socials.map((s) =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener" aria-label="${esc(s.name)}" title="${esc(s.name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[s.name] || ""}</svg></a>`).join("")));
    $("#waFloat").href =waLink(state.whatsapp, "Hi Polybelle! I'd like to ask about booking an event.");
    $("#locGrid").innerHTML = C.branches.map((b, i) => `
      <div class="loc reveal" style="--d:${i}">
        <h3>${esc(b.name)}</h3>
        <p>${esc(b.address)}</p>
        <p>${esc(b.landmark)}</p>
        <a class="link-line" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.landmark + ", " + b.name + ", Abu Dhabi")}" target="_blank" rel="noopener">Directions</a>
      </div>`).join("");
    observe();
  }

  function renderVenues() {
    $("#venueGrid").innerHTML = state.venues.map((v, i) => `
      <article class="venue" style="--d:${i % 4}">
        <div class="venue-img">
          <img src="${esc(imgFor(v, i))}" alt="${esc(v.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph'}))">
          <span class="cap">Up to ${v.capacity} guests</span>
        </div>
        <div class="venue-body">
          ${v.tagline ? `<span class="tag">${esc(v.tagline)}</span>` : ""}
          <h3>${esc(v.name)}</h3>
          ${v.description ? `<p>${esc(v.description)}</p>` : ""}
          ${v.branch || v.price_from ? `<span class="meta">${[v.branch, v.price_from ? "From " + money(v.price_from) : ""].filter(Boolean).map(esc).join(" · ")}</span>` : ""}
          <button class="link-line" type="button" data-book="${esc(v.id || v.name)}">Reserve this hall</button>
        </div>
      </article>`).join("");
    $("#hallPick").innerHTML = state.venues.map((v) => `
      <label class="chip-radio"><input type="radio" name="venue" value="${esc(v.id || v.name)}" required>
        <span><b>${esc(v.name)}</b><small>Up to ${v.capacity} guests${v.branch ? " · " + esc(v.branch) : ""}</small></span></label>`).join("");
    document.querySelectorAll("[data-book]").forEach((b) => b.addEventListener("click", () => {
      setType("Hall");
      const r = document.querySelector(`#hallPick input[value="${CSS.escape(b.dataset.book)}"]`);
      if (r) { r.checked = true; update(); }
      $("#book").scrollIntoView({ behavior: "smooth" });
    }));
    observe();
  }

  function renderSessions() {
    const venue = selectedVenue();
    const date = $("#dateInput").value;
    const servicesOnly = bookingType() === "Services";
    const taken = state.booked.filter((b) => venue && b.venue_id === venue.id && b.event_date === date).map((b) => b.session);
    const wholeTaken = taken.includes("Whole day");
    const current = document.querySelector('#sessionPick input:checked')?.value;
    $("#sessionPick").innerHTML = C.sessions.map((s) => {
      const blocked = !servicesOnly && (wholeTaken || taken.includes(s.id) || (s.id === "Whole day" && taken.length > 0));
      return `<label class="chip-radio"><input type="radio" name="session" value="${esc(s.id)}" ${blocked ? "disabled" : ""} ${current === s.id && !blocked ? "checked" : ""} required>
        <span><b>${esc(s.id)}</b><small>${blocked ? "Already booked" : esc(s.time)}</small></span></label>`;
    }).join("");
    const hint = $("#availHint");
    if (servicesOnly) { hint.textContent = "Choose the time of your event so our team can plan around it."; hint.className = "hint"; }
    else if (!venue || !date) { hint.textContent = "Pick a hall and date to see open sessions."; hint.className = "hint"; }
    else if (taken.length === 0) { hint.textContent = `Good news — ${venue.name} is open all day on ${fmtDate(date)}.`; hint.className = "hint"; }
    else if (wholeTaken || C.sessions.every((s) => s.id === "Whole day" || taken.includes(s.id))) { hint.textContent = `${venue.name} is fully booked on this date. Please try another date or hall.`; hint.className = "hint warn"; }
    else { hint.textContent = "Some sessions are already booked — open ones are still available."; hint.className = "hint"; }
  }

  const bookingType = () => document.querySelector('#bookForm input[name="booking_type"]:checked')?.value || "Hall";
  function setType(t) {
    const r = document.querySelector(`#bookForm input[name="booking_type"][value="${t}"]`);
    if (r) r.checked = true;
    update();
  }
  $$("[data-book-type]").forEach((b) => b.addEventListener("click", () => setType(b.dataset.bookType)));
  const selectedVenue = () => {
    if (bookingType() !== "Hall") return undefined;
    const val = document.querySelector('#hallPick input:checked')?.value;
    return state.venues.find((v) => (v.id || v.name) === val);
  };

  function readForm() {
    const f = $("#bookForm");
    const fd = new FormData(f);
    return {
      booking_type: bookingType(),
      event_location: (fd.get("event_location") || "").trim(),
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
    const servicesOnly = bookingType() === "Services";
    $("#hallWrap").hidden = servicesOnly;
    $("#locWrap").hidden = !servicesOnly;
    $("#addonLabel").textContent = servicesOnly ? "Choose the packages and services you'd like (at least one)" : "Packages and services you're interested in (optional)";
    renderSessions();
    const d = readForm();
    const set = (k, v) => ($(`[data-s="${k}"]`).textContent = v || "—");
    set("kind", servicesOnly ? "Package / services" : "Hall");
    set("hall", servicesOnly ? (d.event_location || "Your venue") : d.venue?.name);
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
  $("#bookForm").addEventListener("change", () => { $("#formError").style.display = "none"; update(); });
  $("#bookForm").addEventListener("input", (e) => { if (e.target.name === "guests") update(); });

  function buildMessage(d, ref) {
    const sess = C.sessions.find((s) => s.id === d.session);
    return [
      `Hi Polybelle! I'd like to book an event 🎉`,
      ``,
      `*Booking Ref:* ${ref}`,
      d.booking_type === "Services" ? `*Booking:* Package / services only` : `*Hall:* ${d.venue.name}`,
      d.booking_type === "Services" ? `*Event location:* ${d.event_location || "To be confirmed"}` : null,
      `*Date:* ${fmtDate(d.date)}`,
      `*Session:* ${d.session}${sess ? ` (${sess.time})` : ""}`,
      `*Occasion:* ${d.event_type}`,
      d.guests ? `*Guests:* ${d.guests}` : null,
      d.add_ons.length ? `*Packages & services:* ${d.add_ons.join(", ")}` : null,
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
    const servicesOnly = d.booking_type === "Services";
    if (!servicesOnly && !d.venue) return showError("Please choose a hall, or select “Package or services only”.");
    if (servicesOnly && !d.add_ons.length) return showError("Please choose at least one package or service.");
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
      if (!sb || (!servicesOnly && !d.venue.id)) throw new Error("offline");
      const { data, error } = await sb.rpc("pb_request_booking", { p: {
        booking_type: d.booking_type, event_location: d.event_location,
        venue_id: servicesOnly ? null : d.venue.id, date: d.date, session: d.session, event_type: d.event_type,
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
    update();
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
      <button class="g-item" type="button" data-i="${i}" style="--d:${i % 9}" aria-label="View ${esc(g.caption || g.category)}">
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

  // ---------- reviews
  const R = { items: [], shown: 6 };
  const starStr = (n) => "★".repeat(n) + `<span class="off">${"★".repeat(5 - n)}</span>`;
  $("#rFb").href = C.facebook.replace(/&?sk=[^&]*/, "") + "&sk=reviews";
  $("#rType").innerHTML = `<option value="">Select…</option>` + C.eventTypes.map((t) => `<option>${esc(t)}</option>`).join("");
  function renderReviews() {
    const n = R.items.length;
    $("#rEmpty").hidden = n > 0;
    $("#rSummary").hidden = n === 0;
    if (n) {
      const avg = R.items.reduce((s, r) => s + r.rating, 0) / n;
      $("#rSummary").innerHTML = `<b>${avg.toFixed(1)}</b><span class="stars">${starStr(Math.round(avg))}</span><span>from ${n} review${n > 1 ? "s" : ""}</span>`;
    }
    $("#rGrid").innerHTML = R.items.slice(0, R.shown).map((r, i) => `
      <article class="r-card reveal" style="--d:${i % 3}">
        <span class="stars" aria-label="${r.rating} out of 5 stars">${starStr(r.rating)}</span>
        <p>${esc(r.comment)}</p>
        <div class="who">${esc(r.name)}<small>${[r.event_type, r.source !== "Website" ? "via " + r.source : ""].filter(Boolean).map(esc).join(" · ")}</small></div>
      </article>`).join("");
    $("#rMore").hidden = n <= R.shown;
    observe();
  }
  $("#rMore").addEventListener("click", () => { R.shown += 6; renderReviews(); });
  const rModal = $("#reviewModal");
  $("#rWrite").addEventListener("click", () => { rModal.classList.add("open"); $("#reviewForm").name.focus(); });
  $("#rCancel").addEventListener("click", () => rModal.classList.remove("open"));
  rModal.addEventListener("click", (e) => { if (e.target === rModal) rModal.classList.remove("open"); });
  $("#reviewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f), err = $("#rError");
    const p = { rating: fd.get("rating"), name: (fd.get("name") || "").trim(), event_type: fd.get("event_type"), comment: (fd.get("comment") || "").trim() };
    const fail = (m) => { err.textContent = m; err.style.display = "block"; };
    err.style.display = "none";
    if (!p.rating) return fail("Please tap a star rating.");
    if (!p.name) return fail("Please enter your name.");
    if (p.comment.length < 10) return fail("Please write a few words about your event.");
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const { error } = sb ? await sb.rpc("pb_submit_review", { p }) : { error: { message: "Please try again later." } };
    btn.disabled = false;
    if (error) return fail(error.message);
    f.reset();
    f.innerHTML = `<span class="tick" aria-hidden="true"></span><h3 style="text-align:center">Thank you</h3><p style="text-align:center">Your review has been sent to our team and will appear on the website once approved.</p><button class="btn btn-dark" type="button" onclick="this.closest('.modal').classList.remove('open')">Close</button>`;
  });

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
    sb.from("pb_reviews").select("name,event_type,rating,comment,source,featured,created_at").eq("status", "Approved")
      .order("featured", { ascending: false }).order("created_at", { ascending: false }).limit(60)
      .then(({ data }) => { R.items = data || []; renderReviews(); });
    sb.from("pb_services").select("name,kind,description,image_url").eq("active", true).order("sort_order").order("name")
      .then(({ data }) => { if (data?.length) { services = data; renderServices(); update(); } });
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
    const sel = ".reveal:not(.in), .venue:not(.in)";
    if (!("IntersectionObserver" in window)) { $$(sel).forEach((el) => el.classList.add("in")); return; }
    io = io || new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: .12, rootMargin: "0px 0px -6% 0px" });
    $$(sel).forEach((el) => io.observe(el));
  }

  init();
  observe();
})();

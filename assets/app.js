(() => {
  const C = window.PB_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sb = window.supabase ? window.supabase.createClient(C.supabaseUrl, C.supabaseKey) : null;

  const DEFAULT_VENUES = [
    { id: "", name: "Hall A", tagline: "Grand celebrations", description: "Our largest hall, styled for weddings and milestone birthdays.", capacity: 100 },
    { id: "", name: "Hall B", tagline: "Elegant & spacious", description: "A bright, versatile hall for big family gatherings and corporate get-togethers.", capacity: 100 },
    { id: "", name: "Hall C", tagline: "Cozy & intimate", description: "A warm mid-sized space, perfect for baby showers and kids' parties.", capacity: 60 },
    { id: "", name: "Hall D", tagline: "Small & special", description: "An intimate room for dedications, cake smash shoots and meetings.", capacity: 50 }
  ];

  const state = { venues: [], booked: [], whatsapp: C.bookingWhatsapp, phones: C.displayPhones };

  // ---------- helpers
  const imgFor = (v, i) => v.image_url || C.fallbackImages[i % C.fallbackImages.length];
  const googleMapsUrl = (value) => {
    if (!value) return "";
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (
        /^maps\.google\.(?:[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/.test(host) ||
        /^www\.google\.(?:[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/.test(host) && /^\/maps(?:\/|$)/.test(url.pathname) ||
        host === "maps.app.goo.gl" ||
        host === "goo.gl" && url.pathname.startsWith("/maps")
      ) ? url.href : "";
    } catch {
      return "";
    }
  };
  const googleMapsEmbedUrl = (value) => {
    const validUrl = googleMapsUrl(value);
    if (!validUrl) return "";
    const url = new URL(validUrl);
    if (/\/maps\/(?:d\/)?embed(?:\/|$)/.test(url.pathname)) return url.href;
    const coords = url.pathname.match(/@(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)/);
    const routeCoords = url.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const placePath = url.pathname.match(/\/maps\/place\/([^/]+)/);
    const searchPath = url.pathname.match(/\/maps\/search\/([^/]+)/);
    let query = url.searchParams.get("query") || url.searchParams.get("q") ||
      url.searchParams.get("destination") || url.searchParams.get("ll") ||
      url.searchParams.get("center") || coords?.[1] ||
      (routeCoords ? `${routeCoords[1]},${routeCoords[2]}` : "");
    if (!query && placePath) {
      try {
        query = decodeURIComponent(placePath[1].replace(/\+/g, " "));
      } catch {
        query = placePath[1];
      }
    }
    if (!query && searchPath) {
      try {
        query = decodeURIComponent(searchPath[1].replace(/\+/g, " "));
      } catch {
        query = searchPath[1];
      }
    }
    if (!query) return "";
    return `https://www.google.com/maps?output=embed&q=${encodeURIComponent(query)}`;
  };
  const googleMapsOpenUrl = (value, venue) => {
    const validUrl = googleMapsUrl(value);
    if (!validUrl) return "";
    const url = new URL(validUrl);
    if (!/\/maps\/(?:d\/)?embed(?:\/|$)/.test(url.pathname) && url.searchParams.get("output") !== "embed") {
      return validUrl;
    }
    const embedData = url.searchParams.get("pb") || url.href;
    const latLong = embedData.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const longLat = embedData.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/);
    const coords = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const query = url.searchParams.get("query") || url.searchParams.get("q") ||
      (latLong ? `${latLong[1]},${latLong[2]}` : "") ||
      (longLat ? `${longLat[2]},${longLat[1]}` : "") ||
      (coords ? `${coords[1]},${coords[2]}` : "") ||
      [venue.name, venue.branch, "Abu Dhabi"].filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  };
  // "Other venues" (customer's own location): a pseudo-hall that books packages/services with a typed location
  const OTHER = "__other";
  let OV = C.otherVenue || {};
  const makeOtherVenue = () => ({ id: OTHER, other: true, name: OV.name || "Other venues", tagline: OV.tagline || "", description: OV.description || "",
    image_url: OV.image || "", image_pos: OV.imagePos || "", capacity: null });
  let otherVenue = makeOtherVenue();
  const allVenues = () => (OV.show === false ? state.venues : [...state.venues, otherVenue]);
  const vLabel = (v) => (v?.other ? "Our events team" : v?.name || "");
  // photo framing set in the admin ("x% y%"); only used with the real uploaded photo
  const posStyle = (o) => (o.image_url && /^(100|\d{1,2})% (100|\d{1,2})%$/.test(o.image_pos || "") ? ` style="object-position:${o.image_pos}"` : "");
  const telLink = (n) => "tel:+971" + n.replace(/\D/g, "").replace(/^0/, "");
  // tidy WhatsApp text: swap typographic dashes/quotes for plain ones (emojis are kept)
  const waClean = (t) => String(t)
    .replace(/[\u2013\u2014\u2012\u2212]/g, "-").replace(/[\u00B7\u2022\u2219]/g, "-")
    .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, "...").replace(/\u00D7/g, "x")
    .replace(/[\u00A0\u2009\u202F]/g, " ")
    .replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
  // api.whatsapp.com keeps emojis intact (the short wa.me redirect can garble them in WhatsApp Desktop/Web)
  const waLink = (num, text) => `https://api.whatsapp.com/send?phone=${num.replace(/\D/g, "")}${text ? "&text=" + encodeURIComponent(waClean(text)) : ""}`;
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—";
  const todayDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const money = (n) => "AED " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

  // ---------- static bits
  $("#year").textContent = new Date().getFullYear();
  const heroImages = Array.from({ length: 16 }, (_, i) => `assets/parade-images/pic${i + 1}.webp`);
  const heroParade = $("#heroParade");
  const paradeOrders = [
    heroImages,
    [...heroImages.slice(5), ...heroImages.slice(0, 5)].reverse(),
    [...heroImages.slice(10), ...heroImages.slice(0, 10)]
  ];
  paradeOrders.forEach((order, rowIndex) => {
    const row = document.createElement("div");
    row.className = "hero-parade-row";
    const fragment = document.createDocumentFragment();
    [false, true].forEach((duplicate) => {
      const group = document.createElement("div");
      group.className = "hero-parade-group";
      order.forEach((src, imageIndex) => {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.loading = "eager";
        img.decoding = "async";
        img.draggable = false;
        if (!duplicate && rowIndex === 0 && imageIndex === 0) img.fetchPriority = "high";
        group.append(img);
      });
      fragment.append(group);
    });
    row.append(fragment);
    heroParade.append(row);
  });
  const nav = $("#nav"), menuBtn = $("#menuBtn");
  const setMenu = (open) => { $("#navLinks").classList.toggle("open", open); nav.classList.toggle("menu-open", open); menuBtn.setAttribute("aria-expanded", open); };
  menuBtn.addEventListener("click", () => setMenu(!$("#navLinks").classList.contains("open")));
  $$("#navLinks a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  // header turns solid and WhatsApp button appears once past the hero
  // (batched to one update per frame, hero height cached so scrolling never forces a layout)
  let heroH = $(".hero").offsetHeight, scrollQueued = false;
  const waFloat = $("#waFloat");
  const onScroll = () => {
    scrollQueued = false;
    const y = window.scrollY;
    nav.classList.toggle("solid", y > 40);
    waFloat.classList.toggle("show", y > heroH * .6);
    document.body.classList.toggle("past-hero", y > heroH);   // pauses the hero's slow zoom once it's off screen
  };
  window.addEventListener("scroll", () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener("resize", () => { heroH = $(".hero").offsetHeight; }, { passive: true });
  onScroll();

  $("#typeInput").innerHTML = `<option value="">Select occasion…</option>` + C.eventTypes.map((t) => `<option>${esc(t)}</option>`).join("");
  // ---------- packages & services picker (photo cards, managed in the admin)
  let services = C.addOns.map((name) => ({ name, kind: /package/i.test(name) ? "Package" : "Service", category: /package/i.test(name) ? "Full Packages" : "Event Services" }));
  let svcTab = null;
  function renderSvcTabs() {
    const cats = [...(C.serviceCategories || []), ...new Set(services.map((x) => x.category || "Event Services"))]
      .filter((c, i, arr) => arr.indexOf(c) === i && services.some((x) => (x.category || "Event Services") === c));
    if (!cats.includes(svcTab)) svcTab = cats[0];
    const picked = $$('#addonPick input:checked').map((i) => services.find((x) => x.name === i.value)?.category || "Event Services");
    $("#svcTabs").innerHTML = cats.length > 1 ? cats.map((c) => {
      const n = picked.filter((p) => p === c).length;
      return `<button type="button" role="tab" aria-label="${esc(c)}" aria-selected="${c === svcTab}" class="${c === svcTab ? "on" : ""}" data-cat="${esc(c)}"><span>${esc(c)}</span>${n ? `<i>${n}</i>` : ""}</button>`;
    }).join("") : "";
    $$("#svcTabs button").forEach((b) => b.addEventListener("click", () => { svcTab = b.dataset.cat; closeSvcDetail(); renderSvcTabs(); }));
    $$("#addonPick .svc").forEach((el) => (el.hidden = cats.length > 1 && el.dataset.cat !== svcTab));
  }
  function renderServices() {
    const picked = new Set($$('#addonPick input:checked').map((i) => i.value));
    const reopen = svcOpen;
    $("#addonPick").innerHTML = services.map((sv, i) => `
      <div class="svc" data-cat="${esc(sv.category || "Event Services")}" data-i="${i}">
        <input type="checkbox" name="add_ons" value="${esc(sv.name)}" ${picked.has(sv.name) ? "checked" : ""} tabindex="-1" aria-hidden="true">
        <button type="button" class="svc-card" aria-expanded="false" aria-controls="svcDetail">
          <span class="svc-img">${sv.image_url ? `<img src="${esc(sv.image_url)}"${posStyle(sv)} alt="${esc(sv.name)}" loading="lazy" onerror="this.remove()">` : ""}<span class="svc-ph" aria-hidden="true">${esc(sv.name.trim()[0] || "")}</span>
            ${sv.kind === "Package" ? `<span class="svc-tag">Package</span>` : ""}</span>
          <span class="svc-body"><b>${esc(sv.name)}</b><small>${sv.kind === "Package" ? "See what's included" : "Details"}</small></span>
        </button>
        <button type="button" class="svc-check" aria-pressed="${picked.has(sv.name)}" aria-label="Add ${esc(sv.name)} to my booking"></button>
      </div>`).join("");
    svcOpen = null;
    $$("#addonPick .svc").forEach((el) => {
      const cb = $("input", el);
      // tapping the card only shows its details; adding happens with the Add button or the round check
      $(".svc-card", el).addEventListener("click", () => (svcOpen === el ? closeSvcDetail() : openSvcDetail(el)));
      $(".svc-check", el).addEventListener("click", () => setPicked(el, !cb.checked));
    });
    renderSvcTabs();
    if (reopen) { const el = $(`#addonPick .svc[data-i="${reopen.dataset.i}"]`); if (el && !el.hidden) openSvcDetail(el); }
  }

  // ---------- package / service details panel (opens under the tapped card's row)
  let svcOpen = null;
  const svcDetail = document.createElement("div");
  svcDetail.className = "svc-detail"; svcDetail.id = "svcDetail"; svcDetail.setAttribute("role", "region");
  function setPicked(el, on) {
    const cb = $("input", el);
    cb.checked = on;
    $(".svc-check", el).setAttribute("aria-pressed", on);
    $(".svc-check", el).setAttribute("aria-label", `${on ? "Remove" : "Add"} ${cb.value} ${on ? "from" : "to"} my booking`);
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    if (svcOpen === el) fillSvcDetail(el);
  }
  function fillSvcDetail(el) {
    const sv = services[+el.dataset.i], on = $("input", el).checked, pkg = sv.kind === "Package";
    const inc = (sv.inclusions || []).filter(Boolean);
    svcDetail.setAttribute("aria-label", `${sv.name} details`);
    svcDetail.innerHTML = `
      <button type="button" class="sd-x" aria-label="Close details">×</button>
      <div class="sd-main">
        <span class="sd-kind">${pkg ? "Package" : "Service"} · ${esc(sv.category || "Event Services")}</span>
        <h4>${esc(sv.name)}</h4>
        ${sv.description ? `<p class="sd-desc">${esc(sv.description)}</p>` : ""}
      </div>
      ${pkg ? (inc.length
        ? `<div class="sd-inc"><span class="sd-sub">What's included</span><ul>${inc.map((x, k) => `<li style="--k:${k}">${esc(x)}</li>`).join("")}</ul></div>`
        : `<div class="sd-inc"><span class="sd-sub">What's included</span><p class="sd-note">Our team will share the full inclusions and rates for this package on WhatsApp.</p></div>`) : ""}
      <div class="sd-actions">
        <button type="button" class="btn ${on ? "btn-outline" : "btn-dark"} sm" data-sd-toggle>${on ? "Remove" : "Add"}</button>
        ${on ? `<span class="sd-added">Added to your booking</span>` : ""}
      </div>`;
    $(".sd-x", svcDetail).onclick = closeSvcDetail;
    $("[data-sd-toggle]", svcDetail).onclick = () => setPicked(el, !$("input", el).checked);
  }
  function openSvcDetail(el) {
    if (svcOpen) $(".svc-card", svcOpen).setAttribute("aria-expanded", "false");
    svcDetail.remove();
    const row = $$("#addonPick .svc:not([hidden])").filter((c) => c.offsetTop === el.offsetTop);
    (row[row.length - 1] || el).after(svcDetail);
    svcDetail.style.setProperty("--arrow-x", `${el.offsetLeft - $("#addonPick").offsetLeft + el.offsetWidth / 2}px`);
    svcOpen = el;
    $(".svc-card", el).setAttribute("aria-expanded", "true");
    fillSvcDetail(el);
    svcDetail.classList.remove("in"); void svcDetail.offsetWidth; svcDetail.classList.add("in");
    const r = svcDetail.getBoundingClientRect();
    if (r.bottom > window.innerHeight) svcDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function closeSvcDetail() {
    if (svcOpen) $(".svc-card", svcOpen).setAttribute("aria-expanded", "false");
    svcOpen = null; svcDetail.remove();
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && svcOpen) { const el = svcOpen; closeSvcDetail(); $(".svc-card", el).focus(); } });
  let svcResize;
  window.addEventListener("resize", () => { clearTimeout(svcResize); svcResize = setTimeout(() => { if (svcOpen) openSvcDetail(svcOpen); }, 150); });

  renderServices();
  $("#addonPick").addEventListener("change", renderSvcTabs);
  $("#dateInput").min = todayDubai();

  function renderContact() {
    const phones = state.phones.split("|").map((p) => p.trim()).filter(Boolean);
    $("#asidePhones").textContent = phones[0] || "";
    $("#asidePhones").href = phones[0] ? telLink(phones[0]) : "#contact";
    const whatsappChoices = (C.bookingWhatsappChoices || [{ number: state.whatsapp, label: "WhatsApp" }])
      .map((choice) => ({ number: String(choice.number || "").replace(/\D/g, ""), label: choice.label || "WhatsApp" }))
      .filter((choice) => choice.number);
    [$("#summaryWhatsappChoices"), $("#formWhatsappChoices")].forEach((el) => {
      el.innerHTML = whatsappChoices.map((choice) =>
        `<button type="submit" form="bookForm" class="btn btn-wa" data-wa-number="${esc(choice.number)}" aria-label="Send booking to ${esc(choice.label)} on WhatsApp">WhatsApp ${esc(choice.label)}</button>`
      ).join("");
    });
    if ($("#ucScreen")) {
      $("#ucMsg").textContent = C.underConstructionMessage || "";
      $("#ucPhones").innerHTML = phones.map((p) => `<a href="${telLink(p)}">${esc(p)}</a>`).join(" &nbsp;·&nbsp; ");
      $("#ucWa").href = waLink(state.whatsapp, "Hi Polybelle! I'd like to ask about booking an event.");
    }
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
    $("#venueGrid").innerHTML = allVenues().map((v, i) => `
      <article class="venue" style="--d:${i % 4}">
        <div class="venue-img">
          <img src="${esc(imgFor(v, i))}"${posStyle(v)} alt="${esc(v.other ? `${v.name}: Polybelle events at your venue in Abu Dhabi` : `${v.name}, event hall at Polybelle, Abu Dhabi`)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph'}))">
          <span class="cap">${v.other ? "At your location" : `Up to ${v.capacity} guests`}</span>
        </div>
        <div class="venue-body">
          ${v.tagline ? `<span class="tag">${esc(v.tagline)}</span>` : ""}
          <h3>${esc(v.name)}</h3>
          ${v.description ? `<p>${esc(v.description)}</p>` : ""}
          ${v.branch || v.price_from ? `<span class="meta">${[v.branch, v.price_from ? "From " + money(v.price_from) : ""].filter(Boolean).map(esc).join(" · ")}</span>` : ""}
        </div>
        <div class="venue-footer">
          ${googleMapsUrl(v.google_maps_url) ? `<div class="venue-map-embed">${googleMapsEmbedUrl(v.google_maps_url) ? `<iframe src="${esc(googleMapsEmbedUrl(v.google_maps_url))}" title="Map showing ${esc(v.name)} location" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>` : `<p class="venue-map-hint">For an embedded map, add a Google Maps “Embed a map” URL in the admin.</p>`}<a class="venue-map-link" href="${esc(googleMapsOpenUrl(v.google_maps_url, v))}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(v.name)} location in Google Maps"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>Open in Google Maps</a></div>` : ""}
          <span class="venue-links">
            <button class="link-line avail-link" type="button" data-avail="${esc(v.id || v.name)}" aria-label="Check availability for ${esc(v.name)}" aria-expanded="false" aria-controls="availPanel"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r=".9"/><circle cx="12" cy="14.5" r=".9"/><circle cx="15.5" cy="14.5" r=".9"/></svg>Check availability</button>
          </span>
        </div>
      </article>`).join("");
    const keep = document.querySelector('#hallPick input:checked')?.value;
    $("#hallPick").innerHTML = allVenues().map((v) => `
      <label class="chip-radio ${v.other ? "other" : ""}"><input type="radio" name="venue" value="${esc(v.id || v.name)}" ${keep === (v.id || v.name) ? "checked" : ""} required>
        <span><b>${esc(v.name)}</b>${v.capacity != null ? `<small>Up to ${esc(v.capacity)} guests</small>` : ""}</span></label>`).join("");
    $$("[data-avail]").forEach((b) => b.addEventListener("click", () => {
      if (CAL.open && CAL.hall === b.dataset.avail) return closeAvail();
      openAvail(b.dataset.avail);
    }));
    if (CAL.open) { const key = CAL.hall; CAL.open = false; openAvail(key, true); }
    observe();
  }

  function renderSessions() {
    const venue = selectedVenue();
    const date = $("#dateInput").value;
    const servicesOnly = bookingType() === "Services";
    const taken = venue && date ? takenFor(venue.id, date) : [];
    const wholeTaken = taken.includes("Whole day");
    const current = document.querySelector('#sessionPick input:checked')?.value;
    $("#sessionPick").innerHTML = C.sessions.map((s) => {
      const blocked = wholeTaken || taken.includes(s.id) || (s.id === "Whole day" && taken.length > 0);
      return `<label class="chip-radio"><input type="radio" name="session" value="${esc(s.id)}" ${blocked ? "disabled" : ""} ${current === s.id && !blocked ? "checked" : ""} required>
        <span><b>${esc(s.id)}</b><small>${blocked ? "Already booked" : esc(s.time)}</small></span></label>`;
    }).join("");
    const hint = $("#availHint");
    if (!venue || !date) { hint.textContent = "Pick a hall (or Other venues) and a date to see open sessions."; hint.className = "hint"; }
    else if (taken.length === 0) { hint.textContent = servicesOnly ? `Good news — our team is free all day on ${fmtDate(date)}.` : `Good news — ${venue.name} is open all day on ${fmtDate(date)}.`; hint.className = "hint"; }
    else if (wholeTaken || C.sessions.every((s) => s.id === "Whole day" || taken.includes(s.id))) { hint.textContent = `${vLabel(venue)} is fully booked on this date. Please try another date${servicesOnly ? "" : " or hall"}.`; hint.className = "hint warn"; }
    else { hint.textContent = "Some sessions are already booked — open ones are still available."; hint.className = "hint"; }
  }

  const fullyBooked = (d) => d.venue?.id && d.date && dayState(takenFor(d.venue.id, d.date)) === "full";
  const sessionTaken = (venue, date, sess) => { const t = takenFor(venue?.id, date); return t.includes(sess) || t.includes("Whole day") || (sess === "Whole day" && t.length > 0); };
  // choosing "Other venues" makes it a package / services booking at the customer's location
  const bookingType = () => (document.querySelector('#hallPick input:checked')?.value === OTHER ? "Services" : "Hall");
  const selectedVenue = () => {
    const val = document.querySelector('#hallPick input:checked')?.value;
    return allVenues().find((v) => (v.id || v.name) === val);
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
      notes: (fd.get("notes") || "").trim(),
      promo_code: (fd.get("promo_code") || "").trim().toUpperCase()
    };
  }

  function update() {
    const servicesOnly = bookingType() === "Services";
    $("#locWrap").hidden = !servicesOnly;
    // address of the chosen hall, shown under the hall buttons
    const addrV = selectedVenue(), addr = addrV && !addrV.other ? (addrV.venue_address || "").trim() : "";
    const addrEl = $("#hallAddr");
    if ($("span", addrEl).textContent !== addr) { $("span", addrEl).textContent = addr; addrEl.classList.remove("in"); void addrEl.offsetWidth; addrEl.classList.add("in"); }
    addrEl.hidden = !addr;
    $("#addonLabel").textContent = servicesOnly ? "Choose the packages and services you'd like (at least one)" : "Packages and services you're interested in (optional)";
    renderSessions();
    const d = readForm();
    // a fully booked hall/date can't be submitted
    const full = fullyBooked(d);
    $("#fullWarn").hidden = !full;
    if (full) $("#fullWarn").textContent = `${vLabel(d.venue)} is fully booked on ${fmtDate(d.date)}. Please choose another date${servicesOnly ? "" : " or hall"}.`;
    $("#dateInput").toggleAttribute("aria-invalid", !!full);
    $$('#bookForm button[type="submit"], button[type="submit"][form="bookForm"]').forEach((b) => (b.disabled = !!full));
    const set = (k, v) => ($(`[data-s="${k}"]`).textContent = v || "—");
    set("kind", servicesOnly ? "Packages at your venue" : d.venue ? "Hall" : "");
    set("hall", servicesOnly ? `${otherVenue.name}${d.event_location ? " · " + d.event_location : ""}` : d.venue ? `${d.venue.name}${d.venue.venue_address ? " · " + d.venue.venue_address : ""}` : "");
    set("date", d.date ? fmtDate(d.date) : "");
    set("session", d.session);
    set("type", d.event_type);
    set("guests", d.guests);
    set("addons", d.add_ons.length ? d.add_ons.length + " selected" : "");
    const cap = $("#capHint");
    if (d.venue?.capacity && d.guests && +d.guests > d.venue.capacity) {
      cap.textContent = `${d.venue.name} fits up to ${d.venue.capacity} guests. Consider a larger hall, or tell us in the notes.`;
      cap.className = "hint warn";
    } else cap.textContent = "";
  }
  $("#bookForm").addEventListener("change", () => { $("#formError").style.display = "none"; update(); });
  $("#bookForm").addEventListener("input", (e) => { if (e.target.name === "guests" || e.target.name === "event_location") update(); });

  function buildMessage(d, ref) {
    const sess = C.sessions.find((s) => s.id === d.session);
    return [
      `Hi Polybelle! I'd like to book an event 🎉`,
      ``,
      `*Booking Ref:* ${ref}`,
      d.booking_type === "Services" ? `*Venue:* ${otherVenue.name} (packages & services)` : `*Hall:* ${d.venue.name}`,
      d.booking_type === "Hall" && d.venue.venue_address ? `*Hall address:* ${d.venue.venue_address}` : null,
      d.booking_type === "Services" ? `*Event location:* ${d.event_location || "To be confirmed"}` : null,
      `*Date:* ${fmtDate(d.date)}`,
      `*Session:* ${d.session}${sess ? ` (${sess.time})` : ""}`,
      `*Occasion:* ${d.event_type}`,
      d.guests ? `*Guests:* ${d.guests}` : null,
      d.add_ons.length ? `*Packages & services:* ${d.add_ons.join(", ")}` : null,
      d.promo_code ? `*Promo code:* ${d.promo_code}` : null,
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
    if (!d.venue) return showError(`Please choose a hall, or “${otherVenue.name}” for your own location.`);
    if (servicesOnly && !d.add_ons.length) return showError("Please choose at least one package or service.");
    if (!d.date) return showError("Please choose your event date.");
    if (d.date < todayDubai()) return showError("Please choose a future date.");
    if (fullyBooked(d)) { update(); $("#fullWarn").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (!d.session) return showError("Please choose a session.");
    if (sessionTaken(d.venue, d.date, d.session)) return showError(servicesOnly
      ? `Our team is already booked for the ${d.session.toLowerCase()} session on ${fmtDate(d.date)}. Please choose another session or date.`
      : `The ${d.session.toLowerCase()} session at ${d.venue.name} is already booked on ${fmtDate(d.date)}. Please choose another session, date or hall.`);
    if (!d.event_type) return showError("Please choose the occasion.");
    if (!d.name) return showError("Please enter your name.");
    if (d.phone.replace(/\D/g, "").length < 7) return showError("Please enter a valid mobile number.");

    const btn = e.submitter || $("#formWhatsappChoices button");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    // open the WhatsApp tab now (inside the click) so popup blockers allow it
    const waWin = window.open("", "_blank");

    let ref;
    try {
      if (!sb || (!servicesOnly && !d.venue.id)) throw new Error("offline");
      const bookingPayload = {
        booking_type: d.booking_type, event_location: d.event_location,
        venue_id: servicesOnly ? null : d.venue.id, date: d.date, session: d.session, event_type: d.event_type,
        guests: d.guests || null, add_ons: d.add_ons, name: d.name, phone: d.phone, email: d.email, notes: d.notes
      };
      const { data, error } = d.promo_code
        ? await sb.rpc("pb_request_booking_with_promo", { p: bookingPayload, p_promo_code: d.promo_code })
        : await sb.rpc("pb_request_booking", { p: bookingPayload });
      if (error) throw error;
      ref = data;
    } catch (err) {
      const msg = err?.message || "";
      if (d.promo_code && (!msg || msg === "offline" || /fetch|network/i.test(msg))) {
        if (waWin) waWin.close();
        btn.disabled = false; btn.textContent = originalLabel;
        return showError("We couldn't verify your promo code. Please try again, or remove the code to submit without a discount.");
      }
      if (msg && msg !== "offline" && !/fetch|network/i.test(msg)) {
        if (waWin) waWin.close();
        btn.disabled = false; btn.textContent = originalLabel;
        await loadBooked(); renderSessions();
        return showError(msg);
      }
      ref = "PB-WEB-" + Date.now().toString(36).toUpperCase().slice(-5); // still let them reach us
    }

    const url = waLink(btn.dataset.waNumber || state.whatsapp, buildMessage(d, ref));
    if (waWin) waWin.location.href = url;
    $("#doneRef").textContent = ref;
    $("#doneWa").href = url;
    $("#doneModal").classList.add("open");
    btn.disabled = false; btn.textContent = originalLabel;
    $("#bookForm").reset();
    closeSvcDetail();
    $$("#addonPick .svc-check").forEach((b) => b.setAttribute("aria-pressed", "false"));
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
        <img src="${esc(g.image_url)}" alt="${esc([g.caption, g.category && g.category !== g.caption ? g.category : "", "Polybelle, Abu Dhabi"].filter(Boolean).join(" · "))}" loading="lazy" onerror="this.style.visibility='hidden'">
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

  // ---------- availability window per hall (expands inside the Halls section; confirmed bookings only)
  const isoDay = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const CAL = { hall: null, open: false, y: +todayDubai().slice(0, 4), m: +todayDubai().slice(5, 7) - 1, sel: null };
  const SESS_ORDER = ["Morning", "Afternoon", "Evening", "Whole day"];
  // Other venues: sessions our team already has confirmed at customers' own locations (bookings with no hall)
  // Halls that share space (e.g. "Hall A&B" and "Hall B") block each other: a booking in one takes that session in both
  function linkedIds(venueId) {
    const v = state.venues.find((x) => x.id === venueId);
    return new Set([venueId, ...(v?.shares_with || []), ...state.venues.filter((x) => (x.shares_with || []).includes(venueId)).map((x) => x.id)]);
  }
  function takenFor(venueId, date) {
    if (!venueId) return [];
    const ids = venueId === OTHER ? null : linkedIds(venueId);
    return state.booked.filter((b) => (ids ? ids.has(b.venue_id) : !b.venue_id) && b.event_date === date).map((b) => b.session);
  }
  function dayState(taken) {
    if (taken.includes("Whole day") || ["Morning", "Afternoon", "Evening"].every((x) => taken.includes(x))) return "full";
    return taken.length ? "part" : "free";
  }
  const availPanel = document.createElement("div");
  availPanel.className = "avail-panel"; availPanel.id = "availPanel"; availPanel.setAttribute("role", "region");
  availPanel.innerHTML = `
    <button type="button" class="sd-x" aria-label="Close availability">×</button>
    <div class="cal-box">
      <div class="cal-head">
        <button type="button" class="cal-nav" data-cal="prev" aria-label="Previous month">‹</button>
        <div class="cal-title"><span class="sd-kind" data-cal="hall"></span><h3 data-cal="title" aria-live="polite"></h3></div>
        <button type="button" class="cal-nav" data-cal="next" aria-label="Next month">›</button>
      </div>
      <div class="cal-week" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      <div class="cal-grid" data-cal="grid"></div>
      <div class="cal-legend"><span><i class="lg-free"></i>Available</span><span><i class="lg-part"></i>Some sessions booked</span><span><i class="lg-full"></i>Fully booked</span></div>
    </div>
    <div class="cal-day" data-cal="day" aria-live="polite"></div>`;
  const calEl = (k) => availPanel.querySelector(`[data-cal="${k}"]`);
  availPanel.querySelector(".sd-x").addEventListener("click", () => closeAvail(true));
  calEl("prev").addEventListener("click", () => { CAL.m--; if (CAL.m < 0) { CAL.m = 11; CAL.y--; } renderCal(); });
  calEl("next").addEventListener("click", () => { CAL.m++; if (CAL.m > 11) { CAL.m = 0; CAL.y++; } renderCal(); });

  function placeAvail() {
    const grid = $("#venueGrid"), card = $(`#venueGrid .venue [data-avail="${CSS.escape(CAL.hall)}"]`)?.closest(".venue");
    availPanel.remove();
    if (!card) return false;
    const sideways = getComputedStyle(grid).overflowX !== "visible";       // phones: halls are a swipe row
    if (sideways) { grid.after(availPanel); availPanel.style.removeProperty("--arrow-x"); return true; }
    const row = $$("#venueGrid .venue").filter((c) => c.offsetTop === card.offsetTop);
    (row[row.length - 1] || card).after(availPanel);
    availPanel.style.setProperty("--arrow-x", `${card.offsetLeft - grid.offsetLeft + card.offsetWidth / 2}px`);
    return true;
  }
  function openAvail(key, quiet) {
    const t = todayDubai();
    if (CAL.hall !== key) { CAL.sel = null; CAL.sess = null; CAL.y = +t.slice(0, 4); CAL.m = +t.slice(5, 7) - 1; }
    CAL.hall = key; CAL.open = true;
    if (!placeAvail()) { CAL.open = false; return; }
    $$("[data-avail]").forEach((b) => b.setAttribute("aria-expanded", b.dataset.avail === key));
    renderCal();
    if (!quiet) {
      availPanel.classList.remove("in"); void availPanel.offsetWidth; availPanel.classList.add("in");
      const r = availPanel.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight) availPanel.scrollIntoView({ behavior: "smooth", block: r.height < window.innerHeight - 90 ? "nearest" : "start" });
    }
  }
  function closeAvail(focusBack) {
    const key = CAL.hall;
    CAL.open = false; availPanel.remove();
    $$("[data-avail]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (focusBack) $(`[data-avail="${CSS.escape(key || "")}"]`)?.focus();
  }
  let availResize;
  window.addEventListener("resize", () => { clearTimeout(availResize); availResize = setTimeout(() => { if (CAL.open) placeAvail(); }, 150); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && CAL.open) closeAvail(true); });

  function renderCal() {
    if (!CAL.open) return;
    const hall = allVenues().find((v) => (v.id || v.name) === CAL.hall);
    if (!hall) return closeAvail();
    availPanel.setAttribute("aria-label", `${hall.name} availability`);
    calEl("hall").textContent = `${hall.name} · availability`;
    const today = todayDubai(), t = new Date(today + "T00:00:00Z");
    const max = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 730)).toISOString().slice(0, 10);
    calEl("title").textContent = new Date(Date.UTC(CAL.y, CAL.m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    calEl("prev").disabled = CAL.y * 12 + CAL.m <= t.getUTCFullYear() * 12 + t.getUTCMonth();
    calEl("next").disabled = isoDay(CAL.y, CAL.m + 1, 1) > max;
    const lead = (new Date(Date.UTC(CAL.y, CAL.m, 1)).getUTCDay() + 6) % 7;     // Monday first
    const days = new Date(Date.UTC(CAL.y, CAL.m + 1, 0)).getUTCDate();
    let html = '<span class="cal-blank"></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const iso = isoDay(CAL.y, CAL.m, d), past = iso < today || iso > max;
      const st = past ? "" : dayState(takenFor(hall.id, iso));
      const label = new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
      html += `<button type="button" class="cal-d ${st} ${iso === today ? "today" : ""} ${iso === CAL.sel ? "sel" : ""}" data-d="${iso}" ${past ? "disabled" : ""}
        aria-label="${label}: ${past ? "not available" : { free: "available", part: "some sessions booked", full: "fully booked" }[st]}" aria-pressed="${iso === CAL.sel}">${d}</button>`;
    }
    const grid = calEl("grid"); grid.innerHTML = html;
    grid.style.animation = "none"; void grid.offsetWidth; grid.style.animation = "";
    grid.querySelectorAll(".cal-d:not(:disabled)").forEach((b) => b.addEventListener("click", () => { if (CAL.sel !== b.dataset.d) CAL.sess = null; CAL.sel = b.dataset.d; renderCal(); }));
    renderCalDay(hall);
  }
  function renderCalDay(hall) {
    const box = calEl("day");
    if (!CAL.sel) {
      box.innerHTML = `<span class="sd-kind">${esc(hall.name)} · ${hall.other ? esc(hall.tagline || "at your location") : `up to ${hall.capacity} guests`}</span><p class="cal-day-empty">${hall.other ? "Tap a date to see when our team is free to come to you." : "Tap a date to see which sessions are free."}</p>
        <p class="hint">Dates show confirmed bookings. Pending requests are confirmed by our team on WhatsApp.</p>`;
      return;
    }
    const taken = takenFor(hall.id, CAL.sel), st = dayState(taken);
    const nice = new Date(CAL.sel + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const booked = (s) => taken.includes(s) || taken.includes("Whole day") || (s === "Whole day" && taken.length > 0);
    if (CAL.sess && booked(CAL.sess)) CAL.sess = null;
    box.innerHTML = `
      <span class="sd-kind">${esc(hall.name)} · ${hall.other ? esc(hall.tagline || "at your location") : `up to ${hall.capacity} guests`}</span>
      <h4>${esc(nice)}</h4>
      ${st === "full" ? "" : `<p class="hint">Tap a free session to choose it.</p>`}
      <div class="cal-sess" role="radiogroup" aria-label="Session">${C.sessions.slice().sort((a, b) => SESS_ORDER.indexOf(a.id) - SESS_ORDER.indexOf(b.id)).map((x) => booked(x.id)
        ? `<div class="cal-s booked"><span>${esc(x.id)}<small>${esc(x.time)}</small></span><span class="st st-booked">Booked 🔒</span></div>`
        : `<button type="button" class="cal-s ${CAL.sess === x.id ? "on" : ""}" role="radio" aria-checked="${CAL.sess === x.id}" data-sess="${esc(x.id)}"><span>${esc(x.id)}<small>${esc(x.time)}</small></span><span class="st st-free">${CAL.sess === x.id ? "Selected" : "Available ✅"}</span></button>`).join("")}</div>
      ${st === "full" ? `<p class="hint warn">${esc(vLabel(hall))} is fully booked on this date. Please try another date${hall.other ? "" : " or hall"}.</p>`
        : `<button type="button" class="btn btn-dark" data-cal="book">${CAL.sess ? `Book ${esc(CAL.sess.toLowerCase())}` : "Book this date"}</button>`}`;
    box.querySelectorAll("[data-sess]").forEach((b) => b.addEventListener("click", () => { CAL.sess = CAL.sess === b.dataset.sess ? null : b.dataset.sess; renderCalDay(hall); }));
    calEl("book")?.addEventListener("click", () => {
      const r = document.querySelector(`#hallPick input[value="${CSS.escape(hall.id || hall.name)}"]`);
      if (r) r.checked = true;
      $("#dateInput").value = CAL.sel;
      update();                                   // re-renders the session choices for this hall/date
      if (CAL.sess) {
        const s = document.querySelector(`#sessionPick input[value="${CSS.escape(CAL.sess)}"]:not(:disabled)`);
        if (s) { s.checked = true; update(); }
      }
      $("#book").scrollIntoView({ behavior: "smooth" });
      if (hall.other) setTimeout(() => $("#locInput").focus({ preventScroll: true }), 600);
    });
  }

  // ---------- data
  async function loadBooked() {
    if (!sb) return;
    const { data } = await sb.rpc("pb_booked_slots");
    if (data) { state.booked = data; renderCal(); }
  }

  async function loadPublicPromos() {
    const container = $("#promoOffers");
    if (!sb) {
      container.innerHTML = `<p class="hint">Current offers could not be loaded. Please ask our team about available promotions.</p>`;
      return;
    }
    const { data, error } = await sb.rpc("pb_public_promos");
    if (error) {
      console.error("Couldn't load current promotions:", error.message);
      container.innerHTML = `<p class="hint">Current offers could not be loaded. Please ask our team about available promotions.</p>`;
      return;
    }
    container.innerHTML = data?.length ? data.map((promo) =>
      `<div class="promo-offer"><p><strong>${promo.discount_type === "fixed" ? `AED ${esc(promo.discount_value)} off` : `${esc(promo.discount_value)}% off`} ${esc(promo.required_item)}</strong> with promo code</p><code>${esc(promo.code)}</code></div>`
    ).join("") : `<p class="hint">No active promo offers right now.</p>`;
  }

  async function init() {
    state.venues = DEFAULT_VENUES;
    renderVenues(); renderContact(); update();
    if (!sb) return;
    loadPublicPromos();
    sb.from("pb_gallery").select("image_url,caption,category").eq("active", true).order("sort_order").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) { G.items = data; renderGallery(); } });
    sb.from("pb_reviews").select("name,event_type,rating,comment,source,featured,created_at").eq("status", "Approved")
      .order("featured", { ascending: false }).order("created_at", { ascending: false }).limit(60)
      .then(({ data }) => { R.items = data || []; renderReviews(); });
    sb.from("pb_services").select("name,kind,category,description,image_url,image_pos,inclusions").eq("active", true).order("sort_order").order("name")
      .then(({ data }) => { if (data?.length) { services = data; renderServices(); update(); } });
    const [venues, settings, otherVenueSettings] = await Promise.all([
      sb.from("pb_venues").select("id,name,tagline,description,venue_address,capacity,branch,google_maps_url,image_url,image_pos,price_from,sort_order,shares_with").eq("active", true).order("sort_order").order("name"),
      sb.rpc("pb_public_settings"),
      sb.rpc("pb_public_other_venue"),
      loadBooked()
    ]);
    if (otherVenueSettings.error) console.error("Couldn't load Other venues settings:", otherVenueSettings.error.message);
    if (otherVenueSettings.data) {
      OV = { ...OV, ...otherVenueSettings.data };
      otherVenue = makeOtherVenue();
      renderVenues();
    }
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
    io = io || new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.01, rootMargin: "0px 0px 8% 0px" });
    $$(sel).forEach((el) => io.observe(el));
  }

  init();
  observe();
})();

/* Bready site stats: records page views and time on page. ~1 KB, no cookies. */
(function () {
  var URL = "https://ntohdxudxfggsmhxhvho.supabase.co/rest/v1/rpc/";
  var KEY = "sb_publishable_81P5_TSD4SuHALFDM4Ao-w_W7C5UkuI";
  if (navigator.webdriver || /bot|crawl|spider/i.test(navigator.userAgent)) return;
  if (location.hostname === "localhost" || location.protocol === "file:") return;
  function id() { return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var visitor = store("bss_v") || id(); store("bss_v", visitor);
  var now = Date.now(), last = +store("bss_t") || 0, session = store("bss_s");
  if (!session || now - last > 30 * 60 * 1000) session = id();
  store("bss_s", session); store("bss_t", String(now));
  function call(fn, body, keep) {
    return fetch(URL + fn, { method: "POST", keepalive: !!keep,
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body) });
  }
  var viewId = null, active = 0, since = document.visibilityState === "visible" ? Date.now() : 0;
  function elapsed() { return active + (since ? Date.now() - since : 0); }
  function send() { if (viewId) { store("bss_t", String(Date.now())); call("track_page_time", { p_id: viewId, p_ms: Math.round(elapsed()) }, true).catch(function () {}); } }
  call("track_page_view", { p_site: location.hostname, p_path: location.pathname, p_referrer: document.referrer || null,
    p_visitor: visitor, p_session: session, p_ua: navigator.userAgent })
    .then(function (r) { return r.json(); }).then(function (v) { viewId = v; }).catch(function () {});
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { if (since) { active += Date.now() - since; since = 0; } send(); }
    else since = Date.now();
  });
  addEventListener("pagehide", send);
  setInterval(function () { if (since) send(); }, 15000);
})();

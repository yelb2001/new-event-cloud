/*
 * New Event — Web Analytics
 *
 * Captures four analytics and sends them to the collector service, which
 * inserts them into ClickHouse.
 *
 *   1. cta_click        — clicks on Register Now / Learn More (intent to convert)
 *   2. section_view     — which sections the visitor actually scrolls into
 *   3. form_interaction — registration form: field focused vs form submitted
 *                         (lets us measure abandonment)
 *   4. session_engagement — how long the visitor stayed engaged before leaving
 *
 * Each event carries a session_id so we can follow one visitor's journey.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------
  // CONFIG — replace with your analytics-collector EXTERNAL-IP
  // ---------------------------------------------------------------
  var COLLECTOR_URL = "http://136.64.57.104/collect";

  // ---------------------------------------------------------------
  // Session id: a random id kept for this browser tab, so all events
  // from one visit can be grouped together.
  // ---------------------------------------------------------------
  var sessionId = "s-" + Math.random().toString(36).slice(2) + "-" + Date.now();
  var sessionStart = Date.now();
  var lastActivity = Date.now();

  // Send one analytics event to the collector.
  function send(eventType, element, value) {
    var payload = {
      event_type: eventType,
      page: window.location.pathname || "/",
      element: element || "",
      session_id: sessionId,
      value: value === undefined ? "" : String(value)
    };
    // keepalive lets the request finish even if the page is closing
    fetch(COLLECTOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {
      /* analytics must never break the page — ignore failures */
    });
  }

  // Track any interaction so we know when the visitor was last active.
  ["click", "scroll", "keydown"].forEach(function (evt) {
    window.addEventListener(evt, function () { lastActivity = Date.now(); }, { passive: true });
  });

  // ---------------------------------------------------------------
  // 1. CTA CLICKS — the conversion funnel
  //    Which call-to-action buttons do visitors press?
  // ---------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var el = e.target.closest("a, button");
    if (!el) return;

    var text = (el.textContent || "").trim().toLowerCase();
    var href = (el.getAttribute("href") || "").toLowerCase();

    if (text.indexOf("register") !== -1 || href.indexOf("register") !== -1) {
      send("cta_click", "register_now", text);
    } else if (text.indexOf("learn more") !== -1) {
      send("cta_click", "learn_more", text);
    }
  });

  // ---------------------------------------------------------------
  // 2. SECTION ENGAGEMENT DEPTH — how far down the funnel they get
  //    Fires once per section, the first time it becomes visible.
  // ---------------------------------------------------------------
  var seenSections = {};
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id || entry.target.getAttribute("name") || "unnamed";
        if (seenSections[id]) return;       // only record the first view
        seenSections[id] = true;
        send("section_view", id, "");
      });
    }, { threshold: 0.4 });                 // 40% of the section must be visible

    document.querySelectorAll("section, div[id]").forEach(function (section) {
      if (section.id) observer.observe(section);
    });
  }

  // ---------------------------------------------------------------
  // 3. REGISTRATION FORM ABANDONMENT
  //    form_start  = the visitor focused a field (they began signing up)
  //    form_submit = they actually submitted
  //    Abandonment = form_start sessions that never produced a form_submit.
  // ---------------------------------------------------------------
  var formStarted = false;
  document.addEventListener("focusin", function (e) {
    var field = e.target;
    if (!field.matches("input, textarea, select")) return;
    if (!formStarted) {
      formStarted = true;
      send("form_interaction", "form_start", "");
    }
    send("form_interaction", "field_focus", field.name || field.id || field.type);
  });

  document.addEventListener("submit", function () {
    send("form_interaction", "form_submit", "");
  });

  // ---------------------------------------------------------------
  // 4. SESSION ENGAGEMENT TIME
  //    Sent once, when the visitor leaves. Measures seconds of engagement,
  //    which separates real interest from a quick bounce.
  // ---------------------------------------------------------------
  var engagementSent = false;
  function sendEngagement() {
    if (engagementSent) return;
    engagementSent = true;
    var seconds = Math.round((lastActivity - sessionStart) / 1000);
    send("session_engagement", "duration_seconds", seconds);
  }
  window.addEventListener("pagehide", sendEngagement);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") sendEngagement();
  });

  // ---------------------------------------------------------------
  // Baseline page view, sent as soon as the script loads.
  // ---------------------------------------------------------------
  send("page_view", "landing", document.title || "");
})();
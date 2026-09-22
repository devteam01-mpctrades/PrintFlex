/* ==========================================================================
   PrintFlex marketing site — shared script
   Vanilla JS, no dependencies. Everything here is an enhancement: the page
   reads fine with JS disabled. Wrapped in an IIFE so nothing leaks globally.
   ========================================================================== */
(function () {
  "use strict";

  // Lets the stylesheet apply JS-only behaviour (reveal, stacked panels)
  // without hiding anything when scripts are off.
  document.documentElement.classList.add("js");

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ------------------------------------------------------------------------
     Seeded PRNG
     FNV-1a hashes the order number into a 32-bit seed, xorshift32 turns it
     into a stream. Same string in, same graphic out — across reloads and
     across the two QR codes on the page.
     ------------------------------------------------------------------------ */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seedStr) {
    var s = fnv1a(seedStr) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------------------
     Barcode
     DECORATIVE ONLY. This draws ~62 bars with widths 1–3px from the seeded
     PRNG so it *looks* like Code 128 at a glance. It is not a valid Code 128
     symbol and will not scan — the real app renders real symbols server-side.
     The element is aria-hidden; the mono caption carries the order number.
     ------------------------------------------------------------------------ */
  function renderBarcode(el) {
    var code = el.getAttribute("data-code") || "";
    var rng = makeRng("bars:" + code);
    var frag = document.createDocumentFragment();
    var count = 62;
    for (var i = 0; i < count; i++) {
      var bar = document.createElement("i");
      var w = 1 + Math.floor(rng() * 3);
      bar.style.width = w + "px";
      if (i % 2 === 0) bar.className = "on";
      frag.appendChild(bar);
    }
    el.textContent = "";
    el.appendChild(frag);
    el.setAttribute("aria-hidden", "true");
  }

  /* ------------------------------------------------------------------------
     QR
     21×21 grid (Version 1 size), ~48% random fill outside the three 8×8
     finder zones, then the three real finder patterns drawn on top. Also
     decorative — not a decodable QR. Colours are read from the CSS tokens so
     the graphic repaints correctly when the colour scheme flips.
     ------------------------------------------------------------------------ */
  var SVG_NS = "http://www.w3.org/2000/svg";

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function inFinderZone(x, y, n) {
    return (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  }

  function renderQr(el) {
    var code = el.getAttribute("data-code") || "";
    var n = 21;
    var rng = makeRng("qr:" + code);
    var inkVar = el.getAttribute("data-ink") || "--ink";
    var paperVar = el.getAttribute("data-paper") || "--surface";
    var ink = inkVar === "transparent" ? "transparent" : cssVar(inkVar) || "#000";
    var paper = paperVar === "transparent" ? "transparent" : cssVar(paperVar) || "#fff";

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + n + " " + n);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", el.getAttribute("data-label") || ("QR code for order " + code));

    if (paper !== "transparent") {
      var bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("width", n);
      bg.setAttribute("height", n);
      bg.setAttribute("fill", paper);
      svg.appendChild(bg);
    }

    // One path for all dark modules keeps the DOM small.
    var d = "";
    function cell(x, y) { d += "M" + x + " " + y + "h1v1h-1z"; }

    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (inFinderZone(x, y, n)) continue;
        if (rng() < 0.48) cell(x, y);
      }
    }

    // Timing patterns (row/col 6) give it the characteristic dotted lines.
    for (var t = 8; t < n - 8; t++) {
      if (t % 2 === 0) { cell(t, 6); cell(6, t); }
    }

    function finder(ox, oy) {
      for (var yy = 0; yy < 7; yy++) {
        for (var xx = 0; xx < 7; xx++) {
          var ring = xx === 0 || yy === 0 || xx === 6 || yy === 6;
          var core = xx >= 2 && xx <= 4 && yy >= 2 && yy <= 4;
          if (ring || core) cell(ox + xx, oy + yy);
        }
      }
    }
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);

    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", ink);
    svg.appendChild(path);

    el.textContent = "";
    el.appendChild(svg);
  }

  function renderGraphics() {
    var bars = document.querySelectorAll(".bars[data-code]");
    for (var i = 0; i < bars.length; i++) renderBarcode(bars[i]);
    var qrs = document.querySelectorAll(".qr[data-code]");
    for (var j = 0; j < qrs.length; j++) renderQr(qrs[j]);
  }

  /* ------------------------------------------------------------------------
     Pricing toggle — swaps data-m / data-a values into price and period
     spans, keeps aria-pressed in sync on the two buttons.
     ------------------------------------------------------------------------ */
  function initPricing() {
    var toggle = document.querySelector("[data-pricing-toggle]");
    if (!toggle) return;
    var buttons = toggle.querySelectorAll("button[data-period]");
    var swaps = document.querySelectorAll("[data-m][data-a]");

    function apply(period) {
      var attr = period === "a" ? "data-a" : "data-m";
      for (var i = 0; i < swaps.length; i++) {
        swaps[i].textContent = swaps[i].getAttribute(attr);
      }
      for (var b = 0; b < buttons.length; b++) {
        var on = buttons[b].getAttribute("data-period") === period;
        buttons[b].setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function (e) {
        apply(e.currentTarget.getAttribute("data-period"));
      });
    }
    apply("m");
  }

  /* ------------------------------------------------------------------------
     FAQ filter chips — toggles the `hidden` property on non-matching items.
     ------------------------------------------------------------------------ */
  function initFaq() {
    var filters = document.querySelector("[data-faq-filters]");
    var list = document.querySelector("[data-faq-list]");
    if (!filters || !list) return;
    var chips = filters.querySelectorAll("button[data-cat]");
    var items = list.querySelectorAll("details[data-cat]");
    var empty = document.querySelector("[data-faq-empty]");

    function apply(cat) {
      var shown = 0;
      for (var i = 0; i < items.length; i++) {
        var match = cat === "all" || items[i].getAttribute("data-cat") === cat;
        items[i].hidden = !match;
        if (match) shown++;
      }
      for (var c = 0; c < chips.length; c++) {
        chips[c].setAttribute("aria-pressed", chips[c].getAttribute("data-cat") === cat ? "true" : "false");
      }
      if (empty) empty.hidden = shown !== 0;
    }

    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener("click", function (e) {
        apply(e.currentTarget.getAttribute("data-cat"));
      });
    }
  }

  /* ------------------------------------------------------------------------
     Contact form -> /api/contact (same origin) -> emailed to team@mpctrades.com.
     The endpoint is the shared MPC Trades contact relay, proxied by nginx on
     this host, so there is no third-party form service and no CORS. It
     answers {ok:true} or {error:"<code>"}. If the request fails outright
     (offline, relay down) we fall back to the visitor's own mail client with
     the message pre-filled, so nothing anyone wrote is lost.
     ------------------------------------------------------------------------ */
  function initContact() {
    var form = document.querySelector("[data-contact-form]");
    if (!form) return;
    var status = form.querySelector("[data-form-status]");
    var submit = form.querySelector("[data-form-submit]");
    var endpoint = form.getAttribute("data-endpoint") || "/api/contact";
    var TO = "team@mpctrades.com";
    var busy = false;
    var ERRORS = {
      rate_limited: "You've sent a few messages already. Please give it an hour and try again.",
      invalid_fields: "Please check your name, email and message.",
      invalid_json: "Sorry, that didn't go through.",
      payload_too_large: "That message is too long to send. Try a shorter one.",
      send_failed: "Sorry, that didn't go through."
    };

    function val(name) {
      var f = form.elements[name];
      return f && typeof f.value === "string" ? f.value.trim() : "";
    }

    function setStatus(msg, ok) {
      if (!status) return;
      status.textContent = msg;
      status.classList.toggle("is-ok", ok === true);
      status.classList.toggle("is-error", ok === false);
    }

    function setBusy(on) {
      busy = on;
      if (!submit) return;
      submit.disabled = on;
      submit.setAttribute("aria-busy", on ? "true" : "false");
      submit.firstChild.textContent = on ? "Sending… " : "Send message ";
    }

    function collect() {
      var volume = val("volume");
      return {
        name: val("name"),
        email: val("email"),
        store: val("store"),
        topic: "Early access" + (volume ? " · " + volume + " orders/week" : ""),
        message: (volume ? "Orders per week: " + volume + "\n\n" : "") + "How we pack today:\n" + val("how"),
        company: val("company") // honeypot: must stay empty
      };
    }

    function mailtoFallback(data) {
      var subject = "PrintFlex early access" + (data.store ? " - " + data.store : "");
      var body = ["Name: " + data.name, "Email: " + data.email, "Store: " + (data.store || "-"), "", data.message].join("\n");
      window.location.href = "mailto:" + TO +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);
    }

    function succeeded(data) {
      form.reset();
      setStatus("Sent. Thanks" + (data.name ? ", " + data.name : "") + " — we'll reply to " + data.email + " within one business day.", true);
    }

    function refused(code) {
      // The relay looked at the message and said no: tell the visitor why,
      // keep their text in the form, and do not open the mail app.
      setStatus((ERRORS[code] || ERRORS.send_failed) + " You can also write to " + TO + " directly.", false);
    }

    function unreachable(data) {
      setStatus("We couldn't reach our server, so we're opening your email app with the message pre-filled. If nothing opens, email " + TO + " directly.", false);
      mailtoFallback(data);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

      var data = collect();
      if (!window.fetch) { unreachable(data); return; }

      setBusy(true);
      setStatus("");

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok && body && body.ok) succeeded(data);
          else if (body && body.error) refused(body.error);
          else if (res.status >= 500 || res.status === 404 || res.status === 502) unreachable(data);
          else refused("send_failed");
        });
      }).catch(function () {
        unreachable(data);
      }).then(function () {
        setBusy(false);
      });
    });
  }

  /* ------------------------------------------------------------------------
     How it works — five steps as vertical tabs, each with its own mock
     screen. Clicking a step swaps the panel and replays that panel's small
     scripted animation. Auto-advances until the visitor interacts.
     ------------------------------------------------------------------------ */
  function initHow() {
    var root = document.querySelector("[data-how]");
    if (!root) return;

    var steps = [].slice.call(root.querySelectorAll(".step"));
    var tabs = steps.map(function (s) { return s.querySelector(".step__btn"); });
    var panels = [].slice.call(root.querySelectorAll(".how-panel"));
    var panelsWrap = root.querySelector(".how-panels");
    var visual = root.querySelector(".how-visual");
    var mockWrap = root.querySelector(".app-mock-wrap");
    var timeline = root.querySelector(".timeline");
    var mobile = window.matchMedia("(max-width: 940px)");

    var current = 0;
    var autoTimer = null;
    var interacted = false;
    var inView = false;
    var paused = false;
    var pending = [];

    function clearPending() {
      pending.forEach(clearTimeout);
      pending = [];
    }

    function later(fn, ms) {
      pending.push(window.setTimeout(fn, reducedMotion.matches ? 0 : ms));
    }

    function addIn(nodes, gap, start) {
      [].forEach.call(nodes, function (n, i) {
        n.classList.remove("is-in");
        later(function () { n.classList.add("is-in"); }, (start || 0) + i * gap);
      });
    }

    // On narrow screens the panel sits directly under the active step.
    function place() {
      if (mobile.matches) {
        var slot = steps[current].querySelector(".step__slot");
        if (panelsWrap.parentNode !== slot) slot.appendChild(panelsWrap);
        visual.classList.add("is-empty");
      } else if (panelsWrap.parentNode !== mockWrap) {
        mockWrap.appendChild(panelsWrap);
        visual.classList.remove("is-empty");
      }
    }

    function drawRail() {
      var li = steps[current];
      var badge = li.querySelector(".step__badge");
      timeline.style.setProperty("--rail", (li.offsetTop + badge.offsetTop) + "px");
    }

    var animations = {
      print: function (panel) {
        var bar = panel.querySelector("[data-job-bar]");
        var prog = panel.querySelector("[data-job-progress]");
        var count = panel.querySelector("[data-job-count]");
        var state = panel.querySelector("[data-job-state]");
        var done = panel.querySelector("[data-job-done]");
        var lines = panel.querySelectorAll("[data-job-line]");
        var total = 34;

        bar.style.transition = "none";
        bar.style.width = "0%";
        prog.setAttribute("aria-valuenow", "0");
        count.textContent = "0 / " + total;
        state.textContent = "Rendering";
        state.className = "pill pill--accent";
        done.classList.remove("is-in");
        [].forEach.call(lines, function (l) { l.classList.remove("is-in"); });

        later(function () {
          bar.style.transition = "";
          bar.style.width = "100%";
        }, 60);

        var duration = 2200;
        for (var i = 1; i <= total; i++) {
          (function (n) {
            later(function () {
              count.textContent = n + " / " + total;
              prog.setAttribute("aria-valuenow", String(Math.round(n / total * 100)));
            }, 60 + duration * (n / total));
          })(i);
        }
        addIn(lines, 420, 200);
        later(function () {
          state.textContent = "Ready";
          state.className = "pill pill--good";
          done.classList.add("is-in");
        }, duration + 200);
      },

      pick: function (panel) {
        addIn(panel.querySelectorAll(".doc__table tbody tr"), 110, 120);
      },

      scan: function (panel) {
        var items = panel.querySelectorAll("[data-pack-item]");
        var btn = panel.querySelector("[data-pack-btn]");
        var left = items.length;
        [].forEach.call(items, function (li) {
          li.classList.remove("is-checked");
          li.querySelector("[data-pack-qty]").textContent = "0/1";
        });
        btn.textContent = left + " items left to check";
        btn.className = "mini-btn mini-btn--block";

        [].forEach.call(items, function (li, i) {
          later(function () {
            li.classList.add("is-checked");
            li.querySelector("[data-pack-qty]").textContent = "1/1";
            left -= 1;
            if (left > 0) {
              btn.textContent = left + (left === 1 ? " item" : " items") + " left to check";
            } else {
              btn.textContent = "Mark as packed";
              btn.className = "mini-btn mini-btn--block mini-btn--primary";
            }
          }, 700 + i * 450);
        });
      },

      sync: function (panel) {
        var pill = panel.querySelector("[data-sync-pill]");
        var tag = panel.querySelector("[data-sync-tag]");
        pill.classList.remove("is-in");
        tag.classList.remove("is-in");
        addIn(panel.querySelectorAll("[data-sync-line]"), 260, 150);
        later(function () { tag.classList.add("is-in"); }, 700);
        later(function () { pill.classList.add("is-in"); }, 1000);
      }
    };

    function activate(index, byUser) {
      if (byUser) {
        interacted = true;
        stopAuto();
      }
      current = index;
      steps.forEach(function (s, k) {
        s.classList.toggle("is-active", k === index);
        s.classList.toggle("is-done", k < index);
      });
      tabs.forEach(function (t, k) {
        t.setAttribute("aria-selected", k === index ? "true" : "false");
        t.tabIndex = k === index ? 0 : -1;
      });
      panels.forEach(function (p, k) {
        p.classList.toggle("is-active", k === index);
      });
      place();
      drawRail();
      clearPending();
      var kind = panels[index].getAttribute("data-panel");
      if (kind && animations[kind]) animations[kind](panels[index]);
    }

    function startAuto() {
      if (autoTimer || interacted || reducedMotion.matches) return;
      autoTimer = window.setInterval(function () {
        if (inView && !paused && !document.hidden && !mobile.matches) {
          activate((current + 1) % steps.length, false);
        }
      }, 6500);
    }

    function stopAuto() {
      if (autoTimer) window.clearInterval(autoTimer);
      autoTimer = null;
    }

    steps.forEach(function (li, k) {
      li.addEventListener("click", function (e) {
        if (e.target.closest("a")) return;
        if (k !== current) {
          activate(k, true);
        } else {
          interacted = true;
          stopAuto();
        }
        tabs[k].focus({ preventScroll: true });
      });
    });

    tabs.forEach(function (t, k) {
      t.addEventListener("keydown", function (e) {
        var n = null;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (k + 1) % tabs.length;
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (k - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = tabs.length - 1;
        if (n === null) return;
        e.preventDefault();
        activate(n, true);
        tabs[n].focus();
      });
    });

    root.addEventListener("mouseenter", function () { paused = true; });
    root.addEventListener("mouseleave", function () { paused = false; });
    root.addEventListener("focusin", function () { paused = true; });
    root.addEventListener("focusout", function () { paused = false; });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
      }, { threshold: 0.2 });
      io.observe(root);
    } else {
      inView = true;
    }

    function onResize() {
      place();
      drawRail();
    }
    window.addEventListener("resize", function () {
      window.requestAnimationFrame(onResize);
    });
    if (mobile.addEventListener) mobile.addEventListener("change", onResize);
    else if (mobile.addListener) mobile.addListener(onResize);

    activate(0, false);
    // fonts change the badge positions slightly once they land
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawRail);
    startAuto();
  }

  /* ------------------------------------------------------------------------
     Reveal on scroll — fades blocks in as they enter the viewport, with a
     small stagger between siblings. Purely decorative; skipped when the
     visitor prefers reduced motion or the browser lacks IntersectionObserver.
     ------------------------------------------------------------------------ */
  function initReveal() {
    if (!("IntersectionObserver" in window) || reducedMotion.matches) return;

    var selector = [
      ".hero__copy > *", ".hero__visual",
      ".section-head", ".card", ".pcard", ".tally", ".fixlabel", ".fix",
      ".step", ".app-mock-wrap",
      ".table-wrap", ".footnote",
      ".phone", ".steps-strip li", ".stat", ".disclaimer",
      ".toggle", ".plan", ".billing-note",
      ".faq-filters", ".faq",
      ".contact-left > *", ".form"
    ].join(", ");

    var els = [].slice.call(document.querySelectorAll(selector));
    els.forEach(function (el) {
      el.classList.add("reveal");
      var i = 0;
      var p = el.previousElementSibling;
      while (p) {
        if (p.classList.contains("reveal")) i++;
        p = p.previousElementSibling;
      }
      el.style.setProperty("--i", String(Math.min(i, 7)));
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        io.unobserve(el);
        el.classList.add("is-visible");
        // Drop the helper classes afterwards so hover transforms work again.
        var delay = 700 + parseInt(el.style.getPropertyValue("--i") || "0", 10) * 70;
        window.setTimeout(function () {
          el.classList.remove("reveal", "is-visible");
          el.style.removeProperty("--i");
        }, delay);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

    els.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------------------
     Nav scroll-spy — highlights the link for the section under the middle
     of the viewport.
     ------------------------------------------------------------------------ */
  function initScrollSpy() {
    var links = [].slice.call(document.querySelectorAll(".nav__links a[href*='#']"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var map = {};
    var sections = [];
    links.forEach(function (a) {
      var id = a.getAttribute("href").split("#")[1];
      var sec = id && document.getElementById(id);
      if (sec) {
        map[id] = a;
        sections.push(sec);
      }
    });
    if (!sections.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove("is-active"); });
        var a = map[entry.target.id];
        if (a) a.classList.add("is-active");
      });
    }, { rootMargin: "-35% 0px -55% 0px", threshold: 0 });

    sections.forEach(function (s) { io.observe(s); });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  function init() {
    renderGraphics();
    initPricing();
    initFaq();
    initContact();
    initHow();
    initReveal();
    initScrollSpy();

    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", renderGraphics);
    } else if (mq && mq.addListener) {
      mq.addListener(renderGraphics);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

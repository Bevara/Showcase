/* Measures the visiting browser, card by card.
 *
 * There is no way to ask a browser whether an extension is installed, and
 * nothing here tries. The page only looks at its own elements: the extension
 * stamps every element it takes over with data-bevara-id, so a card is
 * credited to Bevara when that attribute appears, to the browser when the
 * media decodes without it, and to neither when it fails. Everything is plain
 * observation of the DOM; this page carries no decoder.
 *
 * Media are loaded as they scroll into view: 61 files at once would be a
 * heavy page, and would set 61 WebAssembly pipelines competing for the CPU.
 */
(function () {
  "use strict";

  const cards = Array.from(document.querySelectorAll(".card"));
  const nNative = document.getElementById("n-native");
  const nBevara = document.getElementById("n-bevara");
  const nOut = document.getElementById("n-out");
  const verdict = document.getElementById("verdict");

  const state = new Map();            /* card -> "native" | "bevara" | "out" */
  const settled = new WeakSet();

  function media(card) { return card.querySelector("img, audio, video"); }

  /* A container the browser parses is not a track it can decode: it reads an
   * Ogg's metadata, plays the Vorbis and leaves Theora at videoWidth 0. */
  function decoded(el) {
    if (el instanceof HTMLImageElement) return el.naturalWidth > 0;
    if (el instanceof HTMLVideoElement) return el.videoWidth > 0;
    return el.readyState >= HTMLMediaElement.HAVE_METADATA && !el.error;
  }

  let settle = function (card, how) {
    if (settled.has(card)) return;
    settled.add(card);
    state.set(card, how);
    card.classList.add(how);
    card.querySelector(".badge").textContent =
      how === "native" ? "your browser" : how === "bevara" ? "Bevara" : "not available";
    render();
  };

  function render() {
    let n = 0, b = 0, o = 0;
    for (const v of state.values()) { if (v === "native") n++; else if (v === "bevara") b++; else o++; }
    nNative.textContent = n; nBevara.textContent = b; nOut.textContent = o;
    if (b > 0) {
      verdict.className = "verdict on";
      verdict.innerHTML = "<strong>The extension is working on this page.</strong> "
        + b + " format" + (b === 1 ? "" : "s") + " your browser cannot read " + (b === 1 ? "is" : "are")
        + " being decoded for it.";
    } else if (n + o > 0) {
      verdict.className = "verdict";
      verdict.textContent = "No extension detected so far — " + o
        + " of the " + (n + o) + " cards measured did not render. Install it above and reload.";
    }
  }

  /* The extension stamps the element; it may do so before or after the
   * browser gives its own verdict, so watch for both. */
  function watch(card) {
    const el = media(card);
    if (!el) return;

    const check = () => {
      if (settled.has(card)) return true;
      if (el.hasAttribute("data-bevara-id") || el.getAttribute("srcset")) { settle(card, "bevara"); return true; }
      return false;
    };

    new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ["data-bevara-id", "srcset"] });

    const verdictLater = () => {
      if (check()) return;
      /* give the extension a moment: it decodes in a worker */
      setTimeout(() => { if (!check()) settle(card, decoded(el) ? "native" : "out"); }, 9000);
    };

    if (el instanceof HTMLImageElement) {
      if (el.complete) verdictLater();
      else { el.addEventListener("load", () => settle(card, "native"), { once: true });
             el.addEventListener("error", verdictLater, { once: true }); }
    } else {
      el.addEventListener("loadedmetadata", () => { if (!check()) settle(card, decoded(el) ? "native" : "out"); }, { once: true });
      el.addEventListener("error", verdictLater, { once: true });
      /* preload="none" means nothing happens until asked */
      el.preload = "metadata";
      el.load();
    }
  }

  /* Measured in order, a few at a time.
   *
   * Not on scroll: an IntersectionObserver reports nothing while the tab is
   * hidden or the viewport has no height, which left cards undecided. A queue
   * is deterministic, and it still does the pacing that matters - 61 files at
   * once would set as many WebAssembly pipelines competing for the CPU, and
   * the ones that lose get cut short. */
  const QUEUE_WIDTH = 3;
  let next = 0;

  function pump() {
    while (next < cards.length && inFlight() < QUEUE_WIDTH) start(cards[next++]);
  }

  function inFlight() {
    let n = 0;
    for (const c of cards) if (c.dataset.started && !settled.has(c)) n++;
    return n;
  }

  function start(card) {
    card.dataset.started = "1";
    const el = media(card);
    if (!el) { settle(card, "out"); return; }
    if (el.dataset.src) { el.src = el.dataset.src; delete el.dataset.src; }
    watch(card);
  }

  /* keep the queue moving as each card lands, and however it lands */
  const origSettle = settle;
  settle = function (card, how) { origSettle(card, how); setTimeout(pump, 0); };

  pump();

  /* third argument, shown live rather than asserted */
  fetch("https://registry.bevara.ddns.net/accessors/index.json")
    .then(r => r.json())
    .then(d => {
      const when = new Date(d.generated).toLocaleString();
      document.getElementById("registry-live").innerHTML =
        "<strong>" + d.filters.length + " accessors</strong>, " + d.runtimes.length + " runtimes and "
        + d.tags.length + " tag scripts published on <code>" + new URL(d.registry).host + "</code>"
        + " — catalogue read " + when + ". Publish one more and it is readable here on the next page load,"
        + " with no new version of the extension and no browser release.";
    })
    .catch(() => {
      document.getElementById("registry-live").textContent =
        "The registry could not be reached from here, so the catalogue is not shown.";
    });
})();

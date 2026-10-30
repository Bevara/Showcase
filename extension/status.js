/* Reports what happened to the media on this page.
 *
 * There is no way to ask a browser whether an extension is installed, and
 * nothing here tries: the page only looks at its own elements. The extension
 * stamps every element it takes over with data-bevara-id, so the presence of
 * that attribute - or simply an image that decoded when no browser decodes
 * that format - is the evidence. Everything below is plain observation of
 * the DOM; the page itself carries no decoder.
 */
(function () {
  "use strict";

  const statusEl = document.getElementById("status");
  const cells = {
    total: document.getElementById("r-total"),
    taken: document.getElementById("r-taken"),
    native: document.getElementById("r-native"),
    failed: document.getElementById("r-failed")
  };
  const noteEl = document.getElementById("r-note");

  const media = () => Array.from(document.querySelectorAll("img[src], audio[src], video[src]"));

  function classify(el) {
    if (el.hasAttribute("data-bevara-id") || el.getAttribute("is")) return "taken";
    if (el instanceof HTMLImageElement) {
      if (!el.complete) return "pending";
      return el.naturalWidth > 0 ? "native" : "failed";
    }
    /* A container the browser parses is not a track it can decode: Chrome
     * reads an Ogg's metadata, plays its Vorbis and leaves Theora at
     * videoWidth 0. So a video counts as native only once it has a picture. */
    if (el.error) return "failed";
    if (el instanceof HTMLVideoElement) {
      if (el.videoWidth > 0) return "native";
      return el.readyState >= HTMLMediaElement.HAVE_METADATA ? "failed" : "pending";
    }
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return "native";
    return "pending";
  }

  function tally() {
    const counts = { taken: 0, native: 0, failed: 0, pending: 0 };
    for (const el of media()) counts[classify(el)]++;
    return counts;
  }

  function render(final) {
    const c = tally();
    const total = c.taken + c.native + c.failed + c.pending;
    cells.total.textContent = total;
    cells.taken.textContent = c.taken;
    cells.native.textContent = c.native;
    cells.failed.textContent = c.failed + (c.pending && !final ? " (" + c.pending + " still loading)" : "");

    if (c.taken > 0) {
      statusEl.className = "on";
      statusEl.innerHTML = "<strong>The extension is working on this page.</strong> It has taken over "
        + c.taken + " element" + (c.taken === 1 ? "" : "s")
        + " the browser could not decode"
        + (c.failed ? ", and " + c.failed + " more are still failing — those need a decoder the registry does not "
          + "publish yet, or a patent status you have not allowed." : ".");
      noteEl.textContent = "Counted from the data-bevara-id attribute the extension leaves on each element it handles.";
      return;
    }

    if (!final) {
      statusEl.className = "";
      statusEl.textContent = "Checking what this browser does with the files below…";
      return;
    }

    statusEl.className = "off";
    statusEl.innerHTML = c.failed
      ? "<strong>No extension detected.</strong> " + c.failed + " of the " + total
        + " files on this page did not decode — that is what a stock browser does with them. "
        + "Install the extension above and reload to see them."
      : "<strong>No extension detected</strong>, but this browser decoded everything on the page by itself. "
        + "Try the video section below, or another browser.";
    noteEl.textContent = "";
  }

  /* The extension decodes in a worker and may take a few seconds on the
   * larger files, so the verdict is deferred rather than taken at load. */
  const started = Date.now();
  const timer = setInterval(() => {
    const done = Date.now() - started > 12000;
    render(done);
    if (done) clearInterval(timer);
  }, 700);

  window.addEventListener("load", () => render(false));
})();

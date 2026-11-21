/* Says, under every <video progressive>, which way the video is being played.
 *
 * Progressive playback feeds the element through Media Source Extensions
 * while the transcode runs, so it starts within seconds instead of after the
 * whole file. When the browser cannot do it - no MSE, a codec it refuses, a
 * stream it rejects, or a source that never yields a segment - the universal
 * tag falls back on its own to decoding the whole file, and fires
 * "progressivefallback" with the reason. This only makes that visible. */
(function () {
  function attach(video) {
    if (video.dataset.progressiveStatus) return;
    video.dataset.progressiveStatus = "1";
    const note = document.createElement("p");
    note.className = "progressive-status";
    note.style.cssText = "font-size:0.9em;color:#555;margin:0.3em 0 1em";
    note.textContent = "Progressive playback: the video starts while it is still being transcoded.";
    video.insertAdjacentElement("afterend", note);

    const t0 = performance.now();
    let fellBack = false;
    video.addEventListener("progressivefallback", (e) => {
      fellBack = true;
      const reason = e.detail && e.detail.reason ? " (" + e.detail.reason + ")" : "";
      note.textContent = "Progressive playback is not available in this browser" + reason
        + " - decoding the whole file instead; it plays once the transcode is over.";
    });
    video.addEventListener("canplay", () => {
      if (fellBack) return;
      note.textContent = "Progressive playback: ready to play " + ((performance.now() - t0) / 1000).toFixed(1)
        + " s after the page loaded, while the rest is still being transcoded.";
    }, { once: true });
  }

  function scan() {
    document.querySelectorAll("video[progressive]").forEach(attach);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();

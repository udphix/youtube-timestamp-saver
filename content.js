(() => {
  "use strict";

  /************************************************************************
   * Utils
   ************************************************************************/
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const storageGet = (keys) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(res);
      });
    });

  const storageSet = (obj) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });

  const debounce = (fn, wait = 150) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  const sanitizeFilename = (s) =>
    (s || "export")
      .replace(/[^\w\s-]/g, "_")
      .trim()
      .slice(0, 60);

  /************************************************************************
   * State
   ************************************************************************/
  let videoId = null;
  let videoPlayer = null;
  let savedTimestamps = [];
  let container = null;
  let progressBar = null;

  const CONTAINER_ID = "timestamp-saver-container";

  /************************************************************************
   * YouTube helpers
   ************************************************************************/
  function getVideoIdFromUrl(urlString = location.href) {
    try {
      const url = new URL(urlString);
      const host = url.hostname;
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const embedMatch = url.pathname.match(/\/embed\/([^\/\?]+)/);
      if (embedMatch) return embedMatch[1];
      const shortsMatch = url.pathname.match(/\/shorts\/([^\/\?]+)/);
      if (shortsMatch) return shortsMatch[1];
      if (host.includes("youtu.be")) {
        const segments = url.pathname.split("/").filter(Boolean);
        return segments[0] || null;
      }
      return null;
    } catch (e) {
      console.debug("getVideoIdFromUrl error", e);
      return null;
    }
  }

  function getVideoPlayer() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video.video-stream") ||
      document.querySelector("video")
    );
  }

  function getCurrentTimeSafe() {
    try {
      if (!videoPlayer || !document.body.contains(videoPlayer)) {
        videoPlayer = getVideoPlayer();
      }
      if (!videoPlayer) throw new Error("video element not found");
      return Math.max(
        0,
        Math.min(videoPlayer.currentTime || 0, videoPlayer.duration || Infinity)
      );
    } catch (e) {
      console.warn("getCurrentTimeSafe:", e);
      return 0;
    }
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return (
      (hrs > 0 ? `${hrs.toString().padStart(2, "0")}:` : "") +
      `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    );
  }

  /************************************************************************
   * Storage
   ************************************************************************/
  async function loadSavedTimestampsForVideo(id) {
    if (!id) {
      savedTimestamps = [];
      return;
    }
    try {
      const r = await storageGet({ timestamps: {} });
      const all = r.timestamps || {};
      savedTimestamps = Array.isArray(all[id]) ? all[id] : [];
    } catch (err) {
      console.error("Error loading saved timestamps:", err);
      savedTimestamps = [];
    }
  }

  async function persistSavedTimestampsForVideo(id) {
    try {
      const r = await storageGet({ timestamps: {} });
      const all = r.timestamps || {};
      all[id] = savedTimestamps;
      await storageSet({ timestamps: all });
    } catch (err) {
      console.error("Error persisting timestamps:", err);
    }
  }

  /************************************************************************
   * UI
   ************************************************************************/
  function injectCSS() {
    const href = chrome.runtime.getURL("content.css");
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  let attachedVideo = null;
  let videoRO = null;

  function destroyContainer() {
    if (container) {
      container.remove();
      container = null;
    }
  }

  function attachVideoListeners(video) {
    if (attachedVideo === video) return;
    if (attachedVideo) {
      attachedVideo.removeEventListener("timeupdate", debouncedRenderMarkers);
      try {
        videoRO?.disconnect();
      } catch (_) {}
    }
    attachedVideo = video;
    if (!video) return;
    video.addEventListener("timeupdate", debouncedRenderMarkers);
    try {
      videoRO = new ResizeObserver(debouncedRenderMarkers);
      videoRO.observe(video);
    } catch (_) {}
  }

  function createContainerIfNeeded() {
    if (!videoId) return null;
    if (container) return container;
    const secondary =
      document.getElementById("secondary") ||
      document.querySelector("#secondary-inner");
    if (!secondary) return null;

    const existing = document.getElementById(CONTAINER_ID);
    if (existing) {
      container = existing;
      return container;
    }

    container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Saved timestamps");

    // header
    const header = document.createElement("div");
    header.id = "timestamp-saver-header";
    const h3 = document.createElement("h3");
    h3.textContent = "Saved Timestamps";
    header.appendChild(h3);

    const exportButton = document.createElement("button");
    exportButton.id = "export-timestamps";
    exportButton.title = "Export as CSV";
    exportButton.setAttribute("aria-label", "Export timestamps as CSV");
    exportButton.innerHTML = '<i class="icon-export"></i>';
    header.appendChild(exportButton);

    // actions
    const actions = document.createElement("div");
    actions.id = "timestamp-actions";
    const saveBtn = document.createElement("button");
    saveBtn.id = "save-timestamp-button";
    saveBtn.innerHTML = '<i class="icon-bookmark"></i> Save Current Time';
    const clearBtn = document.createElement("button");
    clearBtn.id = "clear-all-timestamps";
    clearBtn.title = "Clear all timestamps";
    clearBtn.innerHTML = '<i class="icon-trash"></i>';
    actions.appendChild(saveBtn);
    actions.appendChild(clearBtn);

    const list = document.createElement("ul");
    list.className = "timestamp-list";
    list.setAttribute("role", "list");

    container.appendChild(header);
    container.appendChild(actions);
    container.appendChild(list);

    try {
      secondary.insertBefore(container, secondary.firstChild);
    } catch (e) {
      document.body.appendChild(container);
    }

    injectCSS();

    // events
    saveBtn.addEventListener("click", () => {
      const t = getCurrentTimeSafe();
      if (!t && t !== 0) return;
      saveTimestamp(Math.round(t * 100) / 100);
    });

    clearBtn.addEventListener("click", async () => {
      if (!confirm("Delete all timestamps for this video?")) return;
      savedTimestamps = [];
      await persistSavedTimestampsForVideo(videoId);
      renderTimestampList();
      renderProgressBarMarkers();
    });

    exportButton.addEventListener("click", exportTimestampsAsCSV);

    // list actions
    list.addEventListener("click", (e) => {
      const jumpBtn = e.target.closest(".timestamp-jump");
      if (jumpBtn) {
        const li = jumpBtn.closest("li");
        const idx = Number(li.dataset.index);
        jumpToTimestamp(idx);
        return;
      }
      const delBtn = e.target.closest(".timestamp-delete");
      if (delBtn) {
        const li = delBtn.closest("li");
        const idx = Number(li.dataset.index);
        deleteTimestamp(idx);
        return;
      }
      const noteDisplay = e.target.closest(".timestamp-note");
      if (noteDisplay) {
        const li = noteDisplay.closest("li");
        const input = li.querySelector(".timestamp-note-input");
        noteDisplay.style.display = "none";
        input.style.display = "block";
        input.focus();
        input.selectionStart = input.selectionEnd = input.value.length;
        return;
      }
    });

    // note input
    list.addEventListener("focusout", (e) => {
      if (!e.target.matches(".timestamp-note-input")) return;
      const input = e.target;
      const li = input.closest("li");
      const idx = Number(li.dataset.index);
      const newNote = input.value.trim();
      savedTimestamps[idx] = { ...savedTimestamps[idx], note: newNote };
      persistSavedTimestampsForVideo(videoId);
      renderTimestampList();
    });

    list.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches(".timestamp-note-input")) {
        e.target.blur();
      }
    });

    return container;
  }

  /************************************************************************
   * Timestamps
   ************************************************************************/
  async function saveTimestamp(time, note = "") {
    if (!videoId) return;
    savedTimestamps.push({ time: Number(time), note: note || "" });
    await persistSavedTimestampsForVideo(videoId);
    renderTimestampList();
    renderProgressBarMarkers();
  }

  async function deleteTimestamp(index) {
    if (index < 0 || index >= savedTimestamps.length) return;
    savedTimestamps.splice(index, 1);
    await persistSavedTimestampsForVideo(videoId);
    renderTimestampList();
    renderProgressBarMarkers();
  }

  function jumpToTimestamp(index) {
    const item = savedTimestamps[index];
    if (!item || !videoPlayer) return;
    videoPlayer.currentTime = item.time;
    videoPlayer.play?.().catch(() => {});
  }

  function renderTimestampList() {
    createContainerIfNeeded();
    const list = container.querySelector(".timestamp-list");
    list.innerHTML = "";

    if (!savedTimestamps || savedTimestamps.length === 0) {
      const li = document.createElement("li");
      li.className = "timestamp-empty";
      li.textContent = "No timestamps saved yet.";
      list.appendChild(li);
      return;
    }

    savedTimestamps.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "timestamp-item";
      li.dataset.index = String(i);

      const controls = document.createElement("div");
      controls.className = "timestamp-controls";
      const jumpBtn = document.createElement("button");
      jumpBtn.className = "timestamp-jump";
      jumpBtn.title = "Jump to this time";
      const timeSpan = document.createElement("span");
      timeSpan.className = "timestamp-time";
      timeSpan.textContent = formatTime(item.time);
      jumpBtn.appendChild(timeSpan);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "timestamp-delete";
      deleteBtn.title = "Delete this timestamp";
      deleteBtn.innerHTML = '<i class="icon-delete"></i>';

      controls.appendChild(jumpBtn);
      controls.appendChild(deleteBtn);

      const noteContainer = document.createElement("div");
      noteContainer.className = "timestamp-note-container";
      const noteDisplay = document.createElement("div");
      noteDisplay.className = "timestamp-note";
      noteDisplay.textContent = item.note || "No note";
      const noteInput = document.createElement("input");
      noteInput.className = "timestamp-note-input";
      noteInput.type = "text";
      noteInput.placeholder = "Add/Edit note";
      noteInput.value = item.note || "";
      noteInput.style.display = "none";

      noteContainer.appendChild(noteDisplay);
      noteContainer.appendChild(noteInput);

      li.appendChild(controls);
      li.appendChild(noteContainer);
      list.appendChild(li);
    });
  }

  /************************************************************************
   * Progress markers
   ************************************************************************/
  const debouncedRenderMarkers = debounce(renderProgressBarMarkers, 120);

  function renderProgressBarMarkers() {
    try {
      if (!videoPlayer || !document.body.contains(videoPlayer))
        videoPlayer = getVideoPlayer();
      progressBar = progressBar || document.querySelector(".ytp-progress-bar");
      if (!progressBar || !videoPlayer) return;

      qsa(".timestamp-marker", progressBar).forEach((m) => m.remove());

      const duration = videoPlayer.duration || 0;
      if (!duration || !isFinite(duration)) return;

      savedTimestamps.forEach((item) => {
        const marker = document.createElement("div");
        marker.className = "timestamp-marker";
        const pct = clamp((item.time / duration) * 100, 0, 100);
        marker.style.left = `${pct}%`;
        marker.title = `${formatTime(item.time)}${
          item.note ? ": " + item.note : ""
        }`;
        marker.setAttribute("role", "button");
        marker.setAttribute(
          "aria-label",
          `Go to ${formatTime(item.time)}${item.note ? ": " + item.note : ""}`
        );
        marker.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!videoPlayer) videoPlayer = getVideoPlayer();
          if (!videoPlayer) return;
          videoPlayer.currentTime = item.time;
          videoPlayer.play?.().catch(() => {});
        });
        progressBar.appendChild(marker);
      });
    } catch (err) {
      console.error("Error rendering markers:", err);
    }
  }

  /************************************************************************
   * Export
   ************************************************************************/
  function exportTimestampsAsCSV() {
    if (!savedTimestamps || savedTimestamps.length === 0) {
      alert("No timestamps to export.");
      return;
    }
    let videoTitle = (
      document.querySelector("h1.title")?.textContent ||
      document.title ||
      videoId ||
      "timestamps"
    ).trim();
    const filename = `timestamps_${sanitizeFilename(videoTitle)}.csv`;

    let csv = "TimeSeconds,TimeFormatted,Note\n";
    savedTimestamps.forEach((s) => {
      const note = (s.note || "").replace(/"/g, '""');
      csv += `${s.time},"${formatTime(s.time)}","${note}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /************************************************************************
   * Navigation
   ************************************************************************/
  function hookHistoryEvents() {
    if (window.__timestamp_history_hooked) return;
    window.__timestamp_history_hooked = true;

    const origPush = history.pushState;
    const origReplace = history.replaceState;

    const dispatchNav = () =>
      window.dispatchEvent(new Event("timestamp-extension-url-changed"));

    history.pushState = function () {
      const ret = origPush.apply(this, arguments);
      dispatchNav();
      return ret;
    };
    history.replaceState = function () {
      const ret = origReplace.apply(this, arguments);
      dispatchNav();
      return ret;
    };
    window.addEventListener("popstate", dispatchNav);
  }

  async function onUrlChange() {
    const newId = getVideoIdFromUrl();
    if (newId === videoId) return;
    videoId = newId;

    if (!videoId) {
      savedTimestamps = [];
      destroyContainer();
      return;
    }

    videoPlayer = getVideoPlayer();
    attachVideoListeners(videoPlayer);

    await loadSavedTimestampsForVideo(videoId);
    createContainerIfNeeded();
    renderTimestampList();

    progressBar = document.querySelector(".ytp-progress-bar");
    renderProgressBarMarkers();
  }

  function initialize() {
    hookHistoryEvents();

    window.addEventListener(
      "timestamp-extension-url-changed",
      debounce(onUrlChange, 80)
    );
    window.addEventListener("yt-navigate-finish", debounce(onUrlChange, 80));
    document.addEventListener("spfdone", debounce(onUrlChange, 80));

    let lastHref = location.href;
    const mo = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onUrlChange();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    waitForElements(
      ["#secondary", "video.video-stream, .html5-main-video"],
      async (secondary, video) => {
        videoPlayer = video;
        videoId = getVideoIdFromUrl();
        createContainerIfNeeded();
        await loadSavedTimestampsForVideo(videoId);
        renderTimestampList();
        renderProgressBarMarkers();
        attachVideoListeners(video);
      }
    );

    window.addEventListener("resize", debouncedRenderMarkers);
  }

  // init
  if (document.readyState === "loading") {
    window.addEventListener("load", initialize);
  } else {
    initialize();
  }
})();

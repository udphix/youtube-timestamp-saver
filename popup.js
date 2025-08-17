"use strict";

const storageGet = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (res) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(res);
    });
  });

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportAllTimestamps() {
  try {
    const r = await storageGet("timestamps");
    const data = r.timestamps || {};
    const filename = `youtube_timestamps_${
      new Date().toISOString().split("T")[0]
    }.json`;
    downloadBlob(filename, "application/json", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to export timestamps:", err);
    alert("Failed to export timestamps. See console for details.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("exportButton");
  if (!btn) {
    console.error("Export button not found in popup");
    return;
  }
  btn.addEventListener("click", exportAllTimestamps);
  console.log("Popup ready");
});

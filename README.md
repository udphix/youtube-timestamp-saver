
---

  

# YouTube Timestamp Saver

  

Save, manage, and export timestamps while watching YouTube videos.

Lightweight Chrome extension. Minimal UI.

  

---

  

## Features

  

- 📌 Save current video time with one click

- 📝 Add notes to each timestamp

- 🗑️ Delete individual or all timestamps

- 📊 See markers on the YouTube progress bar

- 📤 Export timestamps as CSV

- 🔄 Works with YouTube navigation (SPA support)

  

---

  

## How it works

  

- A sidebar appears in the YouTube "secondary" panel

- Each saved timestamp is stored per video in `chrome.storage.local`

- Markers are drawn on the YouTube progress bar

- Notes can be edited inline

- Data can be exported as CSV

  

---

  

## Installation (Dev mode)

  

1. Clone or download this repo

2. Open **Chrome → Extensions → Manage Extensions**

3. Enable **Developer mode**

4. Click **Load unpacked** and select the project folder

5. Open YouTube and test

  

---

  

## Usage

  

-  **Save time** → click the bookmark button

-  **Jump** → click a timestamp or marker

-  **Edit note** → click the note text

-  **Delete** → trash icon

-  **Export** → export button (CSV file)

  

---

  

## File structure

  

```

/extension

├── manifest.json

├── content.js # main logic

├── content.css # styles

└── icons/ # extension icons

```

  

---

  

## Tech

  

- Plain JavaScript (no frameworks)

- Chrome Extension APIs (`storage`, `runtime`)

- MutationObserver + History API for SPA navigation

- Minimal CSS

  
  

---

  

## License

  

MIT — free to use, modify, share.

  

---

# YouTube Focus Filter — Browser Extension

> AI-powered YouTube content filter with semantic classification, transcript analysis, and channel-level controls. Runs **entirely in-browser** using [Transformers.js](https://huggingface.co/docs/transformers.js) — no external server required.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Semantic AI Classification** | Uses `all-MiniLM-L6-v2` transformer model for embedding-based content matching |
| **Three-Field Weighted Scoring** | Classifies videos using title (50%), description (20%), and transcript (30%) |
| **Natural Language Rules** | Write rules in plain English: *"Block all gaming and vlog content"* |
| **Transcript Analysis** | Fetches YouTube captions for deep content understanding on watch pages |
| **YouTube Data API** | Enriches video metadata (title, description, tags) via batch API calls |
| **Channel Allow/Deny Lists** | Whitelist or blacklist entire channels by name |
| **Two Filtering Modes** | **RESTRICTED** (block matching) or **FOCUS** (allow only matching) |
| **Auto Tab Refresh** | YouTube tabs auto-reload when filter is enabled or rules change |
| **Infinite Scroll Support** | MutationObserver + scroll listener detects dynamically loaded videos |
| **Decision Caching** | `chrome.storage.local` cache prevents redundant classification |
| **Watch Page Blocking** | Full-page overlay prevents viewing restricted videos via direct URL |
| **Hide-First UX** | Cards hidden instantly on render, revealed after classification (no flicker) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER EXTENSION                       │
│                                                             │
│  ┌──────────┐    chrome.storage    ┌──────────────────┐     │
│  │  POPUP   │◄───────────────────►│   BACKGROUND.JS   │     │
│  │ (React)  │    sendMessage()     │ (Service Worker)  │     │
│  │          │────────────────────►│                    │     │
│  │ HomePage │  STATE_CHANGED       │ ┌──────────────┐  │     │
│  │  .jsx    │  RULE_UPDATED        │ │ CLASSIFIER   │  │     │
│  └──────────┘                      │ │  .JS         │  │     │
│                                    │ │              │  │     │
│                                    │ │ Transformers │  │     │
│  ┌──────────┐  CLASSIFY_BATCH      │ │ .js Pipeline │  │     │
│  │ CONTENT  │────────────────────►│ │              │  │     │
│  │  .JS     │◄────────────────────│ │ MiniLM-L6-v2 │  │     │
│  │          │  { results }         │ └──────────────┘  │     │
│  │ DOM Scan │                      │                    │     │
│  │ Observer │  CLASSIFY_VIDEO      │  YouTube Data API  │     │
│  │ Scroll   │────────────────────►│  Transcript Fetch  │     │
│  └──────────┘                      └──────────────────┘     │
│       │                                    │                │
│       ▼                                    ▼                │
│  ┌──────────┐                      ┌──────────────────┐     │
│  │ YouTube  │                      │ googleapis.com   │     │
│  │   DOM    │                      │ (Video Metadata) │     │
│  └──────────┘                      └──────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Communication Flow

### Message Types & Payloads

#### 1. `STATE_CHANGED` (Popup → Background → Content)
Fired when the user toggles the filter on/off.

```
Direction: Popup → Background → Content Script
Payload:   { action: "STATE_CHANGED", started: boolean }
Effect:    - started=true  → Background reloads all YouTube tabs
           - started=false → Content script un-hides all cards, removes overlays
```

#### 2. `RULE_UPDATED` (Popup → Background → Tab Reload)
Fired when user saves new topics, threshold, or channel lists.

```
Direction: Popup → Background
Payload:   { type: "RULE_UPDATED" }
Effect:    - Clears in-memory topic embedding cache
           - Reloads all YouTube tabs for fresh classification
```

#### 3. `CLASSIFY_BATCH` (Content → Background)
Sent by content script when new video cards appear on the feed.

```
Direction: Content Script → Background
Payload:   { type: "CLASSIFY_BATCH", videos: [{ videoId, title, description, channel }] }
Response:  { results: { [videoId]: { decision, score, matchedTopic, reason } } }
Pipeline:  Denylist → Allowlist → Cache → YouTube API → Classifier
```

#### 4. `CLASSIFY_VIDEO` (Content → Background)
Sent for single watch page video with transcript analysis enabled.

```
Direction: Content Script → Background
Payload:   { type: "CLASSIFY_VIDEO", video: { videoId, title, description, channel } }
Response:  { result: { decision, score, matchedTopic, reason } }
Pipeline:  Same as CLASSIFY_BATCH + Transcript fetch for deep analysis
```

#### 5. `GET_STATS` / `RESET_STATS` (Popup → Background)
Stats management for the UI counters.

```
Direction: Popup → Background
GET:       { type: "GET_STATS" }  →  { stats: { blocked, allowed } }
RESET:     { type: "RESET_STATS" }  →  { ok: true }
```

---

## 🧠 Classifier Pipeline

The classification engine processes each video through these stages:

```
1. USER INTENT PARSING
   │  "I don't want to see gaming or vlogs"
   │     → mode: RESTRICTED
   │     → topics: [gaming, gameplay, walkthrough, ..., vlog, lifestyle, ...]
   ▼
2. CHANNEL LIST CHECK
   │  denylist match → instant BLOCK (score: 1.0)
   │  allowlist match → instant ALLOW (score: 0)
   ▼
3. CACHE LOOKUP
   │  cache hit → return cached { decision, score, reason }
   ▼
4. METADATA ENRICHMENT
   │  YouTube Data API → { title, description, tags, channel }
   │  Transcript API   → first ~600 chars of video captions (watch pages only)
   ▼
5. DOMAIN KEYWORD MATCHING
   │  Exact word/phrase matches against expanded topic dictionaries
   │  ≥3 matches → 0.95 | 2 matches → 0.90 | 1 match → 0.80
   ▼
6. SEMANTIC EMBEDDING (Transformers.js)
   │  Model:    Xenova/all-MiniLM-L6-v2 (384-dim sentence embeddings)
   │  Fallback: Deterministic bag-of-words vector if model fails
   │
   │  Embed each field and compute cosine similarity against topic vectors:
   │    titleSim       = cosine(titleVec, topicVec)
   │    descSim        = cosine(descVec, topicVec)
   │    transcriptSim  = cosine(transcriptVec, topicVec)
   │
   │  Weighted score = 0.50 × titleSim + 0.20 × descSim + 0.30 × transcriptSim
   │  (rebalances when fields are unavailable)
   ▼
7. DECISION
   │  finalScore = max(keywordScore, semanticScore)
   │
   │  RESTRICTED mode: score ≥ threshold → BLOCK, else ALLOW
   │  FOCUS mode:      score ≥ threshold → ALLOW, else BLOCK
   ▼
8. CACHE & RESPOND
   Store decision in chrome.storage.local, return to content script
```

---

## 🔧 Setup & Installation

### Prerequisites
- **Node.js** ≥ 18
- **Chrome** ≥ 116 (Manifest V3 support)
- YouTube Data API key (optional, for metadata enrichment)

### Build

```bash
cd extension
npm install
```

Create a `.env` file in the `extension/` directory:
```
VITE_YT_API_KEY=your_youtube_data_api_v3_key_here
```

Build the extension:
```bash
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder
5. Open YouTube — the filter is active immediately

### Development

```bash
npm run dev     # Vite dev server with HMR (popup only)
npm run watch   # Build + watch for changes (full extension)
```

---

## ⚙️ Configuration

| Setting | Default | Range | Description |
|---|---|---|---|
| **Mode** | RESTRICTED | RESTRICTED / FOCUS | Block matching vs. allow only matching |
| **Threshold** | 0.40 | 0.25 – 0.80 | Semantic similarity cutoff |
| **Topics** | violence, gambling, sexual content, drugs | Free text | Keywords or natural language sentences |
| **Allowlist** | (empty) | Channel names | Always show these channels |
| **Denylist** | (empty) | Channel names | Always hide these channels |

### Natural Language Examples

**RESTRICTED mode:**
- `gaming` — blocks gaming videos
- `I don't want to see any gaming, vlog or lifestyle content` — blocks all three categories
- `violence\ngambling\ndrugs` — blocks each as separate topics

**FOCUS mode:**
- `coding` — only shows coding videos
- `Only show me programming tutorials and tech reviews` — focuses on two categories

---

## 📁 File Structure

```
extension/
├── background.js          # Service worker: API calls, transcript fetching, classification dispatch
├── classifier.js          # Semantic engine: embeddings, keyword matching, intent parsing
├── content.js             # DOM scanner: card detection, scroll handling, block overlay
├── content.css            # Styles: card states (pending/allowed/blocked), overlay design
├── manifest.json          # Chrome Extension manifest v3
├── index.html             # Popup entry point
├── src/
│   ├── App.jsx            # React app root
│   ├── App.css            # Root styles
│   ├── main.jsx           # React entry point
│   ├── index.css          # Global styles (Tailwind)
│   └── Main/
│       └── HomePage.jsx   # Popup UI: filter controls, stats, settings
├── vite.config.mjs        # Vite + CRXJS build configuration
└── package.json           # Dependencies
```

---

## 🛡️ Privacy

- **No external servers** — all AI classification runs in-browser via Transformers.js
- **No data collection** — settings and cache stored locally in `chrome.storage.local`
- **YouTube API calls** are optional and only fetch public video metadata
- **Transcript fetching** reads publicly available YouTube captions
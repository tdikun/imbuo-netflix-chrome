# Product Requirements Document: Netflix Restriction Manager (Imbuo Extension)

**Version:** 3.1  
**Date:** March 27, 2026

---

## 1. Overview

A Chrome extension that connects the Imbuo parent app's content analysis database to Netflix's Parental Controls page. In v1, the extension has a single purpose: block every title in Imbuo's database that contains explicit or implied LGBTQ content and is currently available on Netflix. The extension fetches the list from a new endpoint on the parent app's API, then batch-applies those titles as restrictions via DOM automation on Netflix's existing restrictions UI.

Future versions will generalize to full preference-profile evaluation (violence thresholds, language flags, etc.). v1 ships the hardest part — the DOM automation pipeline and the extension infrastructure — against the simplest possible filtering logic.

---

## 2. Repositories

This project spans two repositories:

**`imbuo-parent`** (existing) — `~/Sites/personal/imbuo/imbuo-parent/`  
The parent-facing Imbuo app. Laravel 11 backend (PHP, port 8001) + Expo/React Native frontend. Read-only — data arrives via the admin app's publish pipeline. This repo gets a new API endpoint that the Chrome extension consumes. The data is already here: the `ratings` table has LGBTQ presence flags, and the `watchmode_*` tables have Netflix availability. The new endpoint is a JOIN.

**`imbuo-netflix-chrome`** (new) — to be created  
The Chrome extension. Manifest V3. Plain HTML/JS/CSS — no build step required for v1. Consumes the `imbuo-parent` API and automates Netflix's Parental Controls DOM.

**`imbuo-admin`** — **not touched by this project.** The admin app handles analysis and publishing. By the time data reaches `imbuo-parent`, it's already in the normalized `ratings` table.

The API response shape in Section 7 is the contract between the two repos. Both sides can be built independently against that spec.

---

## 3. Problem Statement

Imbuo already catalogs whether a title contains LGBTQ content (both explicit and implied) as part of its structured analysis. But that information lives in the Imbuo apps — parents still have to manually enforce restrictions on Netflix by searching titles one at a time. This extension closes the loop: Imbuo's analysis output becomes Netflix's restriction input.

---

## 4. Goals and Non-Goals

### Goals

- **P0** — Fetch all analyzed titles with explicit or implied LGBTQ content that are available on Netflix, then batch-restrict them on the Netflix Parental Controls page via DOM automation.
- **P0** — Automate the search-and-select workflow on Netflix's restrictions page (type → autocomplete → select → confirm).
- **P1** — Let users review the restriction list before applying, with per-title override (skip/force).
- **P1** — Show progress and status feedback during batch operations.

### Non-Goals

- Will not support full preference-profile evaluation in v1. Only LGBTQ filtering.
- Will not bypass Netflix authentication or MFA. Users authenticate themselves.
- Will not call Netflix's internal APIs. All interaction via DOM manipulation.
- Will not manage Netflix's maturity rating slider — only title-level restrictions.
- Will not run Imbuo analysis from the extension. Titles must already be published.
- Will not modify `imbuo-admin` in any way.
- Will not work on non-Chromium browsers in v1.

---

## 5. User Stories

**US-1: Fetch LGBTQ Titles**  
As a parent, I want to click one button in the extension and see every Netflix title in Imbuo's database that contains LGBTQ content (explicit or implied), so I know exactly what to restrict.

**US-2: Review Before Apply**  
As a parent, I want to review the list before committing, deselect any titles I don't want to restrict, and see whether each title has explicit or implied LGBTQ content.

**US-3: Batch Apply**  
As a parent, I want to click "Apply All" and watch the extension automatically search, select, and add each title to Netflix's restricted list, with a progress indicator showing status per title.

**US-4: Incremental Updates**  
As a parent, I want to re-run the extension periodically and have it automatically detect which titles are already restricted on Netflix (by reading the existing restrictions from the page) and only show me the new titles that still need to be added.

---

## 6. System Diagram

```
┌──────────────────────┐         ┌──────────────────────────────┐
│  Extension Popup      │         │  imbuo-parent Backend        │
│  (popup.js)           │         │  (Laravel, port 8001)        │
│                       │  HTTP   │                              │
│  - Title list         │────────▶│  GET /api/v1/restrictions    │
│  - Review checkboxes  │◀────────│                              │
│  - Progress bar       │         │  JOINs:                      │
│                       │         │   - reports                  │
│                       │         │   - ratings (LGBTQ flags)    │
│                       │         │   - watchmode_titles         │
│                       │         │   - watchmode_title_sources  │
│                       │         │   - watchmode_sources        │
└───────┬──────────────┘         └──────────────────────────────┘
        │ chrome.tabs                  imbuo-parent repo
        │ .sendMessage
        ▼
┌──────────────────────┐
│  Content Script       │
│  (content.js)         │
│                       │
│  DOM automation on    │
│  Netflix restrictions │
│  page                 │
└──────────────────────┘
   imbuo-netflix-chrome repo
```

---

## 7. API Contract

### `GET /api/v1/restrictions`

This is the interface between the two repos. The extension consumes this endpoint; the parent backend serves it. Pure local DB query — no external API calls.

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `platform` | string | yes | Streaming platform filter (e.g., `"netflix"`) |
| `include_implied` | bool | no | Whether to include implied/coded LGBTQ (default: `true`) |

**Response:**

```json
{
  "platform": "netflix",
  "titles": [
    {
      "report_id": 42,
      "tmdb_id": 550,
      "imdb_id": "tt0137523",
      "title": "Fight Club",
      "year": "1999",
      "content_type": "movie",
      "poster_url": "https://image.tmdb.org/...",
      "lgbtq_explicit": false,
      "lgbtq_implied": true,
      "evidence": "Subtext between two characters suggests ambiguous attraction"
    }
  ],
  "total_reports": 145,
  "total_with_lgbtq": 38,
  "total_on_platform": 22
}
```

---

## 8. Changes to `imbuo-parent` (Existing Repo)

All backend changes. No frontend changes.

### 8.1 New Controller Method or Controller

Add a `restrictions` method to `ReportController` (or create a new `RestrictionController` — whichever fits the project's conventions).

**Route:** Add to `routes/api.php`:

```php
Route::get('/v1/restrictions', [ReportController::class, 'restrictions']);
```

### 8.2 Query Logic

The data is already in the database. The endpoint is a JOIN across existing tables:

1. **Find reports with LGBTQ content** — query the `ratings` table:
   - `section_key = 'themes_and_depictions'`
   - `group_key = 'relationships_and_family'`
   - `subcategory_key IN ('explicit_characters_or_relationships', 'implied_or_coded')`
   - `present = true`
   - If `include_implied = false`, exclude `'implied_or_coded'`

2. **Filter to Netflix-available** — JOIN through Watchmode tables:
   - `reports.imdb_id` → `watchmode_titles.imdb_id` (or `tmdb_id` fallback)
   - `watchmode_titles.id` → `watchmode_title_sources.title_id`
   - `watchmode_title_sources.source_id` → `watchmode_sources.id` WHERE `name = 'Netflix'` AND `type = 'sub'`

3. **Build response** — for each matching report, include the title metadata from the `reports` table and the LGBTQ evidence from the `ratings` table.

**Approximate SQL:**

```sql
SELECT DISTINCT
    r.id AS report_id,
    r.tmdb_id,
    r.imdb_id,
    r.title,
    r.year,
    r.content_type,
    r.poster_url,
    MAX(CASE WHEN rat.subcategory_key = 'explicit_characters_or_relationships' AND rat.present = true THEN true ELSE false END) AS lgbtq_explicit,
    MAX(CASE WHEN rat.subcategory_key = 'implied_or_coded' AND rat.present = true THEN true ELSE false END) AS lgbtq_implied,
    -- evidence from whichever subcategory is present
    (SELECT evidence FROM ratings
     WHERE report_id = r.id
       AND section_key = 'themes_and_depictions'
       AND group_key = 'relationships_and_family'
       AND subcategory_key IN ('explicit_characters_or_relationships', 'implied_or_coded')
       AND present = true
     LIMIT 1) AS evidence
FROM reports r
JOIN ratings rat ON rat.report_id = r.id
    AND rat.section_key = 'themes_and_depictions'
    AND rat.group_key = 'relationships_and_family'
    AND rat.subcategory_key IN ('explicit_characters_or_relationships', 'implied_or_coded')
    AND rat.present = true
JOIN watchmode_titles wt ON wt.imdb_id = r.imdb_id
JOIN watchmode_title_sources wts ON wts.title_id = wt.id AND wts.type = 'sub'
JOIN watchmode_sources ws ON ws.id = wts.source_id AND ws.name = 'Netflix'
GROUP BY r.id;
```

In Eloquent, this is likely cleaner as a query builder chain or a scope on the `Report` model. The `WatchmodeService` already exists for streaming lookups — this endpoint can use a similar pattern or extend it.

### 8.3 Netflix Source ID Constant

The Watchmode `source_id` for Netflix should be stored as a constant (it's `203` based on the Watchmode import commands in `docs/done/prd-watchmode.md`). Rather than joining on `watchmode_sources.name = 'Netflix'`, the query can filter directly on `watchmode_title_sources.source_id = 203` for performance. Define this in a config or constant:

```php
// app/Services/WatchmodeService.php or config/watchmode.php
const NETFLIX_SOURCE_ID = 203;
```

### 8.4 CORS

The existing CORS config needs to allow Chrome extension origins (`chrome-extension://{extension-id}`). If CORS is already `*` (likely for v1 per the PRD spec: "Allow all origins in v1"), no change needed. Verify in `config/cors.php`.

### 8.5 No Schema Changes

No new tables. No migrations. The `reports`, `ratings`, `watchmode_titles`, `watchmode_title_sources`, and `watchmode_sources` tables already have everything needed.

---

## 9. `imbuo-netflix-chrome` (New Repo)

### 9.1 Project Structure

```
imbuo-netflix-chrome/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/
│   └── content.js
├── background.js
├── config.js          # DOM selectors, API URLs, constants
├── matching.js        # Title matching / string similarity
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

No build step. No React. No npm. Plain Manifest V3 Chrome extension.

### 9.2 manifest.json

```json
{
  "manifest_version": 3,
  "name": "Imbuo Netflix Restriction Manager",
  "version": "0.1.0",
  "description": "Batch-apply title restrictions to Netflix profiles using Imbuo analysis data.",
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": [
    "https://www.netflix.com/*",
    "http://localhost:8001/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://www.netflix.com/settings/restrictions/*"],
      "js": ["config.js", "matching.js", "content/content.js"]
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

Note: `host_permissions` includes `http://localhost:8001/*` (the parent app's port, not 8000).

### 9.3 config.js — Centralized Selectors and Constants

```javascript
const CONFIG = {
  // Imbuo Parent API
  DEFAULT_BACKEND_URL: 'http://localhost:8001',
  ENDPOINT_PATH: '/api/v1/restrictions',

  // Netflix DOM selectors
  SELECTORS: {
    SEARCH_INPUT: 'input[name="pin-search"]',
    SEARCH_RESULTS_CONTAINER: 'div.search-results',
    SEARCH_RESULT_ITEM: 'a.search-result',
    PROTECTED_VIDEOS_CONTAINER: 'div.protected-videos',
    PROTECTED_VIDEO_ITEM: 'div.protected-video',
    REMOVE_BUTTON: 'button[data-titleid][aria-label="Remove"]',
    SAVE_BUTTON: 'button[data-uia="btn-account-pin-submit"]',
    CANCEL_BUTTON: 'button[data-uia="btn-account-pin-cancel"]',
    CLEAR_INPUT_BUTTON: 'span.icon-close',
  },

  // Timing
  AUTOCOMPLETE_POLL_INTERVAL_MS: 200,
  AUTOCOMPLETE_TIMEOUT_MS: 5000,
  DELAY_BETWEEN_TITLES_MIN_MS: 500,
  DELAY_BETWEEN_TITLES_MAX_MS: 1000,

  // Matching
  MATCH_THRESHOLD: 0.85,
};
```

### 9.4 Content Script: DOM Automation

`content/content.js` is injected into `https://www.netflix.com/settings/restrictions/*`. It listens for messages from the popup and performs two jobs: reading existing restrictions from the DOM, and automating the addition of new ones.

**Reading existing restrictions:**

On popup open (or on `readExisting` message), the content script scrapes `div.protected-videos` for all `div.protected-video` entries, extracts the title text from each, and returns the list. The popup uses this to compare against the Imbuo API response and only display the delta — titles that are flagged but not already restricted. The DOM is the source of truth for what's currently restricted; no state needs to be persisted in the extension.

**Single title sequence:**

1. **Clear input** — click `span.icon-close` if visible, or select-all + delete. Verify input value is empty.
2. **Type search term** — use `nativeInputValueSetter` to set value, then dispatch `input` event with `bubbles: true`:
   ```javascript
   const input = document.querySelector(CONFIG.SELECTORS.SEARCH_INPUT);
   const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
   setter.call(input, titleName);
   input.dispatchEvent(new Event('input', { bubbles: true }));
   ```
3. **Wait for autocomplete** — poll for `div.search-results` containing `a.search-result` children. 200ms intervals, 5-second timeout.
4. **Match selection** — normalized string comparison against autocomplete results. Select best match above threshold by clicking the `a.search-result` element.
5. **Confirm addition** — verify new `div.protected-video` appeared in the container.
6. **Throttle** — random delay (500–1000ms) before next title.

**Batch orchestration:**

- Process titles sequentially (single search input).
- Send progress updates to popup after each title: `{ status: "progress", current: N, total: M, title: "...", result: "success|unmatched|duplicate" }`.
- After all titles: send `{ status: "complete", summary: {...} }`.
- On user confirm: click Save button. Detect redirect to `/account?message=restrictions.confirm`.

**Message handling:**

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'readExisting') {
    // Scrape all currently restricted titles from the DOM
    const items = document.querySelectorAll(CONFIG.SELECTORS.PROTECTED_VIDEO_ITEM);
    const titles = Array.from(items).map(el => el.textContent.trim());
    sendResponse({ titles });
  }
  if (message.action === 'startBatch') {
    processBatch(message.titles);
  }
  if (message.action === 'clickSave') {
    document.querySelector(CONFIG.SELECTORS.SAVE_BUTTON)?.click();
  }
  if (message.action === 'clickCancel') {
    document.querySelector(CONFIG.SELECTORS.CANCEL_BUTTON)?.click();
  }
  if (message.action === 'checkReady') {
    const ready = !!document.querySelector(CONFIG.SELECTORS.SEARCH_INPUT);
    sendResponse({ ready });
  }
  return true;
});
```

### 9.5 Popup UI

`popup/popup.html` + `popup/popup.js`. Single-purpose interface.

**Sequence on open:**

1. Send `checkReady` to content script — verify we're on the Netflix restrictions page.
2. If ready, send `readExisting` to content script — get the list of already-restricted titles.
3. Fetch `GET /api/v1/restrictions?platform=netflix` from the Imbuo parent API.
4. Compare the API response against the existing restrictions (using normalized title matching). Filter out titles already restricted.
5. Display the delta — only titles that need to be added.

**States:**

| State | Display |
|---|---|
| Not on Netflix restrictions page | "Navigate to a Netflix profile's Parental Controls page to get started." with instructions. |
| Ready — before fetch | "Fetch from Imbuo" button. Toggle: "Include implied/coded" (on by default). Settings link (backend URL). |
| Ready — title list loaded | Title list with checkboxes showing only new titles to add. Each row: title, year, "Explicit"/"Implied" badge. Header: "12 new titles to restrict (10 already restricted, 38 total flagged)." "Apply All" button. |
| Batch in progress | Progress bar ("7 of 12"). Scrollable status log per title. Pause/Cancel. |
| Batch complete | Summary: X added, Y not found. "Save to Netflix" / "Cancel All" buttons. |

**Dimensions:** Width 400px, height dynamic max 550px with scroll.

### 9.6 matching.js — Title Similarity

Used in two places: (1) the content script compares Netflix's autocomplete results against the target title to pick the correct match and avoid restricting the wrong title (e.g., "Frozen Planet" when you meant "Frozen"), and (2) the popup compares existing restriction titles from the DOM against Imbuo titles to detect what's already restricted.

```javascript
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\(\d{4}\)/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  return 1 - (levenshteinDistance(na, nb) / Math.max(na.length, nb.length));
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
```

### 9.7 background.js — Service Worker

Minimal for v1:

```javascript
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    imbuoConfig: { backendUrl: 'http://localhost:8001' },
    settings: {
      matchThreshold: 0.85,
      delayBetweenTitles: 750,
      includeImplied: true,
    }
  });
});
```

### 9.8 Storage Schema

```
chrome.storage.local:

  imbuoConfig: {
    backendUrl: "http://localhost:8001"
  }

  settings: {
    matchThreshold: 0.85,
    delayBetweenTitles: 750,
    includeImplied: true
  }
```

No sync state is persisted. The DOM is the source of truth for what's already restricted — the extension reads it fresh on every open.

---

## 10. Edge Cases and Error Handling

**Imbuo parent backend unreachable:** Connection error in popup with retry button. Link to settings to verify backend URL.

**No published reports:** Empty list returned. Popup: "No reports found. Content needs to be analyzed and published in Imbuo first."

**Watchmode data not yet imported:** If the Watchmode tables are empty or Netflix titles haven't been backfilled, the JOIN returns no results. The response will show `total_with_lgbtq > 0` but `total_on_platform = 0`, making it clear the issue is streaming data, not analysis data. Popup: "X titles flagged but none matched to Netflix. Streaming data may need to be updated."

**Netflix session expires mid-batch:** Content script checks for login/MFA redirect after each interaction. Pause batch, notify user, allow resume.

**Autocomplete returns no results:** Title logged as "not found on Netflix" and skipped.

**DOM structure changes:** Selectors centralized in `config.js`. Extension halts with clear error.

**Duplicate restrictions:** The popup filters out already-restricted titles before the batch starts (via DOM read). As a secondary safety check, the content script also verifies against `div.protected-videos` before each addition in case the DOM changed during the batch.

**Rate limiting / slow autocomplete:** 5-second timeout, one retry, then skip. Exponential backoff on consecutive timeouts.

---

## 11. Technical Risks and Mitigations

**Risk: Netflix changes DOM selectors.**  
Mitigation: Centralized in `config.js`. Publish extension updates promptly.

**Risk: React synthetic events reject programmatic input.**  
Mitigation: `nativeInputValueSetter` + native `input` event dispatch. Well-established pattern for React-controlled inputs.

**Risk: Watchmode data stale (title left Netflix since last sync).**  
Mitigation: The extension handles "not found on Netflix" gracefully (skip + log). Running `watchmode:sync` daily keeps data fresh.

**Risk: Netflix adds bot detection.**  
Mitigation: Human-like random delays (500–1500ms). DOM manipulation mimics real user clicks.

---

## 12. Success Metrics

- Match rate > 90% for titles that exist on Netflix.
- Processing time < 3 seconds per title.
- Zero unintended restrictions — every title shown for user review before Save.
- 50+ titles restricted in under 5 minutes.

---

## 13. Release Plan

**v0.1 (MVP):**  
Fetch LGBTQ-flagged titles from Imbuo, read existing Netflix restrictions from DOM, show delta, batch-apply new restrictions. Backend: new endpoint in `imbuo-parent`. Extension: new repo `imbuo-netflix-chrome`.

**v0.5:**  
Pause/resume. History log. Polished UI.

**v1.0:**  
Settings page. Robust error handling.

**v2.0 (Preference Profiles):**  
Full preference-profile evaluation against all rating categories. Requires preference model + evaluation logic in the parent app. Supports all category types — not just LGBTQ.

**v2.5:**  
Reverse sync — read Netflix's current restrictions back into Imbuo. Multi-platform support.

---

## 14. Implementation Sequence

1. **Start in `imbuo-parent`:** Add the `GET /api/v1/restrictions` endpoint (controller method, route, verify CORS). Test with `curl` against local DB with seed data.
2. **Create `imbuo-netflix-chrome`:** Initialize repo with manifest, config, popup, content script, matching logic. Load as unpacked extension in Chrome.
3. **Integration test:** Navigate to Netflix restrictions page, fetch from Imbuo parent API, run a small batch, verify titles added correctly.
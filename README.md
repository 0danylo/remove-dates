# Remove Dates

A Chrome extension (Manifest V3) that strips **every date and time** out of a
web page, in just about any format, and keeps doing it as the page changes.

If a time-of-day sits next to a date it's removed too, so you don't end up with
a lonely `3:45 PM` floating where a timestamp used to be.

![icon](icons/icon48.png)

## What it removes

| Kind | Examples |
| --- | --- |
| ISO 8601 | `2024-01-15`, `2024-01-15T14:30:00Z`, `2024/01/15` |
| Numeric | `01/15/2024`, `15/01/2024`, `31.12.2023`, `1-15-24` |
| Written | `January 15, 2024`, `Jan 15`, `15th January 2024`, `1st of Jan 2020` |
| With weekday | `Monday, January 15, 2024`, `Mon, 15 Jan 2024 14:30 GMT` |
| Month / year | `March 2024`, `December 25` |
| Time next to a date | `January 1, 2024 at 3:45 PM`, `2024-01-15 14:30`, `Mon, 15 Jan 2024 14:30 GMT` |
| Relative | `2 days ago`, `in three weeks`, `yesterday`, `last Monday`, `just now` |
| Weekdays | `Monday` … `Sunday` |
| Semantic | `<time datetime="…">` text **and** the `datetime` attribute |
| Attributes | dates inside `title`, `aria-label`, `alt` tooltips |

It runs on every frame, follows dynamically loaded content via a
`MutationObserver`, and shows a per-tab badge with the number of fragments
removed.

## What it deliberately leaves alone

Removing "all dates" naively would shred normal pages, so a few things are kept
on purpose to avoid false positives:

- **Bare four-digit years** (`2024`) — they're indistinguishable from prices,
  counts, "Page 2024", model numbers, etc.
- **Bare month names** (`May`, `March`, `August`) — also ordinary English words
  ("you *may* go", "*march* forward"). A month is only removed when paired with
  a day or year.
- **Standalone clock times** (`3:45 PM`, `14:30`, a video player's
  `0:00 / 1:35:43`, scores, durations) — a time is removed *only* when it sits
  next to a date, so media players, schedules and scoreboards stay intact.
- **Two-number ratios / fractions** (`16:9`, `1/2`) and **version strings /
  IPs** (`1.2.3`) — numeric dates need all three components with a 2-digit-capped
  middle field, so these aren't touched.
- **Code**: `<pre>`, `<code>`, `<kbd>`, `<samp>`, editable fields, and
  `<script>`/`<style>` are skipped.

## Install (load unpacked)

1. Clone or download this folder.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this directory.
5. Open `examples/demo.html` to see it in action.

No build step is required — the icons are already generated and committed.

## Settings

Click the toolbar icon for a small popup:

- **Remove dates** — master on/off switch.
- **Disable on this site** — per-hostname opt-out for pages where you'd rather
  keep dates.
- A count of how many dates were removed on the current page.

Changing a toggle reloads the active tab so it takes effect. (Because the
original text is physically removed, turning the extension back on / off is
applied on the next page load rather than retroactively.)

## Project layout

```
manifest.json            MV3 manifest
src/date-stripper.js     pure date/time matching logic (no DOM, no deps)
src/content.js           DOM walking, mutation observing, attribute cleanup
src/background.js         service worker that paints the toolbar badge
popup/                   popup UI (toggles + count)
icons/                   generated PNG icons
tools/make-icons.js      regenerates the icons (uses only Node's zlib)
test/                    Node test suites (no dependencies)
examples/demo.html       manual test page
```

## Development

Everything is dependency-free; you only need Node to run the tests.

```bash
npm test               # runs both suites
node tools/make-icons.js   # regenerate icons after tweaking the artwork
```

- `test/date-stripper.test.js` — ~80 cases covering what should be removed,
  what must be kept, edge cases, and a backtracking/performance guard.
- `test/content.integration.test.js` — loads the real `content.js` against a
  minimal mock DOM to verify the skip rules, attribute handling and
  `<time>`/`datetime` removal.

The matching logic lives entirely in `src/date-stripper.js`. It's written to
run unchanged both as a content script and under Node, so the same code that
ships is the code under test. To add or tighten a pattern, edit the ordered
`SOURCES` list there and add a case to the test suite.

## Notes & limitations

- A date split across multiple elements (e.g. `<span>January</span>
  <span>1, 2024</span>`) is handled per-text-node, so the day/year still goes
  but a stray month word can remain. Fully reconstructing text across element
  boundaries is intentionally out of scope to keep the DOM intact.
- There may be a brief flash of dates before the first pass on very large
  pages; matching is fast (~90k characters in ~10 ms) but not instant.

## License

MIT

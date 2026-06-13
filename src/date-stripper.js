/*
 * date-stripper.js
 *
 * Pure, dependency-free logic for finding and removing dates and times from
 * a string. Designed to run unchanged both as a Chrome content script and in
 * Node.js (for the test suite).
 *
 * The single entry point is `stripDates(text)` which returns
 * `{ text, removed }` where `text` is the cleaned string and `removed` is the
 * number of date/time fragments that were stripped out.
 *
 * Philosophy: be aggressive about things that are unambiguously dates/times,
 * but avoid the classic false positives that would mangle a page:
 *   - bare 4-digit years (would nuke prices, counts, "Page 2024", ...)
 *   - bare month names like "May", "March", "August" (also common words)
 *   - two-part numbers like "1/2" (fractions) or "16:9" (ratios)
 *   - version strings / IPs / phone numbers (middle component capped at 2 digits)
 */
(function (root) {
  "use strict";

  // Whitespace gap used inside multi-word phrases. `\s` already covers the
  // non-breaking space variants ( ,  , ...).
  var S = "\\s+";

  var MONTHS =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|" +
    "Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|" +
    "Dec(?:ember)?)\\.?";

  // Weekday names - full and abbreviated. Used as an optional prefix inside
  // larger date patterns (e.g. "Mon, 15 Jan 2024").
  var DOW =
    "(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|" +
    "Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\\.?";

  // Full weekday names only - safe to strip on their own because none of them
  // are ordinary English words (unlike abbreviations such as "Sat"/"Sun"/"Mar").
  var DOW_FULL =
    "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";

  var ORD = "(?:st|nd|rd|th)";
  var DAY = "\\d{1,2}" + ORD + "?"; // 1, 15, 15th, 3rd ...

  // Horizontal whitespace only (so am/pm etc. can't reach across a line break).
  var H = "[ \\t\\u00A0\\u202F]";

  // A clock time: requires HH:MM (minutes are exactly two digits, so "16:9"
  // aspect ratios and "2:1" scores are left alone). Optional seconds, optional
  // fractional seconds, optional am/pm, optional timezone.
  var TZ_BODY =
    "(?:Z|GMT|UTC|UT|[ECMP][SD]T|BST|CET|CEST|IST|JST|[+-]\\d{2}:?\\d{2})";
  var TZ = "(?:" + H + "*" + TZ_BODY + "\\b)?";
  var AMPM = "(?:" + H + "*[AaPp]\\.?[Mm]\\.?)?";
  var CLOCK = "\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?";
  // Times are ONLY ever removed as the trailing part of a date match (patterns
  // 2-3, plus the ISO timestamp in pattern 1) - never on their own. That keeps
  // bare clock values such as a video player's "0:00 / 1:35:43", schedules and
  // scores fully intact. `TIME` and `HOUR_AMPM` therefore only ever appear
  // appended to a date.
  var TIME = CLOCK + AMPM + TZ;
  // The time half of e.g. "Jan 1 at 3pm" / "Jan 1 at 11 a.m."
  var HOUR_AMPM = "\\d{1,2}" + H + "*[AaPp]\\.?[Mm]\\.?";

  // Number words used by relative-date phrases ("two days ago", "a week ago").
  var NUMWORD =
    "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|" +
    "couple(?:" + S + "of)?|few|several)";
  var UNIT =
    "(?:sec(?:ond)?|min(?:ute)?|hour|day|week|fortnight|month|year|decade|" +
    "century|centuries)";
  var COUNT = "(?:\\d+|" + NUMWORD + ")";

  // ---- The ordered list of removal patterns -------------------------------
  // Order matters: the most specific / longest patterns come first so they can
  // consume a whole timestamp before a smaller pattern nibbles a piece of it.
  var SOURCES = [
    // 1. ISO 8601 date-time, e.g. 2024-01-15T14:30:00.000Z, 2024-01-15 14:30
    "\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?" +
      "(?:Z|[+-]\\d{2}:?\\d{2})?\\b",

    // 2. Weekday? + Month Day, Year (+ optional time)  e.g.
    //    "Monday, January 15, 2024", "Jan 1 2024 at 3:45 PM"
    "(?:" + DOW + ",?" + S + ")?" + MONTHS + S + DAY + ",?" + S + "\\d{2,4}" +
      "(?:" + S + "(?:at" + S + ")?(?:" + TIME + "|" + HOUR_AMPM + "))?",

    // 3. Weekday? + Day Month Year (+ optional time)  e.g.
    //    "Mon, 15 Jan 2024 14:30:00 GMT", "15th of December 2023"
    "(?:" + DOW + ",?" + S + ")?" + DAY + S + "(?:of" + S + ")?" + MONTHS +
      ",?" + S + "\\d{2,4}" +
      "(?:" + S + "(?:at" + S + ")?(?:" + TIME + "|" + HOUR_AMPM + "))?",

    // 4. Month + 4-digit year, e.g. "January 2024", "Dec 2023"
    "\\b" + MONTHS + S + "\\d{4}\\b",

    // 5. Month + Day (no year), e.g. "December 25", "Jan 1st"
    "\\b" + MONTHS + S + DAY + "\\b",

    // 6. Day + Month (no year), e.g. "25 December", "1st of Jan"
    "\\b" + DAY + S + "(?:of" + S + ")?" + MONTHS + "\\b",

    // 7. Numeric date, year first: 2024-01-15, 2024/01/15, 2024.01.15
    "\\b\\d{4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,2}\\b",

    // 8. Numeric date, day/month first: 15/01/2024, 1-15-24, 31.12.2023
    //    (middle component capped at 2 digits to dodge phone numbers / versions)
    "\\b\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}\\b",

    // 9. Year range, e.g. "2020-2024", "1999-2001"
    "\\b(?:19|20)\\d{2}" + H + "*[-\\u2013\\u2014]" + H + "*(?:19|20)?\\d{2}\\b",

    // 10. Relative: "2 days ago", "a week from now", "ten minutes earlier"
    "\\b" + COUNT + S + UNIT + "s?" + S +
      "(?:ago|from" + S + "now|later|earlier|ahead|hence|prior)\\b",

    // 11. Relative: "in 3 days", "in a week"
    "\\bin" + S + COUNT + S + UNIT + "s?\\b",

    // 12. Relative: "last week", "next Monday", "this month", "coming December"
    "\\b(?:last|next|this|these|past|previous|coming|upcoming)" + S +
      "(?:" + DOW_FULL + "|" + MONTHS + "|weekend|week|fortnight|month|year|" +
      "decade|century|morning|afternoon|evening|night|spring|summer|fall|" +
      "autumn|winter|quarter)\\b",

    // 13. Relative phrases (multi-word first so they win over single words)
    "\\bthe" + S + "day" + S + "(?:before" + S + "yesterday|after" + S +
      "tomorrow)\\b",
    "\\ba" + S + "(?:moment|while|bit)" + S + "ago\\b",
    "\\bmoments?" + S + "ago\\b",
    "\\b(?:just|right)" + S + "now\\b",
    "\\b(?:yesterday|today|tomorrow|tonight)\\b",

    // 14. Standalone full weekday names, e.g. "Monday"
    "\\b" + DOW_FULL + "\\b"
  ];

  var PATTERNS = SOURCES.map(function (src) {
    return new RegExp(src, "gi");
  });

  // Cleanup patterns for the whitespace / punctuation litter left by removals.
  var RE_WS_RUN = new RegExp(H + "{2,}", "g");
  var RE_WS_BEFORE_PUNCT = new RegExp(H + "+([,.;:!?)\\]])", "g");
  var RE_WS_AFTER_OPEN = new RegExp("([(\\[])" + H + "+", "g");
  var RE_REPEAT_SEP = new RegExp("([,;:])(?:" + H + "*[,;:])+", "g");
  var RE_EMPTY_PAREN = new RegExp("\\(" + H + "*\\)", "g");
  var RE_EMPTY_BRACK = new RegExp("\\[" + H + "*\\]", "g");
  var RE_EMPTY_QUOTE = new RegExp("\\u201C" + H + "*\\u201D", "g");
  var RE_LEADING_SEP = new RegExp("^" + H + "*[,;:]" + H + "*");
  var RE_WS_ONLY = /^[\s.,;:!?-]*$/;

  function cleanup(out) {
    return out
      .replace(RE_WS_RUN, " ")
      .replace(RE_WS_BEFORE_PUNCT, "$1")
      .replace(RE_WS_AFTER_OPEN, "$1")
      .replace(RE_REPEAT_SEP, "$1")
      .replace(RE_EMPTY_PAREN, "")
      .replace(RE_EMPTY_BRACK, "")
      .replace(RE_EMPTY_QUOTE, "")
      .replace(RE_LEADING_SEP, "");
  }

  /**
   * Remove dates and times from `text`.
   * @param {string} text
   * @returns {{ text: string, removed: number }}
   */
  function stripDates(text) {
    if (typeof text !== "string" || text.length === 0) {
      return { text: text, removed: 0 };
    }
    var out = text;
    var removed = 0;
    for (var i = 0; i < PATTERNS.length; i++) {
      out = out.replace(PATTERNS[i], function (match) {
        // ignore "matches" that are only whitespace/punctuation
        if (RE_WS_ONLY.test(match)) {
          return match;
        }
        removed++;
        return "";
      });
    }
    if (removed === 0) {
      return { text: text, removed: 0 };
    }
    return { text: cleanup(out), removed: removed };
  }

  var api = { stripDates: stripDates };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  // Expose on the global object for use as a content script.
  root.DateStripper = api;
})(typeof self !== "undefined" ? self : this);

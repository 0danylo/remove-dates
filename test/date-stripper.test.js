/*
 * Tests for the pure date-stripping logic. Run with: `node test/date-stripper.test.js`
 * No external dependencies - a tiny hand-rolled harness keeps the extension
 * install-free.
 */
"use strict";

var assert = require("assert");
var stripDates = require("../src/date-stripper.js").stripDates;

var pass = 0;
var fail = 0;
var failures = [];

// Assert that `input` becomes exactly `expected` and at least one date was removed.
function removes(input, expected) {
  var result = stripDates(input);
  try {
    assert.strictEqual(result.text, expected);
    assert.ok(result.removed > 0, "expected removed > 0");
    pass++;
  } catch (e) {
    fail++;
    failures.push(
      "REMOVES failed:\n  input:    " + JSON.stringify(input) +
        "\n  expected: " + JSON.stringify(expected) +
        "\n  actual:   " + JSON.stringify(result.text) +
        "\n  removed:  " + result.removed
    );
  }
}

// Assert that `input` is returned untouched (no false positives).
function keeps(input) {
  var result = stripDates(input);
  try {
    assert.strictEqual(result.text, input);
    assert.strictEqual(result.removed, 0);
    pass++;
  } catch (e) {
    fail++;
    failures.push(
      "KEEPS failed (false positive):\n  input:  " + JSON.stringify(input) +
        "\n  actual: " + JSON.stringify(result.text) +
        "\n  removed: " + result.removed
    );
  }
}

// Assert a date is removed without pinning the exact leftover text.
function clears(input) {
  var result = stripDates(input);
  try {
    assert.ok(result.removed > 0, "expected something to be removed");
    assert.ok(
      result.text.trim().length < input.trim().length,
      "expected output to be shorter"
    );
    pass++;
  } catch (e) {
    fail++;
    failures.push(
      "CLEARS failed:\n  input:  " + JSON.stringify(input) +
        "\n  actual: " + JSON.stringify(result.text) +
        "\n  removed: " + result.removed
    );
  }
}

/* ----------------------------- ISO / numeric ----------------------------- */
removes("2024-01-15", "");
removes("2024/01/15", "");
removes("2024.01.15", "");
removes("2024-01-15T14:30:00Z", "");
removes("2024-01-15T14:30:00.000Z", "");
removes("2024-01-15 14:30", "");
removes("2024-01-15T09:00:00+02:00", "");
removes("01/15/2024", "");
removes("15/01/2024", "");
removes("1/15/24", "");
removes("31.12.2023", "");
removes("12-25-2024", "");

/* ------------------------------- textual --------------------------------- */
removes("January 15, 2024", "");
removes("Jan 15, 2024", "");
removes("Jan. 15, 2024", "");
removes("15 January 2024", "");
removes("15th January 2024", "");
removes("1st of January 2020", "");
removes("Monday, January 15, 2024", "");
removes("Mon, 15 Jan 2024 14:30:00 GMT", "");
removes("Sunday, 1 Dec 2023", "");
removes("January 2024", "");
removes("Dec 2023", "");
removes("December 25", "");
removes("Dec 25", "");
removes("25 December", "");
removes("It happened on January 15, 2024.", "It happened on.");
removes("Published on Jan 1, 2024 by staff", "Published on by staff");
removes("See you Monday!", "See you!");

/* -------------------------------- times ---------------------------------- */
// Standalone times are ALWAYS kept - only a time sitting next to a date goes.
keeps("3:45 PM");
keeps("3:45PM");
keeps("3pm");
keeps("11 a.m.");
keeps("14:30");
keeps("09:00 UTC");
keeps("09:00:00");
keeps("11:59:59.999");
keeps("Doors open at 7:30 PM sharp");
// Video-player positions / durations - the YouTube case that prompted this.
keeps("0:00 / 1:35:43");
keeps("0:00");
keeps("1:35:43");
keeps("90:00");

// A time attached to a date is still removed together with the date.
removes("Meeting January 5, 2024 at 14:30 sharp", "Meeting sharp");
removes("Doors open Jan 1, 2024 at 7:30 PM sharp", "Doors open sharp");

/* ------------------------------ relative --------------------------------- */
removes("2 days ago", "");
removes("5 minutes ago", "");
removes("a week ago", "");
removes("ten minutes earlier", "");
removes("three years from now", "");
removes("in 3 days", "");
removes("in a week", "");
removes("yesterday", "");
removes("tomorrow", "");
removes("tonight", "");
removes("last week", "");
removes("next Monday", "");
removes("this month", "");
removes("the day before yesterday", "");
removes("just now", "");
removes("a moment ago", "");

/* --------------------- combined / real-world snippets -------------------- */
// trailing whitespace is intentionally preserved (it can be significant
// between inline DOM elements), so these keep a trailing space.
removes("Posted 2 hours ago", "Posted ");
removes("Updated: 2024-01-15T14:30:00Z", "Updated: ");
clears("Event runs Jan 1 - Jan 5, 2024 downtown");
clears("Born 15/01/1990 in Paris");
clears("Monday Tuesday Wednesday Thursday Friday");

// "today" is itself a relative date and is removed by design.
removes("Today was a good day", " was a good day");

/* ---------------- false positives that must NOT be touched --------------- */
keeps("1/2 cup of flour");
keeps("Version 1.2.3 released");
keeps("The ratio is 16:9 on screen");
keeps("Final score 2:1");
keeps("Call 555-123-4567 now");
keeps("Room 101");
keeps("Pier 39");
keeps("You may go now");
keeps("march forward together");
keeps("The sun is bright");
keeps("I am happy");
keeps("5 apples and 3 oranges");
keeps("30 minutes of exercise");
keeps("Meet me in second place");
keeps("Page 2024 of the book");
keeps("It costs $2024");
keeps("Chapter 12 begins");
keeps("Highway 101 North");

/* ------------------------------- edge cases ------------------------------ */
(function () {
  // non-string / empty input must not throw
  var r1 = stripDates("");
  assert.strictEqual(r1.text, "");
  assert.strictEqual(r1.removed, 0);
  var r2 = stripDates(null);
  assert.strictEqual(r2.text, null);
  var r3 = stripDates(undefined);
  assert.strictEqual(r3.text, undefined);
  pass += 3;
})();

(function () {
  // performance / no catastrophic backtracking on a long string
  var big = "lorem Jan 1, 2024 12:34 ipsum ".repeat(5000) + "no closing date here";
  var start = Date.now();
  var r = stripDates(big);
  var ms = Date.now() - start;
  assert.ok(ms < 1000, "stripDates too slow: " + ms + "ms");
  assert.ok(r.removed > 0);
  pass++;
  console.log("  (processed " + big.length + " chars in " + ms + "ms)");
})();

/* -------------------------------- report --------------------------------- */
console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("\n--- failures ---\n" + failures.join("\n\n"));
  process.exit(1);
}

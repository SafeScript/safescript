/**
 * SafeScript 2.0 — Journal (write-ahead log with read overlay).
 *
 * During a debug session, writes go to the journal instead of mutating
 * real state. Reads check the journal first, then fall through to the
 * real object. Time travel is cursor movement through the log.
 * Commit applies all writes for real. Discard clears everything.
 *
 * The overlay uses a two-level structure: Map<object, Map<string, value>>
 * for fast lookup by target + key.
 */
'use strict';

// Unique token for "this key exists in overlay with value undefined"
var UNDEF_SENTINEL = Object.freeze({ __journalUndef: true });

/**
 * Journal — write-ahead log with read overlay.
 */
function Journal() {
  this._log = [];                // ordered list of all writes
  this._overlay = new Map();     // target → Map(key → value)
  this._externals = [];          // external effects (method calls, API calls)
  this._cursor = 0;              // current position (for time travel)
  this._stepIndex = -1;          // current debug step index (set by debug session)
  this._targetIndex = new Map(); // target → [log indices] — reverse lookup
}

/**
 * Record a property write. The real object is NOT mutated.
 *
 * @param {Object} target - The object being written to
 * @param {string} key - The property name
 * @param {*} oldValue - The value before the write
 * @param {*} newValue - The value being written
 */
Journal.prototype.write = function(target, key, oldValue, newValue) {
  var logIndex = this._log.length;
  this._log.push({
    index: logIndex,
    target: target,
    key: key,
    was: oldValue,
    to: newValue,
    step: this._stepIndex   // which debug step caused this write
  });

  // Update overlay
  if (!this._overlay.has(target)) {
    this._overlay.set(target, new Map());
  }
  this._overlay.get(target).set(key, newValue === undefined ? UNDEF_SENTINEL : newValue);

  // Update reverse index
  if (!this._targetIndex.has(target)) {
    this._targetIndex.set(target, []);
  }
  this._targetIndex.get(target).push(logIndex);

  this._cursor = this._log.length;
};

/**
 * Set the current step index (called by debug session before each step).
 */
Journal.prototype.setStepIndex = function(stepIndex) {
  this._stepIndex = stepIndex;
};

/**
 * Reverse lookup: find all journal entries that touched a specific target.
 *
 * @param {Object} target - The object to look up
 * @param {string} [key] - Optional: filter to a specific property
 * @returns {Array} Log entries that wrote to this target, newest first
 */
Journal.prototype.queryTarget = function(target, key) {
  var indices = this._targetIndex.get(target);
  if (!indices) return [];

  var results = [];
  for (var i = indices.length - 1; i >= 0; i--) {
    var idx = indices[i];
    if (idx < this._log.length) {
      var entry = this._log[idx];
      if (!key || entry.key === key) {
        results.push(entry);
      }
    }
  }
  return results;
};

/**
 * Reverse lookup: get unique step indices that touched a target.
 *
 * @param {Object} target - The object to look up
 * @param {string} [key] - Optional: filter to a specific property
 * @returns {Array<number>} Step indices, newest first, deduplicated
 */
Journal.prototype.queryTargetSteps = function(target, key) {
  var entries = this.queryTarget(target, key);
  var seen = {};
  var steps = [];
  for (var i = 0; i < entries.length; i++) {
    var s = entries[i].step;
    if (s >= 0 && !seen[s]) {
      seen[s] = true;
      steps.push(s);
    }
  }
  return steps;
};

/**
 * Read a property. Checks the overlay first, then falls through to the real object.
 *
 * @param {Object} target - The object to read from
 * @param {string} key - The property name
 * @returns {*} The value (from overlay if written, otherwise from real object)
 */
Journal.prototype.read = function(target, key) {
  var targetOverlay = this._overlay.get(target);
  if (targetOverlay && targetOverlay.has(key)) {
    var val = targetOverlay.get(key);
    return val === UNDEF_SENTINEL ? undefined : val;
  }
  return target[key];
};

/**
 * Check if a property has been written in the journal.
 */
Journal.prototype.has = function(target, key) {
  var targetOverlay = this._overlay.get(target);
  return !!(targetOverlay && targetOverlay.has(key));
};

/**
 * Record an external side effect (method call, API call, etc.).
 * These are displayed in the effects timeline but not automatically committed.
 * The host's onCommit callback decides what to do with them.
 */
Journal.prototype.writeExternal = function(entry) {
  entry.index = this._externals.length;
  this._externals.push(entry);
};

/**
 * Get all log entries.
 */
Journal.prototype.entries = function() {
  return this._log.slice(0);
};

/**
 * Get all external entries.
 */
Journal.prototype.externalEntries = function() {
  return this._externals.slice(0);
};

/**
 * Get the current cursor position.
 */
Journal.prototype.getCursor = function() {
  return this._cursor;
};

/**
 * Time travel: rewind the overlay to a specific log index.
 * Rebuilds the overlay from log[0..stepIndex].
 *
 * @param {number} stepIndex - The log index to rewind to (inclusive)
 */
Journal.prototype.rewindTo = function(stepIndex) {
  if (stepIndex < 0) stepIndex = 0;
  if (stepIndex > this._log.length) stepIndex = this._log.length;

  // Clear and rebuild the overlay and target index
  this._overlay = new Map();
  this._targetIndex = new Map();
  for (var i = 0; i < stepIndex && i < this._log.length; i++) {
    var entry = this._log[i];
    if (!this._overlay.has(entry.target)) {
      this._overlay.set(entry.target, new Map());
    }
    this._overlay.get(entry.target).set(entry.key,
      entry.to === undefined ? UNDEF_SENTINEL : entry.to);

    if (!this._targetIndex.has(entry.target)) {
      this._targetIndex.set(entry.target, []);
    }
    this._targetIndex.get(entry.target).push(i);
  }

  // Truncate log entries after the cursor (they're from a future that's being rewritten)
  this._log.length = stepIndex;
  this._cursor = stepIndex;
};

/**
 * Commit: apply all journal writes to the real objects.
 * After commit, the overlay is cleared.
 *
 * @returns {{ writes: number, externals: Array }} Summary of what was committed
 */
Journal.prototype.commit = function() {
  var writeCount = 0;
  for (var i = 0; i < this._log.length; i++) {
    var entry = this._log[i];
    entry.target[entry.key] = entry.to;
    writeCount++;
  }
  var externals = this._externals.slice(0);
  this.clear();
  return { writes: writeCount, externals: externals };
};

/**
 * Discard: clear all writes without applying them.
 */
Journal.prototype.clear = function() {
  this._log = [];
  this._overlay = new Map();
  this._externals = [];
  this._targetIndex = new Map();
  this._cursor = 0;
  this._stepIndex = -1;
};

/**
 * Get a summary of the journal state.
 */
Journal.prototype.summary = function() {
  return {
    writes: this._log.length,
    externals: this._externals.length,
    cursor: this._cursor
  };
};

exports.Journal = Journal;

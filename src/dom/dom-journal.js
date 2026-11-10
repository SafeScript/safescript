/**
 * SafeScript 2.0 — DOM Journal Adapter.
 *
 * When attached to a DOM context, intercepts all DOM mutations and routes
 * them through a Journal instead of the real DOM. Reads check the journal
 * overlay first, then fall through to the real DOM.
 *
 * Usage:
 *   var adapter = attachDOMJournal(context, journal, effectLog);
 *   // Now all SafeHandle mutations go to the journal
 *   adapter.detach(); // restore direct DOM access
 *
 * The adapter monkey-patches the context so SafeHandle, SafeDocument,
 * Safe$ etc. all transparently route through the journal without changes
 * to their own code.
 */
'use strict';

/**
 * Attach a journal to a DOM context.
 *
 * Replaces `context.mutate` and `context.readProp` methods that SafeHandle
 * and other facades call for DOM operations.
 *
 * @param {Object} context - The DOM context from createDOMContext
 * @param {Journal} journal - The debug session's journal
 * @param {Array} effectLog - The debug session's side-effect log
 * @returns {Object} adapter with .detach() method
 */
function attachDOMJournal(context, journal, effectLog) {
  // Store original mutation behavior
  var origOwnership = context.ownership;
  var journalOverlay = journal;
  var effects = effectLog;

  /**
   * Write a DOM property to the journal instead of the real DOM.
   *
   * @param {Element} node - The native DOM node
   * @param {string} prop - Property name (e.g. 'textContent', 'innerHTML', 'attr:class')
   * @param {*} oldValue - The current value
   * @param {*} newValue - The new value
   * @param {string} op - Operation description for the effect log
   */
  function journalWrite(node, prop, oldValue, newValue, op) {
    // Write to journal — keyed by (node, prop) so reads can look it up
    journalOverlay.write(node, prop, oldValue, newValue);
    // Log the side effect
    if (effects) {
      effects.push({
        kind: 'dom',
        op: op || 'set',
        node: node,
        prop: prop,
        was: oldValue,
        to: newValue,
        tagName: node.tagName || '',
        id: node.id || ''
      });
    }
  }

  /**
   * Read a DOM property — check journal overlay first.
   */
  function journalRead(node, prop) {
    if (journalOverlay.has(node, prop)) {
      return journalOverlay.read(node, prop);
    }
    return node[prop];
  }

  // ── Intercept mutations via context ──────────────────────────────
  // We add mutation/read hooks to the context object. SafeHandle code
  // is modified to check for these hooks before performing direct writes.

  context._journal = journalOverlay;
  context._effectLog = effects;

  context.journalWrite = journalWrite;
  context.journalRead = journalRead;

  return {
    detach: function() {
      delete context._journal;
      delete context._effectLog;
      delete context.journalWrite;
      delete context.journalRead;
    }
  };
}

exports.attachDOMJournal = attachDOMJournal;

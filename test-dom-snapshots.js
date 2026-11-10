/**
 * SafeScript 2.0 — DOM Snapshots, Reverse Lookup, and Time Travel Tests
 *
 * Tests:
 *   1. DOM snapshots: capture innerHTML, restore, find nearest
 *   2. Reverse lookup: query which steps touched a node
 *   3. Node timeline: get a change history for a specific element
 *   4. Step-indexed journal entries
 *   5. Journal queryTarget / queryTargetSteps
 */
'use strict';

var Journal = require('./src/journal').Journal;
var DebugSession = require('./src/debug').DebugSession;
var attachDOMJournal = require('./src/dom/dom-journal').attachDOMJournal;

var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch(e) {
    failed++;
    console.error('  ✗ ' + name);
    console.error('    ' + (e.stack || e.message));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── Mock DOM ────────────────────────────────────────────────────────

function mockRoot(html) {
  return {
    tagName: 'DIV',
    id: 'root',
    innerHTML: html || '',
    textContent: ''
  };
}

function mockNode(tag, id) {
  return {
    tagName: tag || 'DIV',
    id: id || '',
    textContent: '',
    _attrs: {},
    getAttribute: function(n) { return this._attrs[n] || null; },
    setAttribute: function(n, v) { this._attrs[n] = v; }
  };
}

// ── Journal: step-indexed writes ────────────────────────────────────

console.log('\n══ Journal: step-indexed writes ══\n');

test('writes carry step index', function() {
  var j = new Journal();
  var obj = { x: 1 };
  j.setStepIndex(0);
  j.write(obj, 'x', 1, 2);
  j.setStepIndex(1);
  j.write(obj, 'x', 2, 3);

  var entries = j.entries();
  assert(entries[0].step === 0, 'first write step should be 0');
  assert(entries[1].step === 1, 'second write step should be 1');
});

test('writes with no step index get -1', function() {
  var j = new Journal();
  var obj = { x: 1 };
  j.write(obj, 'x', 1, 2);
  assert(j.entries()[0].step === -1, 'step should be -1');
});

// ── Journal: reverse lookup ─────────────────────────────────────────

console.log('\n══ Journal: reverse lookup (queryTarget) ══\n');

test('queryTarget returns entries for a target', function() {
  var j = new Journal();
  var a = { x: 1 };
  var b = { y: 2 };
  j.setStepIndex(0);
  j.write(a, 'x', 1, 10);
  j.setStepIndex(1);
  j.write(b, 'y', 2, 20);
  j.setStepIndex(2);
  j.write(a, 'x', 10, 100);

  var results = j.queryTarget(a);
  assert(results.length === 2, 'should find 2 entries for a: ' + results.length);
  // Newest first
  assert(results[0].to === 100, 'newest first');
  assert(results[1].to === 10, 'oldest last');
});

test('queryTarget with key filter', function() {
  var j = new Journal();
  var obj = {};
  j.write(obj, 'x', 0, 1);
  j.write(obj, 'y', 0, 2);
  j.write(obj, 'x', 1, 3);

  var xOnly = j.queryTarget(obj, 'x');
  assert(xOnly.length === 2, 'should find 2 entries for x');
  assert(xOnly[0].to === 3);
  assert(xOnly[1].to === 1);

  var yOnly = j.queryTarget(obj, 'y');
  assert(yOnly.length === 1, 'should find 1 entry for y');
});

test('queryTarget returns empty for untouched target', function() {
  var j = new Journal();
  var a = {};
  var b = {};
  j.write(a, 'x', 0, 1);
  assert(j.queryTarget(b).length === 0, 'b should have no entries');
});

test('queryTargetSteps returns deduplicated step indices', function() {
  var j = new Journal();
  var obj = {};
  j.setStepIndex(0);
  j.write(obj, 'x', 0, 1);
  j.write(obj, 'y', 0, 2);  // same step, different key
  j.setStepIndex(1);
  j.write(obj, 'x', 1, 3);

  var steps = j.queryTargetSteps(obj);
  assert(steps.length === 2, 'should have 2 unique steps: ' + steps.length);
  assert(steps[0] === 1, 'newest step first');
  assert(steps[1] === 0, 'oldest step last');
});

test('queryTargetSteps with key filter', function() {
  var j = new Journal();
  var obj = {};
  j.setStepIndex(0);
  j.write(obj, 'x', 0, 1);
  j.setStepIndex(1);
  j.write(obj, 'y', 0, 2);
  j.setStepIndex(2);
  j.write(obj, 'x', 1, 3);

  var xSteps = j.queryTargetSteps(obj, 'x');
  assert(xSteps.length === 2, 'x touched in 2 steps');
  assert(xSteps[0] === 2);
  assert(xSteps[1] === 0);

  var ySteps = j.queryTargetSteps(obj, 'y');
  assert(ySteps.length === 1, 'y touched in 1 step');
  assert(ySteps[0] === 1);
});

test('rewindTo rebuilds target index', function() {
  var j = new Journal();
  var obj = {};
  j.setStepIndex(0);
  j.write(obj, 'x', 0, 1);
  j.setStepIndex(1);
  j.write(obj, 'x', 1, 2);
  j.setStepIndex(2);
  j.write(obj, 'x', 2, 3);

  j.rewindTo(2); // keep first 2 entries (step 0 and 1)
  var results = j.queryTarget(obj);
  assert(results.length === 2, 'after rewind to 2, should have 2 entries');
  assert(results[0].to === 2, 'newest should be step 1 write');
});

// ── DebugSession: DOM snapshots ─────────────────────────────────────

console.log('\n══ DebugSession: DOM snapshots ══\n');

test('snapshotDOM captures innerHTML', function() {
  var session = new DebugSession({});
  var root = mockRoot('<p>Hello</p>');
  session.setDOMRoot(root);

  var snap = session.snapshotDOM();
  assert(snap !== null, 'should return snapshot');
  assert(snap.html === '<p>Hello</p>', 'should capture innerHTML');
  assert(snap.stepIndex === 0, 'step index should be 0');
});

test('snapshotDOM returns null without root', function() {
  var session = new DebugSession({});
  assert(session.snapshotDOM() === null, 'should return null');
});

test('restoreDOM sets innerHTML back', function() {
  var session = new DebugSession({});
  var root = mockRoot('<p>Original</p>');
  session.setDOMRoot(root);

  session.snapshotDOM(); // index 0
  root.innerHTML = '<p>Modified</p>';
  session.restoreDOM(0);
  assert(root.innerHTML === '<p>Original</p>', 'should restore original HTML');
});

test('multiple snapshots at different states', function() {
  var session = new DebugSession({});
  var root = mockRoot('<p>V1</p>');
  session.setDOMRoot(root);

  session.snapshotDOM(); // index 0
  root.innerHTML = '<p>V2</p>';
  session.snapshotDOM(); // index 1
  root.innerHTML = '<p>V3</p>';

  session.restoreDOM(0);
  assert(root.innerHTML === '<p>V1</p>', 'restore to V1');
  session.restoreDOM(1);
  assert(root.innerHTML === '<p>V2</p>', 'restore to V2');
});

test('findSnapshotBefore returns nearest', function() {
  var session = new DebugSession({});
  var root = mockRoot('');
  session.setDOMRoot(root);

  session.history.push({ index: 0, line: 1 });
  session.history.push({ index: 1, line: 2 });
  session.history.push({ index: 2, line: 3 });
  session.history.push({ index: 3, line: 4 });
  session.history.push({ index: 4, line: 5 });

  // Snapshots at step 0, 2, 4
  session.history.length = 1; // reset for snapshot stepIndex
  session.snapshotDOM(); // stepIndex = 1
  session.history.length = 3;
  session.snapshotDOM(); // stepIndex = 3
  session.history.length = 5;
  session.snapshotDOM(); // stepIndex = 5

  assert(session.findSnapshotBefore(5) === 2, 'at step 5, nearest is snapshot 2');
  assert(session.findSnapshotBefore(4) === 1, 'at step 4, nearest is snapshot 1');
  assert(session.findSnapshotBefore(1) === 0, 'at step 1, nearest is snapshot 0');
  assert(session.findSnapshotBefore(0) === -1, 'at step 0, no snapshot');
});

test('commit auto-snapshots DOM', function() {
  var session = new DebugSession({});
  var root = mockRoot('<p>Before</p>');
  session.setDOMRoot(root);

  // Write something to the journal so commit has something to do
  session.journal.write(root, 'textContent', '', 'After');

  session.commit();
  assert(session._domSnapshots.length === 1, 'should auto-snapshot on commit');
  assert(session._domSnapshots[0].html === '<p>Before</p>', 'snapshot is pre-commit state');
});

// ── DebugSession: node history queries ──────────────────────────────

console.log('\n══ DebugSession: node reverse lookup ══\n');

test('queryNodeHistory returns journal entries for a node', function() {
  var session = new DebugSession({});
  var node = mockNode('DIV', 'target');

  session.journal.setStepIndex(0);
  session.journal.write(node, 'textContent', '', 'hello');
  session.journal.setStepIndex(1);
  session.journal.write(node, 'attr:class', null, 'active');
  session.journal.setStepIndex(2);
  session.journal.write(node, 'textContent', 'hello', 'world');

  var entries = session.queryNodeHistory(node);
  assert(entries.length === 3, 'should find 3 entries: ' + entries.length);
  assert(entries[0].to === 'world', 'newest first');
  assert(entries[2].to === 'hello', 'oldest last');
});

test('queryNodeHistory with prop filter', function() {
  var session = new DebugSession({});
  var node = mockNode('DIV');

  session.journal.setStepIndex(0);
  session.journal.write(node, 'textContent', '', 'hello');
  session.journal.setStepIndex(1);
  session.journal.write(node, 'attr:class', null, 'active');

  var textOnly = session.queryNodeHistory(node, 'textContent');
  assert(textOnly.length === 1, 'should find 1 textContent entry');
  assert(textOnly[0].to === 'hello');
});

test('queryNodeSteps returns step indices', function() {
  var session = new DebugSession({});
  var node = mockNode('DIV');

  session.journal.setStepIndex(0);
  session.journal.write(node, 'textContent', '', 'hello');
  session.journal.setStepIndex(3);
  session.journal.write(node, 'textContent', 'hello', 'world');
  session.journal.setStepIndex(5);
  session.journal.write(node, 'attr:class', null, 'done');

  var steps = session.queryNodeSteps(node);
  assert(steps.length === 3, 'touched in 3 steps');
  assert(steps[0] === 5, 'newest first');
  assert(steps[1] === 3);
  assert(steps[2] === 0, 'oldest last');
});

test('getNodeTimeline returns oldest-first timeline', function() {
  var session = new DebugSession({});
  var node = mockNode('SPAN');

  // Fake history for line numbers
  session.history = [
    { index: 0, line: 10 },
    { index: 1, line: 20 },
    { index: 2, line: 30 }
  ];

  session.journal.setStepIndex(0);
  session.journal.write(node, 'textContent', '', 'a');
  session.journal.setStepIndex(1);
  session.journal.write(node, 'style:color', '', 'red');
  session.journal.setStepIndex(2);
  session.journal.write(node, 'textContent', 'a', 'b');

  var timeline = session.getNodeTimeline(node);
  assert(timeline.length === 3, 'should have 3 events');

  // Oldest first
  assert(timeline[0].step === 0, 'first event is step 0');
  assert(timeline[0].line === 10, 'first event line is 10');
  assert(timeline[0].prop === 'textContent');
  assert(timeline[0].was === '');
  assert(timeline[0].to === 'a');

  assert(timeline[1].step === 1, 'second event is step 1');
  assert(timeline[1].prop === 'style:color');

  assert(timeline[2].step === 2, 'third event is step 2');
  assert(timeline[2].line === 30);
  assert(timeline[2].prop === 'textContent');
  assert(timeline[2].to === 'b');
});

test('getNodeTimeline for untouched node returns empty', function() {
  var session = new DebugSession({});
  var node = mockNode('P');
  assert(session.getNodeTimeline(node).length === 0);
});

// ── Integration: DOM journal + reverse lookup ───────────────────────

console.log('\n══ Integration: DOM journal + reverse lookup ══\n');

test('DOM journal writes are queryable by node', function() {
  var session = new DebugSession({});
  var context = { ownership: {} };
  attachDOMJournal(context, session.journal, session._effectLog);

  var node = mockNode('DIV', 'box');

  session.journal.setStepIndex(0);
  context.journalWrite(node, 'textContent', '', 'first', 'set');
  session.journal.setStepIndex(1);
  context.journalWrite(node, 'attr:class', null, 'highlight', 'setAttribute');
  session.journal.setStepIndex(2);
  context.journalWrite(node, 'style:color', '', 'blue', 'style-set');

  // All operations on this node
  var timeline = session.getNodeTimeline(node);
  assert(timeline.length === 3, 'timeline should have 3 events');
  assert(timeline[0].prop === 'textContent');
  assert(timeline[1].prop === 'attr:class');
  assert(timeline[2].prop === 'style:color');

  // Jump points for this node
  var steps = session.queryNodeSteps(node);
  assert(steps.length === 3);
  assert(steps[0] === 2, 'can jump to step 2');
  assert(steps[1] === 1, 'can jump to step 1');
  assert(steps[2] === 0, 'can jump to step 0');
});

test('after rewind, reverse lookup reflects truncated history', function() {
  var session = new DebugSession({});

  var node = mockNode('DIV');
  session.journal.setStepIndex(0);
  session.journal.write(node, 'x', 0, 1);
  session.journal.setStepIndex(1);
  session.journal.write(node, 'x', 1, 2);
  session.journal.setStepIndex(2);
  session.journal.write(node, 'x', 2, 3);

  // Rewind to step 1 (keep entries 0 and 1)
  session.journal.rewindTo(2);

  var results = session.queryNodeHistory(node);
  assert(results.length === 2, 'after rewind, should have 2 entries');
  assert(results[0].to === 2, 'newest surviving is step 1 write');
});

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

/**
 * SafeScript v1.3 — New Facade Tests
 *
 * Tests for SafeWindow, Safe$, SafeQ type registration,
 * header.js BUILTIN_TYPES, and browser bundle DOM integration.
 */
'use strict';

var passed = 0, failed = 0;
var currentGroup = '';

function group(name) { currentGroup = name; console.log('\n  ' + name); }

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('    ✓ ' + name);
  } catch(e) {
    failed++;
    console.error('    ✗ ' + name);
    console.error('      ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertThrows(fn, pattern) {
  try {
    fn();
    throw new Error('expected to throw but did not');
  } catch(e) {
    if (e.message === 'expected to throw but did not') throw e;
    if (pattern && e.message.indexOf(pattern) === -1) {
      throw new Error('wrong error: got "' + e.message + '", expected pattern "' + pattern + '"');
    }
  }
}

// ── Header.js — BUILTIN_TYPES registry ──────────────────────────────

var headerParser = require('./src/header');

group('BUILTIN_TYPES — new v1.3 entries');

test('SafeJQuery is registered', function() {
  assert(headerParser.BUILTIN_TYPES['SafeJQuery'], 'SafeJQuery should be in BUILTIN_TYPES');
  assert(headerParser.BUILTIN_TYPES['SafeJQuery'].scopeKey === '$');
  assert(headerParser.BUILTIN_TYPES['SafeJQuery'].provider === 'dom');
});

test('SafeQ is registered', function() {
  assert(headerParser.BUILTIN_TYPES['SafeQ'], 'SafeQ should be in BUILTIN_TYPES');
  assert(headerParser.BUILTIN_TYPES['SafeQ'].scopeKey === 'Q');
  assert(headerParser.BUILTIN_TYPES['SafeQ'].provider === 'dom');
});

test('SafeWindow is registered', function() {
  assert(headerParser.BUILTIN_TYPES['SafeWindow'], 'SafeWindow should be in BUILTIN_TYPES');
  assert(headerParser.BUILTIN_TYPES['SafeWindow'].scopeKey === 'window');
  assert(headerParser.BUILTIN_TYPES['SafeWindow'].provider === 'window');
});

test('All original types still present', function() {
  assert(headerParser.BUILTIN_TYPES['SafeDOMDocument']);
  assert(headerParser.BUILTIN_TYPES['SafeHTMLElement']);
  assert(headerParser.BUILTIN_TYPES['SafeConsole']);
  assert(headerParser.BUILTIN_TYPES['SafeObservers']);
  assert(headerParser.BUILTIN_TYPES['SafeCanvas']);
  assert(headerParser.BUILTIN_TYPES['SafeMedia']);
  assert(headerParser.BUILTIN_TYPES['SafeNavigation']);
});

group('resolveUses — new types');

test('resolveUses recognizes SafeJQuery', function() {
  var header = { uses: [{ name: '$', type: 'SafeJQuery' }] };
  var resolved = headerParser.resolveUses(header);
  assert(resolved.dom === true, 'SafeJQuery should activate dom provider');
});

test('resolveUses recognizes SafeQ', function() {
  var header = { uses: [{ name: 'Q', type: 'SafeQ' }] };
  var resolved = headerParser.resolveUses(header);
  assert(resolved.dom === true, 'SafeQ should activate dom provider');
});

test('resolveUses handles combined @uses', function() {
  var header = { uses: [
    { name: 'document', type: 'SafeDOMDocument' },
    { name: '$', type: 'SafeJQuery' },
    { name: 'Q', type: 'SafeQ' },
    { name: 'window', type: 'SafeWindow' }
  ]};
  var resolved = headerParser.resolveUses(header);
  assert(resolved.dom === true);
  assert(resolved.window === true);
  assert(resolved.usesEntries.length === 4);
});

group('parseHeader — @uses with new types');

test('parse @uses $: SafeJQuery', function() {
  var source = '/** @safescript 1.3\n * @uses $: SafeJQuery\n */\nvar x = 1;';
  var header = headerParser.parseHeader(source);
  assert(header.uses.length === 1);
  assert(header.uses[0].name === '$');
  assert(header.uses[0].type === 'SafeJQuery');
});

test('parse @uses Q: SafeQ', function() {
  var source = '/** @safescript 1.3\n * @uses Q: SafeQ\n */\nvar x = 1;';
  var header = headerParser.parseHeader(source);
  assert(header.uses.length === 1);
  assert(header.uses[0].name === 'Q');
  assert(header.uses[0].type === 'SafeQ');
});

// ── SafeWindow — unit tests (no browser DOM needed) ─────────────────

var safeWindowModule = require('./src/dom/safe-window');

group('SafeWindow — BLOCKED_WINDOW_PROPS');

test('document is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.document === 1);
});

test('location is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.location === 1);
});

test('eval is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.eval === 1);
});

test('fetch is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.fetch === 1);
});

test('localStorage is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.localStorage === 1);
});

test('crypto is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.crypto === 1);
});

test('Worker is blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.Worker === 1);
});

test('alert/confirm/prompt are blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.alert === 1);
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.confirm === 1);
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.prompt === 1);
});

test('open/close are blocked', function() {
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.open === 1);
  assert(safeWindowModule.BLOCKED_WINDOW_PROPS.close === 1);
});

// ── Safe$ — unit tests (structural, no DOM) ─────────────────────────

var safeJQueryModule = require('./src/dom/safe-jquery');

group('Safe$ — module exports');

test('createSafeJQuery is exported', function() {
  assert(typeof safeJQueryModule.createSafeJQuery === 'function');
});

// ── SafeQ — unit tests (structural, no DOM) ─────────────────────────

var safeQModule = require('./src/dom/safe-q');

group('SafeQ — module exports');

test('createSafeQ is exported', function() {
  assert(typeof safeQModule.createSafeQ === 'function');
});

// ── DOM index.js — updated exports ──────────────────────────────────

var domIndex = require('./src/dom/index');

group('DOM index — v1.3 type exports');

test('SafeWindow type exported', function() {
  assert(domIndex.SafeWindow === 'SafeWindow');
});

test('SafeJQuery type exported', function() {
  assert(domIndex.SafeJQuery === 'SafeJQuery');
});

test('SafeQ type exported', function() {
  assert(domIndex.SafeQ === 'SafeQ');
});

test('createDOMContext still exported', function() {
  assert(typeof domIndex.createDOMContext === 'function');
});

test('DEFAULT_TAGS still exported', function() {
  assert(Array.isArray(domIndex.DEFAULT_TAGS));
  assert(domIndex.DEFAULT_TAGS.length > 50);
});

// ── Browser bundle — build test ─────────────────────────────────────

group('Browser bundle — build integrity');

test('browser.js builds without error', function() {
  var cp = require('child_process');
  var result = cp.spawnSync('node', ['browser.js'], { cwd: __dirname, timeout: 10000 });
  assert(result.status === 0, 'browser.js should exit 0, got ' + result.status);
  var output = result.stdout.toString();
  assert(output.length > 100000, 'bundle should be >100KB, got ' + output.length);
});

test('bundle contains DOM modules', function() {
  var cp = require('child_process');
  var result = cp.spawnSync('node', ['browser.js'], { cwd: __dirname, timeout: 10000 });
  var output = result.stdout.toString();
  assert(output.indexOf('domSafeWindow') > -1, 'bundle should contain domSafeWindow');
  assert(output.indexOf('domSafeJQuery') > -1, 'bundle should contain domSafeJQuery');
  assert(output.indexOf('domSafeQ') > -1, 'bundle should contain domSafeQ');
  assert(output.indexOf('domIndex') > -1, 'bundle should contain domIndex');
  assert(output.indexOf('domSafeHandle') > -1, 'bundle should contain domSafeHandle');
  assert(output.indexOf('domSanitizer') > -1, 'bundle should contain domSanitizer');
});

test('bundle contains SafeJQuery and SafeQ in types', function() {
  var cp = require('child_process');
  var result = cp.spawnSync('node', ['browser.js'], { cwd: __dirname, timeout: 10000 });
  var output = result.stdout.toString();
  assert(output.indexOf("SafeJQuery: 'SafeJQuery'") > -1, 'types should include SafeJQuery');
  assert(output.indexOf("SafeQ: 'SafeQ'") > -1, 'types should include SafeQ');
});

test('bundle is a valid IIFE', function() {
  var cp = require('child_process');
  var result = cp.spawnSync('node', ['browser.js'], { cwd: __dirname, timeout: 10000 });
  var output = result.stdout.toString();
  assert(output.indexOf('(function(root)') === 0, 'should start with IIFE');
  assert(output.trimEnd().endsWith(');'), 'should end with );');
});

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log('SafeScript v1.3 — New Facade Tests');
console.log('══════════════════════════════════════════════════');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('══════════════════════════════════════════════════');

if (failed > 0) process.exit(1);

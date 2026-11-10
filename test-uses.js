/**
 * SafeScript v1.3 — @uses directive and type rename tests.
 */
'use strict';

var SS = require('./index');
var header = require('./src/header');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; process.stdout.write('.'); }
  else { failed++; console.log('\nFAIL: ' + msg); }
}

console.log('\n@uses Directive & Type Rename Tests');
console.log('═'.repeat(40));

// ── Type name exports ──────────────────────────────────────────
assert(SS.types.SafeDOMDocument === 'SafeDOMDocument', 'types.SafeDOMDocument');
assert(SS.types.SafeHTMLElement === 'SafeHTMLElement', 'types.SafeHTMLElement');

// ── Header parsing of @uses ────────────────────────────────────
var src1 = '/**\n * @safescript 1.3\n * @uses document: SafeDOMDocument\n */\nlet x = 1';
var caps1 = SS.capabilities(src1);
assert(caps1.uses.length === 1, '@uses parsed one entry');
assert(caps1.uses[0].name === 'document', '@uses name is "document"');
assert(caps1.uses[0].type === 'SafeDOMDocument', '@uses type is "SafeDOMDocument"');

// ── resolveUses ────────────────────────────────────────────────
var resolved1 = SS.resolveUses(caps1);
assert(resolved1.dom === true, 'resolveUses sets dom=true for SafeDOMDocument');
assert(resolved1.usesEntries.length === 1, 'resolveUses returns one entry');
assert(resolved1.usesEntries[0].builtin.provider === 'dom', 'builtin provider is dom');
assert(resolved1.usesEntries[0].builtin.scopeKey === 'document', 'builtin scopeKey is document');

// ── SafeHTMLElement in @uses ───────────────────────────────────
var src3 = '/**\n * @uses el: SafeHTMLElement\n */\nlet x = 1';
var caps3 = SS.capabilities(src3);
var resolved3 = SS.resolveUses(caps3);
assert(resolved3.dom === true, 'resolveUses sets dom=true for SafeHTMLElement');
assert(resolved3.usesEntries[0].builtin.scopeKey === null, 'SafeHTMLElement has null scopeKey');

// ── No @uses → no DOM ──────────────────────────────────────────
var src5 = '/**\n * @safescript 1.3\n */\nlet x = 1';
var caps5 = SS.capabilities(src5);
var resolved5 = SS.resolveUses(caps5);
assert(resolved5.dom === false, 'resolveUses sets dom=false when no @uses');
assert(resolved5.usesEntries.length === 0, 'resolveUses returns empty entries');

// ── Unknown @uses type → not in built-in registry ──────────────
var src6 = '/**\n * @uses db: Database\n */\nlet x = 1';
var caps6 = SS.capabilities(src6);
var resolved6 = SS.resolveUses(caps6);
assert(resolved6.dom === false, 'unknown type does not activate dom');
assert(resolved6.usesEntries.length === 0, 'unknown type not in usesEntries');

// ── BUILTIN_TYPES registry ─────────────────────────────────────
assert(header.BUILTIN_TYPES['SafeDOMDocument'].provider === 'dom', 'BUILTIN_TYPES SafeDOMDocument');
assert(header.BUILTIN_TYPES['SafeHTMLElement'].provider === 'dom', 'BUILTIN_TYPES SafeHTMLElement');
assert(!header.BUILTIN_TYPES['SafeDocument'], 'SafeDocument legacy alias removed');
assert(!header.BUILTIN_TYPES['SafeHandle'], 'SafeHandle legacy alias removed');

// ── v1.3 new built-in types in BUILTIN_TYPES ──────────────────
assert(header.BUILTIN_TYPES['SafeWindow'].provider === 'window', 'BUILTIN_TYPES SafeWindow provider');
assert(header.BUILTIN_TYPES['SafeWindow'].scopeKey === 'window', 'BUILTIN_TYPES SafeWindow scopeKey');
assert(header.BUILTIN_TYPES['SafeConsole'].provider === 'console', 'BUILTIN_TYPES SafeConsole provider');
assert(header.BUILTIN_TYPES['SafeConsole'].scopeKey === 'console', 'BUILTIN_TYPES SafeConsole scopeKey');
assert(header.BUILTIN_TYPES['SafeObservers'].provider === 'observers', 'BUILTIN_TYPES SafeObservers provider');
assert(header.BUILTIN_TYPES['SafeObservers'].scopeKey === null, 'BUILTIN_TYPES SafeObservers scopeKey null');
assert(header.BUILTIN_TYPES['SafeCanvas'].provider === 'canvas', 'BUILTIN_TYPES SafeCanvas provider');
assert(header.BUILTIN_TYPES['SafeCanvas'].scopeKey === null, 'BUILTIN_TYPES SafeCanvas scopeKey null');
assert(header.BUILTIN_TYPES['SafeMedia'].provider === 'media', 'BUILTIN_TYPES SafeMedia provider');
assert(header.BUILTIN_TYPES['SafeMedia'].scopeKey === null, 'BUILTIN_TYPES SafeMedia scopeKey null');
assert(header.BUILTIN_TYPES['SafeNavigation'].provider === 'navigation', 'BUILTIN_TYPES SafeNavigation provider');
assert(header.BUILTIN_TYPES['SafeNavigation'].scopeKey === null, 'BUILTIN_TYPES SafeNavigation scopeKey null');

// ── SafeScript.types includes new types ───────────────────────
assert(SS.types.SafeWindow === 'SafeWindow', 'types.SafeWindow');
assert(SS.types.SafeConsole === 'SafeConsole', 'types.SafeConsole');
assert(SS.types.SafeObservers === 'SafeObservers', 'types.SafeObservers');
assert(SS.types.SafeCanvas === 'SafeCanvas', 'types.SafeCanvas');
assert(SS.types.SafeMedia === 'SafeMedia', 'types.SafeMedia');
assert(SS.types.SafeNavigation === 'SafeNavigation', 'types.SafeNavigation');

// ── resolveUses with SafeWindow ───────────────────────────────
var srcWin = '/**\n * @uses win: SafeWindow\n */\nlet x = 1';
var capsWin = SS.capabilities(srcWin);
var resolvedWin = SS.resolveUses(capsWin);
assert(resolvedWin.window === true, 'resolveUses sets window=true for SafeWindow');
assert(resolvedWin.dom === false, 'SafeWindow does not activate dom');
assert(resolvedWin.usesEntries.length === 1, 'SafeWindow one usesEntry');
assert(resolvedWin.usesEntries[0].builtin.scopeKey === 'window', 'SafeWindow entry scopeKey');

// ── resolveUses with SafeConsole ──────────────────────────────
var srcCon = '/**\n * @uses log: SafeConsole\n */\nlet x = 1';
var resolvedCon = SS.resolveUses(SS.capabilities(srcCon));
assert(resolvedCon.console === true, 'resolveUses sets console=true for SafeConsole');
assert(resolvedCon.dom === false, 'SafeConsole does not activate dom');

// ── resolveUses with SafeObservers ────────────────────────────
var srcObs = '/**\n * @uses obs: SafeObservers\n */\nlet x = 1';
var resolvedObs = SS.resolveUses(SS.capabilities(srcObs));
assert(resolvedObs.observers === true, 'resolveUses sets observers=true');
assert(resolvedObs.dom === false, 'SafeObservers does not activate dom');

// ── resolveUses with SafeCanvas ───────────────────────────────
var srcCnv = '/**\n * @uses ctx: SafeCanvas\n */\nlet x = 1';
var resolvedCnv = SS.resolveUses(SS.capabilities(srcCnv));
assert(resolvedCnv.canvas === true, 'resolveUses sets canvas=true');

// ── resolveUses with SafeMedia ────────────────────────────────
var srcMed = '/**\n * @uses media: SafeMedia\n */\nlet x = 1';
var resolvedMed = SS.resolveUses(SS.capabilities(srcMed));
assert(resolvedMed.media === true, 'resolveUses sets media=true');

// ── resolveUses with SafeNavigation ───────────────────────────
var srcNav = '/**\n * @uses nav: SafeNavigation\n */\nlet x = 1';
var resolvedNav = SS.resolveUses(SS.capabilities(srcNav));
assert(resolvedNav.navigation === true, 'resolveUses sets navigation=true');

// ── resolveUses with multiple new types ───────────────────────
var srcMulti = '/**\n * @uses doc: SafeDOMDocument\n * @uses win: SafeWindow\n * @uses log: SafeConsole\n * @uses nav: SafeNavigation\n */\nlet x = 1';
var resolvedMulti = SS.resolveUses(SS.capabilities(srcMulti));
assert(resolvedMulti.dom === true, 'multi: dom=true');
assert(resolvedMulti.window === true, 'multi: window=true');
assert(resolvedMulti.console === true, 'multi: console=true');
assert(resolvedMulti.navigation === true, 'multi: navigation=true');
assert(resolvedMulti.observers === false, 'multi: observers=false (not declared)');
assert(resolvedMulti.canvas === false, 'multi: canvas=false (not declared)');
assert(resolvedMulti.media === false, 'multi: media=false (not declared)');
assert(resolvedMulti.usesEntries.length === 4, 'multi: 4 usesEntries');

// ── no @uses → all providers false ────────────────────────────
var resolvedNone = SS.resolveUses(SS.capabilities('/**\n * @safescript 1.3\n */\nlet x = 1'));
assert(resolvedNone.window === false, 'no @uses: window=false');
assert(resolvedNone.console === false, 'no @uses: console=false');
assert(resolvedNone.observers === false, 'no @uses: observers=false');
assert(resolvedNone.canvas === false, 'no @uses: canvas=false');
assert(resolvedNone.media === false, 'no @uses: media=false');
assert(resolvedNone.navigation === false, 'no @uses: navigation=false');

// ── load() returns header in bundle ────────────────────────────
SS.load(src1).then(function(bundle) {
  assert(!!bundle.header, 'load() bundle has header');
  assert(bundle.header.uses.length === 1, 'bundle header has uses');
  assert(bundle.header.uses[0].type === 'SafeDOMDocument', 'bundle header uses type');

  // ── run() still works with basic code ──────────────────────
  return SS.run('let x = 42; return x');
}).then(function(result) {
  assert(result === 42, 'basic run still works');

  // ── run(bundle) passes header ──────────────────────────────
  return SS.load('/**\n * @safescript 1.3\n */\nlet y = 99; return y');
}).then(function(bundle) {
  return SS.run(bundle);
}).then(function(result) {
  assert(result === 99, 'run(bundle) works with header');

  // ── DOM exports ────────────────────────────────────────────
  var domIndex = require('./src/dom/index');
  assert(domIndex.SafeDOMDocument === 'SafeDOMDocument', 'dom/index exports SafeDOMDocument');
  assert(domIndex.SafeHTMLElement === 'SafeHTMLElement', 'dom/index exports SafeHTMLElement');
  assert(!domIndex.SafeDocument, 'dom/index SafeDocument removed');
  assert(!domIndex.SafeHandle, 'dom/index SafeHandle removed');

  var safeDoc = require('./src/dom/safe-document');
  assert(safeDoc.createSafeDOMDocument === safeDoc.createSafeDocument, 'createSafeDOMDocument factory alias');

  var safeHandle = require('./src/dom/safe-handle');
  assert(safeHandle.createSafeHTMLElement === safeHandle.createSafeHandle, 'createSafeHTMLElement factory alias');

  console.log('\n');
  console.log('@uses Directive Tests: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  if (failed === 0) console.log('All tests passed!');
  process.exit(failed > 0 ? 1 : 0);
}).catch(function(err) {
  console.error('\nERROR:', err.message);
  process.exit(1);
});

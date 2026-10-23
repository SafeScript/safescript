/**
 * SafeScript battle test suite.
 *
 * Adversarial tests: security escapes, parser edge cases, Unicode tricks,
 * deep nesting, prototype pollution, scope leaks, and real-world patterns.
 *
 * Run: node test-battle.js
 */
'use strict';

var SafeScript = require('./index');

var passed = 0, failed = 0, total = 0, sections = {};
var currentSection = '';

function section(name) {
  currentSection = name;
  sections[name] = { passed: 0, failed: 0 };
  console.log('\n── ' + name + ' ──');
}

function assert(ok, label) {
  total++;
  if (ok) {
    passed++;
    sections[currentSection].passed++;
  } else {
    failed++;
    sections[currentSection].failed++;
    console.error('  FAIL: ' + label);
  }
}

function shouldCompile(source, label) {
  try {
    var result = SafeScript.compile(source);
    assert(typeof result.code === 'string', label);
  } catch(e) {
    assert(false, label + ' — threw: ' + e.message);
  }
}

function shouldFailCompile(source, label) {
  try {
    SafeScript.compile(source);
    assert(false, label + ' — should have thrown');
  } catch(e) {
    assert(true, label);
  }
}

async function shouldRun(source, scope, expected, label) {
  try {
    var result = await SafeScript.run(source, scope);
    if (typeof expected === 'function') {
      assert(expected(result), label + ' — predicate failed, got: ' + JSON.stringify(result));
    } else {
      assert(result === expected, label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(result));
    }
  } catch(e) {
    assert(false, label + ' — threw: ' + e.message);
  }
}

async function shouldThrowRun(source, scope, label) {
  try {
    await SafeScript.run(source, scope);
    assert(false, label + ' — should have thrown');
  } catch(e) {
    assert(true, label);
  }
}

async function shouldThrowRunWith(source, scope, msgPart, label) {
  try {
    await SafeScript.run(source, scope);
    assert(false, label + ' — should have thrown');
  } catch(e) {
    assert(e.message.indexOf(msgPart) >= 0, label + ' — expected "' + msgPart + '" in: ' + e.message);
  }
}


(async function() {

console.log('\n═══ SafeScript Battle Test Suite ═══');

// =====================================================================
// SECTION 1: Prototype pollution attacks
// =====================================================================
section('Prototype pollution attacks');

// Direct prototype access
shouldFailCompile('({}).__proto__', 'dot __proto__');
shouldFailCompile('({}).constructor', 'dot constructor');
shouldFailCompile('({}).prototype', 'dot prototype');

// Bracket access to dangerous props — should return undefined, not the real value
await shouldRun('var o = {}; return o["__proto__"];', {}, undefined, 'bracket __proto__ blocked');
await shouldRun('var o = {}; return o["constructor"];', {}, undefined, 'bracket constructor blocked');
await shouldRun('var o = {}; return o["prototype"];', {}, undefined, 'bracket prototype blocked');

// String concatenation to build blocked property name
await shouldRun('var k = "__pro" + "to__"; var o = {}; return o[k];', {}, undefined, 'concat __proto__ blocked');
await shouldRun('var k = "con" + "structor"; var o = {}; return o[k];', {}, undefined, 'concat constructor blocked');
await shouldRun('var k = "proto" + "type"; var o = {}; return o[k];', {}, undefined, 'concat prototype blocked');

// Trying to SET blocked properties via bracket
await shouldThrowRun('var o = {}; o["__proto__"] = {};', {}, 'set __proto__ throws');
await shouldThrowRun('var o = {}; o["constructor"] = function(){};', {}, 'set constructor throws');
await shouldThrowRun('var o = {}; o["prototype"] = {};', {}, 'set prototype throws');

// Trying to walk the chain
await shouldRun('var a = [1,2,3]; return a["constructor"];', {}, undefined, 'array constructor blocked');
await shouldRun('var s = "hello"; return s["constructor"];', {}, undefined, 'string constructor blocked');
await shouldRun('var f = function(){}; return f["constructor"];', {}, undefined, 'function constructor blocked');
await shouldRun('var f = function(){}; return f["caller"];', {}, undefined, 'function caller blocked');
await shouldRun('var f = function(){}; return f["callee"];', {}, undefined, 'function callee blocked');

// __defineGetter__ / __defineSetter__
shouldFailCompile('({}).__defineGetter__', '__defineGetter__ in source (identifier)');
await shouldRun('var o = {}; return o["__defineGetter__"];', {}, undefined, 'bracket __defineGetter__ blocked');
await shouldRun('var o = {}; return o["__defineSetter__"];', {}, undefined, 'bracket __defineSetter__ blocked');
await shouldRun('var o = {}; return o["__lookupGetter__"];', {}, undefined, 'bracket __lookupGetter__ blocked');
await shouldRun('var o = {}; return o["__lookupSetter__"];', {}, undefined, 'bracket __lookupSetter__ blocked');

// =====================================================================
// SECTION 2: Global escape attempts
// =====================================================================
section('Global escape attempts');

// Globals that are shadowed (allowed in source but undefined at runtime)
var shadowedGlobals = [
  'Object', 'Array', 'String', 'Number', 'Boolean',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
  'Date', 'RegExp', 'JSON', 'Math', 'Intl',
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Int32Array', 'Float64Array',
  'console', 'clearTimeout', 'clearInterval',
  'atob', 'btoa', 'encodeURI', 'decodeURI',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'NaN', 'Infinity',
  'crypto', 'performance',
  'URL', 'URLSearchParams', 'Request', 'Response', 'Headers',
  'TextEncoder', 'TextDecoder',
  'Blob', 'File', 'FileReader', 'FormData',
  'Worker', 'SharedWorker',
  'AbortController', 'AbortSignal',
  'BroadcastChannel', 'MessageChannel',
  'queueMicrotask', 'structuredClone',
];

for (var gi = 0; gi < shadowedGlobals.length; gi++) {
  await shouldRun('return typeof ' + shadowedGlobals[gi] + ';', {}, 'undefined', shadowedGlobals[gi] + ' shadowed');
}

// Globals that are BLOCKED at compile time (not just shadowed)
var blockedGlobals = [
  'Function', 'setTimeout', 'setInterval', 'fetch',
  'XMLHttpRequest', 'WebSocket',
  'require', 'module', 'exports',
  '__filename', '__dirname', 'process', 'Buffer',
];
blockedGlobals.forEach(function(g) {
  shouldFailCompile('return typeof ' + g + ';', g + ' blocked at compile');
});

// =====================================================================
// SECTION 3: Blocked identifier attacks
// =====================================================================
section('Blocked identifier attacks');

shouldFailCompile('eval("1+1")', 'eval call');
shouldFailCompile('var x = eval;', 'eval reference');
shouldFailCompile('Function("return 1")()', 'Function constructor');
shouldFailCompile('globalThis', 'globalThis');
shouldFailCompile('window.location', 'window');
shouldFailCompile('document.cookie', 'document');
shouldFailCompile('navigator.userAgent', 'navigator');
shouldFailCompile('self.postMessage(1)', 'self');
shouldFailCompile('top.location', 'top');
shouldFailCompile('parent.postMessage(1)', 'parent');
shouldFailCompile('frames[0]', 'frames');
shouldFailCompile('location.href', 'location');
shouldFailCompile('history.back()', 'history');
shouldFailCompile('Proxy', 'Proxy');
shouldFailCompile('Reflect.get({}, "a")', 'Reflect');
shouldFailCompile('Symbol("x")', 'Symbol');
shouldFailCompile('fetch("/api")', 'fetch');
shouldFailCompile('XMLHttpRequest', 'XMLHttpRequest');
shouldFailCompile('WebSocket', 'WebSocket');
shouldFailCompile('EventSource', 'EventSource');
shouldFailCompile('setTimeout(f, 0)', 'setTimeout');
shouldFailCompile('setInterval(f, 100)', 'setInterval');
shouldFailCompile('requestAnimationFrame(f)', 'requestAnimationFrame');
shouldFailCompile('require("fs")', 'require');
shouldFailCompile('module.exports = {}', 'module');
shouldFailCompile('process.exit(1)', 'process');
shouldFailCompile('global.x', 'global (node)');
shouldFailCompile('Buffer.from("x")', 'Buffer');
shouldFailCompile('__filename', '__filename');
shouldFailCompile('__dirname', '__dirname');

// this / arguments / callee / caller
shouldFailCompile('this.x', 'this');
shouldFailCompile('arguments[0]', 'arguments');
shouldFailCompile('arguments.callee', 'callee via arguments');

// =====================================================================
// SECTION 4: Blocked keyword attacks
// =====================================================================
section('Blocked keyword attacks');

shouldFailCompile('new Object()', 'new');
shouldFailCompile('delete obj.x', 'delete');
shouldFailCompile('class Foo {}', 'class');
shouldFailCompile('class Foo extends Bar {}', 'extends');
shouldFailCompile('import("fs")', 'import');
shouldFailCompile('export var x = 1;', 'export');
shouldFailCompile('with (obj) { x; }', 'with');
shouldFailCompile('debugger;', 'debugger');
shouldFailCompile('yield 1;', 'yield');
shouldFailCompile('function* gen() { yield 1; }', 'generator function*');

// super
shouldFailCompile('class A extends B { constructor() { super(); } }', 'super via class');

// =====================================================================
// SECTION 5: Template literal blocking
// =====================================================================
section('Template literal blocking');

shouldFailCompile('var x = `hello`', 'simple template');
shouldFailCompile('var x = `hello ${name}`', 'template with expression');
shouldFailCompile('var x = `${`nested`}`', 'nested template');
shouldFailCompile('tag`hello`', 'tagged template');

// =====================================================================
// SECTION 6: String escape handling
// =====================================================================
section('String escape handling');

await shouldRun('return "hello\\nworld";', {}, 'hello\nworld', 'newline escape');
await shouldRun('return "hello\\tworld";', {}, 'hello\tworld', 'tab escape');
await shouldRun('return "hello\\\\world";', {}, 'hello\\world', 'backslash escape');
await shouldRun('return "hello\\"world";', {}, 'hello"world', 'quote escape');
await shouldRun("return 'hello\\'world';", {}, "hello'world", 'single quote escape');
await shouldRun('return "\\x41";', {}, 'A', 'hex escape \\x41');
await shouldRun('return "\\x61\\x62\\x63";', {}, 'abc', 'hex escape abc');
await shouldRun('return "\\u0041";', {}, 'A', 'unicode escape \\u0041');
await shouldRun('return "\\u{1F600}";', {}, '\u{1F600}', 'unicode code point escape');
await shouldRun('return "\\0";', {}, '\0', 'null escape');
await shouldRun('return "line1\\nline2\\nline3";', {}, 'line1\nline2\nline3', 'multiple newlines');
await shouldRun('return "";', {}, '', 'empty string');
await shouldRun("return '';", {}, '', 'empty single-quoted string');
await shouldRun('return "a\\rb";', {}, 'a\rb', 'carriage return escape');
await shouldRun('return "a\\bb";', {}, 'a\bb', 'backspace escape');
await shouldRun('return "a\\fb";', {}, 'a\fb', 'form feed escape');
await shouldRun('return "a\\vb";', {}, 'a\vb', 'vertical tab escape');

// =====================================================================
// SECTION 7: Number literal edge cases
// =====================================================================
section('Number literal edge cases');

await shouldRun('return 0;', {}, 0, 'zero');
await shouldRun('return -0;', {}, -0, 'negative zero');
await shouldRun('return 0xFF;', {}, 255, 'hex literal');
await shouldRun('return 0xff;', {}, 255, 'hex literal lowercase');
await shouldRun('return 0b1010;', {}, 10, 'binary literal');
await shouldRun('return 0o77;', {}, 63, 'octal literal');
await shouldRun('return 1e3;', {}, 1000, 'scientific notation');
await shouldRun('return 1.5e2;', {}, 150, 'float scientific');
await shouldRun('return .5;', {}, 0.5, 'leading dot');
await shouldRun('return 1_000;', {}, 1000, 'numeric separator');
await shouldRun('return 0.1 + 0.2;', {}, function(r) { return Math.abs(r - 0.3) < 1e-10; }, 'float precision');

// =====================================================================
// SECTION 8: Operator edge cases
// =====================================================================
section('Operator edge cases');

await shouldRun('return 2 ** 10;', {}, 1024, 'exponentiation');
await shouldRun('return (-2) ** 2;', {}, 4, 'neg exponentiation (parens required)');
await shouldRun('return 5 % 3;', {}, 2, 'modulo');
await shouldRun('return 7 & 3;', {}, 3, 'bitwise AND');
await shouldRun('return 5 | 3;', {}, 7, 'bitwise OR');
await shouldRun('return 5 ^ 3;', {}, 6, 'bitwise XOR');
await shouldRun('return ~0;', {}, -1, 'bitwise NOT');
await shouldRun('return 1 << 4;', {}, 16, 'left shift');
await shouldRun('return 16 >> 2;', {}, 4, 'right shift');
await shouldRun('return -1 >>> 0;', {}, 4294967295, 'unsigned right shift');
await shouldRun('return !true;', {}, false, 'logical not');
await shouldRun('return !!0;', {}, false, 'double not');
await shouldRun('return +"42";', {}, 42, 'unary plus');
await shouldRun('return -(-5);', {}, 5, 'double negation');
await shouldRun('return void 0;', {}, undefined, 'void');
await shouldRun('return typeof "x";', {}, 'string', 'typeof string');
await shouldRun('return typeof undefined;', {}, 'undefined', 'typeof undefined');
await shouldRun('return typeof null;', {}, 'object', 'typeof null');

// Nullish coalescing
await shouldRun('return null ?? "default";', {}, 'default', 'null ?? default');
await shouldRun('return undefined ?? "default";', {}, 'default', 'undefined ?? default');
await shouldRun('return 0 ?? "default";', {}, 0, '0 ?? default (0 is not nullish)');
await shouldRun('return "" ?? "default";', {}, '', '"" ?? default');
await shouldRun('return false ?? "default";', {}, false, 'false ?? default');

// Optional chaining
await shouldRun('var o = {a: {b: 1}}; return o?.a?.b;', {}, 1, 'optional chaining existing');
await shouldRun('var o = {}; return o?.a?.b;', {}, undefined, 'optional chaining missing');
await shouldRun('var o = null; return o?.a;', {}, undefined, 'optional chaining on null');

// Comma operator
await shouldRun('return (1, 2, 3);', {}, 3, 'comma operator');

// =====================================================================
// SECTION 9: Control flow edge cases
// =====================================================================
section('Control flow edge cases');

// Nested loops with break/continue
await shouldRun(
  'var s = 0; for (var i = 0; i < 5; i++) { if (i === 3) break; s += i; } return s;',
  {}, 3, 'for break');
await shouldRun(
  'var s = 0; for (var i = 0; i < 5; i++) { if (i === 2) continue; s += i; } return s;',
  {}, 8, 'for continue');

// Labeled break
await shouldRun(
  'var s = 0; outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j === 1) break outer; s++; } } return s;',
  {}, 1, 'labeled break');

// Labeled continue
await shouldRun(
  'var s = 0; outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j === 1) continue outer; s++; } } return s;',
  {}, 3, 'labeled continue');

// Empty for loop
await shouldRun('for (var i = 0; i < 0; i++) {} return 42;', {}, 42, 'empty for loop');

// For-in with prototype
await shouldRun(
  'var o = {a: 1, b: 2}; var keys = []; for (var k in o) { keys.push(k); } return keys.length;',
  {}, 2, 'for-in keys');

// For-of with array
await shouldRun(
  'var arr = [10, 20, 30]; var s = 0; for (var v of arr) { s += v; } return s;',
  {}, 60, 'for-of sum');

// Switch with fallthrough
await shouldRun(
  'var x = 2; var r = ""; switch(x) { case 1: r += "a"; case 2: r += "b"; case 3: r += "c"; break; case 4: r += "d"; } return r;',
  {}, 'bc', 'switch fallthrough');

// Switch default in middle
await shouldRun(
  'var x = 99; var r = ""; switch(x) { case 1: r += "a"; break; default: r += "d"; break; case 2: r += "b"; break; } return r;',
  {}, 'd', 'switch default middle');

// Try/catch/finally interactions
await shouldRun(
  'var r = ""; try { r += "t"; throw "e"; } catch(e) { r += "c"; } finally { r += "f"; } return r;',
  {}, 'tcf', 'try/catch/finally order');
await shouldRun(
  'var r = ""; try { r += "t"; } finally { r += "f"; } return r;',
  {}, 'tf', 'try/finally no throw');

// Nested try/catch
await shouldRun(
  'try { try { throw "inner"; } catch(e) { return "caught: " + e; } } catch(e) { return "outer"; }',
  {}, 'caught: inner', 'nested try/catch');

// =====================================================================
// SECTION 10: Function edge cases
// =====================================================================
section('Function edge cases');

// Recursive function
await shouldRun(
  'function fib(n) { if (n <= 1) return n; return fib(n - 1) + fib(n - 2); } return fib(10);',
  {}, 55, 'recursive fibonacci');

// Closure
await shouldRun(
  'function counter() { var n = 0; return function() { n++; return n; }; } var c = counter(); c(); c(); return c();',
  {}, 3, 'closure counter');

// IIFE
await shouldRun(
  'return (function() { return 42; })();',
  {}, 42, 'IIFE');

// Arrow with block body
await shouldRun(
  'var f = (x) => { var y = x * 2; return y + 1; }; return f(5);',
  {}, 11, 'arrow block body');

// Arrow returning object (parenthesized)
await shouldRun(
  'var f = () => ({ a: 1 }); return f().a;',
  {}, 1, 'arrow returning object');

// Default params
await shouldRun(
  'function f(a, b = 10, c = 20) { return a + b + c; } return f(1);',
  {}, 31, 'multiple default params');
await shouldRun(
  'function f(a, b = 10, c = 20) { return a + b + c; } return f(1, 2);',
  {}, 23, 'partial default params');

// Rest params
await shouldRun(
  'function f(a, ...rest) { return rest.length; } return f(1, 2, 3, 4);',
  {}, 3, 'rest params');

// Higher-order functions
await shouldRun(
  'function apply(fn, x) { return fn(x); } return apply(function(n) { return n * 3; }, 7);',
  {}, 21, 'higher order function');

// Immediately invoked arrow
await shouldRun('return ((x) => x * 2)(21);', {}, 42, 'immediately invoked arrow');

// =====================================================================
// SECTION 11: Destructuring edge cases
// =====================================================================
section('Destructuring edge cases');

// Nested object destructuring
await shouldRun(
  'var { a: { b } } = { a: { b: 42 } }; return b;',
  {}, 42, 'nested object destructuring');

// Destructuring with defaults
await shouldRun(
  'var { a = 1, b = 2 } = { a: 10 }; return a + b;',
  {}, 12, 'object destructuring defaults');

// Array destructuring with skip
await shouldRun(
  'var [a, , b] = [1, 2, 3]; return a + b;',
  {}, 4, 'array destructuring skip');

// Destructuring in for-of
await shouldRun(
  'var pairs = [[1, "a"], [2, "b"]]; var s = ""; for (var [n, c] of pairs) { s += n + c; } return s;',
  {}, '1a2b', 'destructuring in for-of');

// Object rest
await shouldRun(
  'var { a, ...rest } = { a: 1, b: 2, c: 3 }; return typeof rest;',
  {}, 'object', 'object rest type');

// Array rest
await shouldRun(
  'var [first, ...rest] = [1, 2, 3, 4, 5]; return rest.length;',
  {}, 4, 'array rest length');

// Destructured function params
await shouldRun(
  'var f = ({ x, y }) => x + y; return f({ x: 3, y: 4 });',
  {}, 7, 'destructured arrow params');

// =====================================================================
// SECTION 12: Spread edge cases
// =====================================================================
section('Spread edge cases');

await shouldRun(
  'var a = [1, 2]; var b = [0, ...a, 3]; return b.length;',
  {}, 4, 'array spread');
await shouldRun(
  'var a = [1, 2]; var b = [...a, ...a]; return b.length;',
  {}, 4, 'double array spread');
await shouldRun(
  'function f(a, b, c) { return a + b + c; } var args = [1, 2, 3]; return f(...args);',
  {}, 6, 'spread in call');
await shouldRun(
  'var a = { x: 1 }; var b = { y: 2 }; var c = { ...a, ...b }; return c.x + c.y;',
  {}, 3, 'object spread');
await shouldRun(
  'var a = { x: 1 }; var c = { ...a, x: 2 }; return c.x;',
  {}, 2, 'object spread override');

// =====================================================================
// SECTION 13: Scope injection and isolation
// =====================================================================
section('Scope injection and isolation');

// Scope variables are accessible
await shouldRun('return x;', { x: 42 }, 42, 'scope variable');
await shouldRun('return fn(5);', { fn: function(n) { return n * 2; } }, 10, 'scope function');

// Scope doesn't leak between runs
await (async function() {
  await SafeScript.run('var leaked = 999;', {});
  await shouldRun('return typeof leaked;', {}, 'undefined', 'no leak between runs');
})();

// Can't modify scope object from inside
await (async function() {
  var scope = { x: 1 };
  await SafeScript.run('x = 99;', scope);
  // The scope is sanitized (deep copied), so original shouldn't change
  assert(scope.x === 1, 'scope not mutated externally');
})();

// Injected Math works
await shouldRun('return Math.max(1, 5, 3);', { Math: Math }, 5, 'injected Math');
await shouldRun('return Math.floor(3.7);', { Math: Math }, 3, 'injected Math.floor');

// Injected JSON works
await shouldRun('return JSON.stringify([1,2]);', { JSON: JSON }, '[1,2]', 'injected JSON.stringify');
await shouldRun('return JSON.parse("[1,2]").length;', { JSON: JSON }, 2, 'injected JSON.parse');

// Injected Date works
await shouldRun('return typeof Date.now();', { Date: Date }, 'number', 'injected Date');

// Multiple scope vars
await shouldRun('return a + b + c;', { a: 1, b: 2, c: 3 }, 6, 'multiple scope vars');

// Scope with nested objects
await shouldRun('return config.db.host;', { config: { db: { host: 'localhost' } } }, 'localhost', 'nested scope object');

// =====================================================================
// SECTION 14: Sanitizer edge cases
// =====================================================================
section('Sanitizer edge cases');

(function() {
  // Sanitizer strips prototypes
  var obj = { a: 1 };
  var s = SafeScript.sanitize(obj);
  assert(Object.getPrototypeOf(s) === null, 'sanitized null prototype');
  assert(s.a === 1, 'sanitized preserves values');
  assert(s.constructor === undefined, 'sanitized no constructor');
  assert(s.hasOwnProperty === undefined, 'sanitized no hasOwnProperty');
  assert(s.toString === undefined, 'sanitized no toString');

  // Nested sanitization
  var nested = { a: { b: { c: 42 } } };
  var sn = SafeScript.sanitize(nested);
  assert(Object.getPrototypeOf(sn.a) === null, 'nested sanitized');
  assert(Object.getPrototypeOf(sn.a.b) === null, 'deep nested sanitized');
  assert(sn.a.b.c === 42, 'deep value preserved');

  // Array preservation
  var arr = [1, [2, 3], { a: 4 }];
  var sa = SafeScript.sanitize(arr);
  assert(Array.isArray(sa), 'array preserved');
  assert(Array.isArray(sa[1]), 'nested array preserved');
  assert(sa[2].a === 4, 'object in array sanitized value');
  assert(Object.getPrototypeOf(sa[2]) === null, 'object in array sanitized prototype');

  // Function pass-through
  var fn = function() { return 42; };
  var sf = SafeScript.sanitize(fn);
  assert(sf === fn, 'function passes through');

  // Null/undefined pass-through
  assert(SafeScript.sanitize(null) === null, 'null passes through');
  assert(SafeScript.sanitize(undefined) === undefined, 'undefined passes through');

  // Primitive pass-through
  assert(SafeScript.sanitize(42) === 42, 'number passes through');
  assert(SafeScript.sanitize('hello') === 'hello', 'string passes through');
  assert(SafeScript.sanitize(true) === true, 'boolean passes through');

  // Cycle handling
  var cycle = { a: 1 };
  cycle.self = cycle;
  var sc = SafeScript.sanitize(cycle);
  assert(sc.self === sc, 'cycle reference preserved');
  assert(sc.a === 1, 'cycle value preserved');

  // Built-in object pass-through (non-plain objects)
  var mathSanitized = SafeScript.sanitize(Math);
  assert(typeof mathSanitized.floor === 'function', 'Math passes through');

  var jsonSanitized = SafeScript.sanitize(JSON);
  assert(typeof jsonSanitized.stringify === 'function', 'JSON passes through with methods');
})();

// =====================================================================
// SECTION 15: Validate API
// =====================================================================
section('Validate API');

(function() {
  assert(SafeScript.validate('var x = 1;').ok === true, 'valid code');
  assert(SafeScript.validate('return x + y;').ok === true, 'valid expression');
  assert(SafeScript.validate('eval("bad")').ok === false, 'rejects eval');
  assert(SafeScript.validate('new Object()').ok === false, 'rejects new');
  assert(SafeScript.validate('delete x.y').ok === false, 'rejects delete');
  assert(SafeScript.validate('class Foo {}').ok === false, 'rejects class');
  assert(SafeScript.validate('globalThis').ok === false, 'rejects globalThis');
  assert(SafeScript.validate('var x = `template`').ok === false, 'rejects template');
  assert(SafeScript.validate('').ok === true, 'empty string valid');
  assert(SafeScript.validate('// just a comment').ok === true, 'comment only valid');
  assert(SafeScript.validate('/* block comment */').ok === true, 'block comment valid');
  assert(SafeScript.validate(';;;').ok === true, 'empty statements valid');

  // Validate returns errors array
  var r = SafeScript.validate('eval("x")');
  assert(r.errors !== null && r.errors.length > 0, 'errors array populated');

  // Syntax error
  var r2 = SafeScript.validate('var x = ;');
  assert(r2.ok === false, 'syntax error caught');
})();

// =====================================================================
// SECTION 16: AST hashing
// =====================================================================
section('AST hashing');

(function() {
  var r1 = SafeScript.compile('var x = 1 + 2;');
  var r2 = SafeScript.compile('var   x  =  1  +  2 ;');
  var r3 = SafeScript.compile('// comment\nvar x = 1 + 2;');
  var r4 = SafeScript.compile('/* block */\nvar x = 1 + 2;');
  var r5 = SafeScript.compile('var x = 1 + 3;');
  var r6 = SafeScript.compile('var y = 1 + 2;');

  assert(r1.hash === r2.hash, 'whitespace invariant');
  assert(r1.hash === r3.hash, 'line comment invariant');
  assert(r1.hash === r4.hash, 'block comment invariant');
  assert(r1.hash !== r5.hash, 'different value = different hash');
  assert(r1.hash !== r6.hash, 'different name = different hash');
  assert(typeof r1.hash === 'string' && r1.hash.length === 64, 'hash format sha256 hex');
})();

// =====================================================================
// SECTION 17: Complex real-world patterns
// =====================================================================
section('Complex real-world patterns');

// Array methods (using injected Array methods via scope)
await shouldRun(
  'var arr = [1, 2, 3, 4, 5]; var sum = 0; for (var i = 0; i < arr.length; i++) { sum += arr[i]; } return sum;',
  {}, 15, 'array sum loop');

// String manipulation
await shouldRun(
  'var s = "Hello, World!"; return s.slice(0, 5);',
  {}, 'Hello', 'string slice');
await shouldRun(
  'var s = "hello"; return s.toUpperCase();',
  {}, 'HELLO', 'string toUpperCase');
await shouldRun(
  'var s = "a,b,c"; return s.split(",").length;',
  {}, 3, 'string split');

// Object manipulation
await shouldRun(
  'var o = {}; o.x = 1; o.y = 2; return o.x + o.y;',
  {}, 3, 'object property set/get');

// Nested function calls
await shouldRun(
  'function add(a, b) { return a + b; } function mul(a, b) { return a * b; } return add(mul(2, 3), mul(4, 5));',
  {}, 26, 'nested function calls');

// Map-like pattern
await shouldRun(
  'var data = [1, 2, 3, 4]; var result = []; for (var i = 0; i < data.length; i++) { result.push(data[i] * 2); } return result.length;',
  {}, 4, 'manual map pattern');

// Filter-like pattern
await shouldRun(
  'var data = [1, 2, 3, 4, 5, 6]; var evens = []; for (var i = 0; i < data.length; i++) { if (data[i] % 2 === 0) evens.push(data[i]); } return evens.length;',
  {}, 3, 'manual filter pattern');

// Reduce-like pattern
await shouldRun(
  'var data = [1, 2, 3, 4]; var product = 1; for (var i = 0; i < data.length; i++) { product = product * data[i]; } return product;',
  {}, 24, 'manual reduce pattern');

// State machine
await shouldRun(
  'var state = "start"; var input = [1, 0, 1]; for (var i = 0; i < input.length; i++) { if (state === "start" && input[i] === 1) state = "on"; else if (state === "on" && input[i] === 0) state = "off"; else if (state === "off" && input[i] === 1) state = "on"; } return state;',
  {}, 'on', 'state machine');

// Fibonacci iterative
await shouldRun(
  'var a = 0, b = 1; for (var i = 0; i < 20; i++) { var t = a + b; a = b; b = t; } return a;',
  {}, 6765, 'fibonacci iterative');

// Binary search
await shouldRun(
  'function bsearch(arr, target) { var lo = 0, hi = arr.length - 1; while (lo <= hi) { var mid = (lo + hi) >> 1; if (arr[mid] === target) return mid; if (arr[mid] < target) lo = mid + 1; else hi = mid - 1; } return -1; } return bsearch([1,3,5,7,9,11,13], 7);',
  {}, 3, 'binary search');

// Quicksort
await shouldRun(
  'function qsort(arr) { if (arr.length <= 1) return arr; var pivot = arr[0]; var left = [], right = []; for (var i = 1; i < arr.length; i++) { if (arr[i] < pivot) left.push(arr[i]); else right.push(arr[i]); } var sl = qsort(left); var sr = qsort(right); var result = []; for (var j = 0; j < sl.length; j++) result.push(sl[j]); result.push(pivot); for (var k = 0; k < sr.length; k++) result.push(sr[k]); return result; } var sorted = qsort([3,1,4,1,5,9,2,6]); return sorted[0] === 1 && sorted[7] === 9;',
  {}, true, 'quicksort');

// =====================================================================
// SECTION 18: Deep nesting stress tests
// =====================================================================
section('Deep nesting stress tests');

// Deeply nested objects
await shouldRun(
  'var o = {a:{b:{c:{d:{e:{f:42}}}}}}; return o.a.b.c.d.e.f;',
  {}, 42, 'deep object nesting');

// Deeply nested function calls
await shouldRun(
  'function f(n) { return n; } return f(f(f(f(f(42)))));',
  {}, 42, 'deep function call nesting');

// Deeply nested ternaries
await shouldRun(
  'var x = 5; return x > 10 ? "a" : x > 8 ? "b" : x > 6 ? "c" : x > 4 ? "d" : "e";',
  {}, 'd', 'nested ternaries');

// Nested loops (3 levels)
await shouldRun(
  'var s = 0; for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { for (var k = 0; k < 3; k++) { s++; } } } return s;',
  {}, 27, '3-level nested loops');

// =====================================================================
// SECTION 19: Edge case expressions
// =====================================================================
section('Edge case expressions');

// Chained comparison
await shouldRun('return 1 < 2;', {}, true, 'less than');
await shouldRun('return 2 > 1;', {}, true, 'greater than');
await shouldRun('return 1 <= 1;', {}, true, 'less equal');
await shouldRun('return 1 >= 1;', {}, true, 'greater equal');
await shouldRun('return 1 === 1;', {}, true, 'strict equal');
await shouldRun('return 1 !== 2;', {}, true, 'strict not equal');
await shouldRun('return 1 == "1";', {}, true, 'loose equal');
await shouldRun('return 1 != "2";', {}, true, 'loose not equal');

// instanceof with injected constructor
await shouldRun('var arr = [1, 2]; return arr instanceof Array;', { Array: Array }, true, 'instanceof with injected Array');

// typeof on various
await shouldRun('return typeof 42;', {}, 'number', 'typeof number');
await shouldRun('return typeof true;', {}, 'boolean', 'typeof boolean');
await shouldRun('return typeof null;', {}, 'object', 'typeof null');
await shouldRun('return typeof undefined;', {}, 'undefined', 'typeof undefined');
await shouldRun('return typeof function(){};', {}, 'function', 'typeof function');
await shouldRun('return typeof {};', {}, 'object', 'typeof object');
await shouldRun('return typeof [];', {}, 'object', 'typeof array');

// Assignment operators
await shouldRun('var x = 10; x += 5; return x;', {}, 15, '+=');
await shouldRun('var x = 10; x -= 3; return x;', {}, 7, '-=');
await shouldRun('var x = 10; x *= 2; return x;', {}, 20, '*=');
await shouldRun('var x = 10; x /= 2; return x;', {}, 5, '/=');
await shouldRun('var x = 10; x %= 3; return x;', {}, 1, '%=');
await shouldRun('var x = 2; x **= 3; return x;', {}, 8, '**=');
await shouldRun('var x = 5; x &= 3; return x;', {}, 1, '&=');
await shouldRun('var x = 5; x |= 3; return x;', {}, 7, '|=');
await shouldRun('var x = 5; x ^= 3; return x;', {}, 6, '^=');
await shouldRun('var x = 8; x >>= 2; return x;', {}, 2, '>>=');
await shouldRun('var x = 1; x <<= 4; return x;', {}, 16, '<<=');

// Pre/post increment/decrement
await shouldRun('var x = 5; return x++;', {}, 5, 'post increment returns old');
await shouldRun('var x = 5; return ++x;', {}, 6, 'pre increment returns new');
await shouldRun('var x = 5; x++; return x;', {}, 6, 'post increment effect');
await shouldRun('var x = 5; return x--;', {}, 5, 'post decrement returns old');
await shouldRun('var x = 5; return --x;', {}, 4, 'pre decrement returns new');

// Compound assignment on bracket access
await shouldRun('var arr = [10]; arr[0] += 5; return arr[0];', {}, 15, 'bracket +=');
await shouldRun('var arr = [10]; arr[0] -= 3; return arr[0];', {}, 7, 'bracket -=');
await shouldRun('var arr = [10]; arr[0] *= 2; return arr[0];', {}, 20, 'bracket *=');
await shouldRun('var arr = [2]; arr[0]++; return arr[0];', {}, 3, 'bracket ++');
await shouldRun('var arr = [2]; arr[0]--; return arr[0];', {}, 1, 'bracket --');

// =====================================================================
// SECTION 20: Unicode in identifiers and strings
// =====================================================================
section('Unicode in identifiers and strings');

await shouldRun('return "Hello, 世界";', {}, 'Hello, 世界', 'unicode in string');
await shouldRun('return "\u{1F600}";', {}, '\u{1F600}', 'emoji in string');
await shouldRun('var x = "é"; return x;', {}, 'é', 'accented char');

// =====================================================================
// SECTION 21: Regex literals
// =====================================================================
section('Regex literals');

shouldCompile('var r = /hello/;', 'simple regex');
shouldCompile('var r = /hello/gi;', 'regex with flags');
shouldCompile('var r = /^test$/;', 'regex anchors');
shouldCompile('var r = /a\\/b/;', 'regex with escaped slash');

// =====================================================================
// SECTION 22: Multiple statements and semicolons
// =====================================================================
section('Multiple statements and semicolons');

await shouldRun('var a = 1; var b = 2; var c = 3; return a + b + c;', {}, 6, 'multiple var statements');
await shouldRun(';;;return 42;;;', {}, 42, 'extra semicolons');
await shouldRun('return 42', {}, 42, 'no trailing semicolon');

// =====================================================================
// SECTION 23: Error handling patterns
// =====================================================================
section('Error handling patterns');

await shouldRun(
  'try { throw { code: 404, msg: "not found" }; } catch(e) { return e.code; }',
  {}, 404, 'throw object');
await shouldRun(
  'try { throw "custom error"; } catch(e) { return e; }',
  {}, 'custom error', 'throw string');
await shouldRun(
  'function divide(a, b) { if (b === 0) throw "division by zero"; return a / b; } try { return divide(10, 0); } catch(e) { return e; }',
  {}, 'division by zero', 'throw in function');
await shouldRun(
  'var x = 0; try { throw "err"; } catch(e) { x = 1; } finally { x += 10; } return x;',
  {}, 11, 'finally always runs');

// =====================================================================
// SECTION 24: Async/await (now BLOCKED — auto-async model)
// =====================================================================
section('Async/await (blocked keywords)');

shouldFailCompile('async function f() { return 1; }', 'async keyword blocked');
shouldFailCompile('var f = async function() { return 1; };', 'async in expression blocked');
shouldFailCompile('var f = async () => 1;', 'async arrow blocked');
shouldFailCompile('async function f() { var x = await p; return x; }', 'await keyword blocked');
shouldFailCompile('var x = await promise;', 'bare await blocked');

// =====================================================================
// SECTION 25: Tricky attack vectors
// =====================================================================
section('Tricky attack vectors');

// Trying to access Function through a variable
shouldFailCompile('var F = Function; F("return 1")();', 'Function via variable');

// Trying indirect eval
shouldFailCompile('var e = eval; e("1+1");', 'indirect eval');

// Trying to reach global through an error
await shouldRun(
  'try { null.x; } catch(e) { return typeof e; }',
  {}, 'object', 'error object type');

// Can't get constructor from error
await shouldRun(
  'try { null.x; } catch(e) { return e["constructor"]; }',
  {}, undefined, 'error constructor blocked');

// Attempting to use toString to bypass
await shouldRun(
  'var obj = { toString: function() { return "constructor"; } }; return typeof obj.toString;',
  {}, 'function', 'toString exists but not exploitable');

// Trying computed property to build dangerous string
await shouldRun(
  'var parts = ["c","o","n","s","t","r","u","c","t","o","r"]; var key = ""; for (var i = 0; i < parts.length; i++) key += parts[i]; var o = {}; return o[key];',
  {}, undefined, 'built string still blocked by __at');

// Trying to reach Object through array
await shouldRun(
  'var arr = []; return arr["constructor"];',
  {}, undefined, 'array constructor via bracket blocked');

// Trying to use __proto__ through various means
await shouldRun(
  'var key = String.fromCharCode(95, 95, 112, 114, 111, 116, 111, 95, 95); var o = {}; return o[key];',
  { String: String }, undefined, 'fromCharCode __proto__ still blocked by __at');

// Verify we can't escape via compound bracket assignment to blocked prop
await shouldThrowRun(
  'var o = {}; o["__proto__"] = { evil: true };',
  {}, 'compound __proto__ set blocked');

await shouldThrowRun(
  'var o = {}; o["constructor"] = function() { return "pwned"; };',
  {}, 'constructor set blocked');

// Verify chained dot access through safe properties is fine
await shouldRun(
  'var o = { a: { b: { c: 42 } } }; return o.a.b.c;',
  {}, 42, 'chained dot access safe');

// =====================================================================
// SECTION 26: Boundary conditions
// =====================================================================
section('Boundary conditions');

// Empty program
shouldCompile('', 'empty program');
shouldCompile(';', 'single semicolon');
shouldCompile('// just a comment', 'comment only');

// Very long variable name
await shouldRun(
  'var abcdefghijklmnopqrstuvwxyz = 42; return abcdefghijklmnopqrstuvwxyz;',
  {}, 42, 'long variable name');

// Many parameters
await shouldRun(
  'function f(a,b,c,d,e,f,g,h) { return a+b+c+d+e+f+g+h; } return f(1,2,3,4,5,6,7,8);',
  {}, 36, 'many params');

// Deeply nested array
await shouldRun(
  'var a = [[[[[[42]]]]]]; return a[0][0][0][0][0][0];',
  {}, 42, 'deep nested array access');

// Large object
await shouldRun(
  'var o = {}; for (var i = 0; i < 100; i++) { o["k" + i] = i; } return o["k99"];',
  {}, 99, 'large object creation');

// String with many escapes
await shouldRun(
  'return "a\\nb\\nc\\td\\te";',
  {}, 'a\nb\nc\td\te', 'multiple escapes in string');


// =====================================================================
// SECTION 27: do-while edge cases
// =====================================================================
section('do-while edge cases');

await shouldRun('var x = 0; do { x++; } while (false); return x;', {}, 1, 'do-while false runs once');
await shouldRun('var x = 0; do { x++; if (x >= 5) break; } while (true); return x;', {}, 5, 'do-while break');

// =====================================================================
// SECTION 28: Compound member expressions
// =====================================================================
section('Compound member expressions');

await shouldRun(
  'var o = { a: [1, 2, 3] }; return o.a[1];',
  {}, 2, 'dot then bracket');
await shouldRun(
  'var o = { a: { b: 42 } }; return o["a"].b;',
  {}, 42, 'bracket then dot');
await shouldRun(
  'var a = [{ x: 10 }, { x: 20 }]; return a[1].x;',
  {}, 20, 'bracket into dot');
await shouldRun(
  'var o = { a: [{ b: 99 }] }; return o.a[0].b;',
  {}, 99, 'dot bracket dot chain');

// =====================================================================
// Results
// =====================================================================
console.log('\n\n═══════════════════════════════════════');
console.log('  BATTLE TEST RESULTS');
console.log('═══════════════════════════════════════');
console.log('  Total:  ' + total);
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('═══════════════════════════════════════');

if (failed > 0) {
  console.log('\n  Failed sections:');
  Object.keys(sections).forEach(function(name) {
    if (sections[name].failed > 0) {
      console.log('    ' + name + ': ' + sections[name].failed + ' failures');
    }
  });
}

console.log('');
if (failed > 0) process.exit(1);

})().catch(function(e) { console.error('Fatal:', e); process.exit(2); });

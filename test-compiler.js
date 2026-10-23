/**
 * SafeScript compiler test suite.
 *
 * Tests the full AST-based pipeline: parse → validate → transform → emit → run.
 * Run: node test-compiler.js
 */
'use strict';

var SafeScript = require('./index');

var passed = 0, failed = 0, total = 0;

function assert(ok, label) {
  total++;
  if (ok) { passed++; }
  else { failed++; console.error('  FAIL: ' + label); }
}

function shouldCompile(source, label) {
  try {
    var result = SafeScript.compile(source);
    assert(typeof result.code === 'string', label + ' — produced code');
    assert(result.ast !== null, label + ' — produced AST');
    assert(typeof result.hash === 'string', label + ' — produced hash');
  } catch(e) {
    assert(false, label + ' — threw: ' + e.message);
  }
}

function shouldFailCompile(source, label, expectedMsg) {
  try {
    SafeScript.compile(source);
    assert(false, label + ' — expected compile error');
  } catch(e) {
    assert(true, label + ' — threw as expected');
    if (expectedMsg) {
      assert(e.message.indexOf(expectedMsg) >= 0,
        label + ' — expected msg containing "' + expectedMsg + '", got: ' + e.message);
    }
  }
}

async function shouldRun(source, scope, expected, label) {
  try {
    var result = await SafeScript.run(source, scope);
    assert(result === expected, label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(result));
  } catch(e) {
    assert(false, label + ' — threw: ' + e.message);
  }
}

async function shouldThrowRun(source, scope, label) {
  try {
    await SafeScript.run(source, scope);
    assert(false, label + ' — expected throw');
  } catch(e) {
    assert(true, label + ' — threw as expected');
  }
}

// =====================================================================
(async function() {

console.log('\n═══ SafeScript Compiler Test Suite ═══\n');

// ── 1. Parse + compile basic constructs ─────────────────────────────
console.log('── Should compile ──');

shouldCompile('var x = 1 + 2;', 'simple arithmetic');
shouldCompile('var x = "hello";', 'string literal');
shouldCompile('if (x > 0) { y = 1; } else { y = 2; }', 'if/else');
shouldCompile('for (var i = 0; i < 10; i++) { }', 'for loop');
shouldCompile('while (x > 0) { x = x - 1; }', 'while loop');
shouldCompile('do { x--; } while (x > 0);', 'do-while');
shouldCompile('function add(a, b) { return a + b; }', 'function declaration');
shouldCompile('var add = function(a, b) { return a + b; };', 'function expression');
shouldCompile('var f = (a, b) => a + b;', 'arrow function');
shouldCompile('var f = () => 42;', 'arrow no params');
shouldCompile('var arr = [1, 2, 3];', 'array literal');
shouldCompile('var obj = { a: 1, b: 2 };', 'object literal');
shouldCompile('try { x(); } catch(e) { } finally { }', 'try/catch/finally');
shouldCompile('switch(x) { case 1: break; default: break; }', 'switch');
shouldCompile('typeof x === "string"', 'typeof');
shouldCompile('var x = a || b;', 'logical or');
shouldCompile('var x = a && b;', 'logical and');
shouldCompile('var x = a ?? b;', 'nullish coalescing');
shouldCompile('var x = a > b ? a : b;', 'ternary');
shouldCompile('var x = !flag;', 'logical not');
shouldCompile('let x = 1; const y = 2;', 'let and const');
shouldCompile('for (var k in obj) { }', 'for-in');
shouldCompile('for (var v of arr) { }', 'for-of');
shouldCompile('void 0;', 'void operator');
shouldCompile('x instanceof y;', 'instanceof');
shouldCompile('var { a, b } = obj;', 'object destructuring');
shouldCompile('var [a, b] = arr;', 'array destructuring');
shouldCompile('var { a: x, ...rest } = obj;', 'object rest');
shouldCompile('function f(a, b = 1) { }', 'default params');
shouldCompile('function f(...args) { }', 'rest params');
shouldCompile('var x = { ...a, ...b };', 'object spread');
shouldCompile('var x = [...a, ...b];', 'array spread');
shouldCompile('var x = obj?.prop;', 'optional chaining');
shouldCompile('label: for (;;) { break label; }', 'labeled statement');

// async/await — NOW BLOCKED (auto-async model: compiler adds them automatically)
shouldFailCompile('async function f() { return 1; }', 'async keyword blocked', 'Blocked keyword');
shouldFailCompile('var f = async function() { };', 'async expression blocked', 'Blocked keyword');
shouldFailCompile('var x = await p;', 'await keyword blocked', 'Blocked keyword');

// ── 2. Should fail to compile ───────────────────────────────────────
console.log('── Should fail to compile ──');

shouldFailCompile('globalThis.x', 'globalThis', 'Blocked identifier');
shouldFailCompile('window.location', 'window', 'Blocked identifier');
shouldFailCompile('document.cookie', 'document', 'Blocked identifier');
shouldFailCompile('eval("bad")', 'eval', 'Blocked identifier');
shouldFailCompile('var f = Function("return 1")', 'Function', 'Blocked identifier');
shouldFailCompile('obj.constructor', 'constructor dot access', 'Blocked');
shouldFailCompile('obj.__proto__', '__proto__ dot access', 'Blocked');
shouldFailCompile('new Object()', 'new keyword', 'Blocked keyword');
shouldFailCompile('delete obj.x', 'delete keyword', 'Blocked keyword');
shouldFailCompile('class Foo {}', 'class keyword', 'Blocked keyword');
shouldFailCompile('import("module")', 'import keyword', 'Blocked keyword');
shouldFailCompile('debugger', 'debugger keyword', 'Blocked keyword');
shouldFailCompile('var x = `hello`', 'template literal', 'Template literals');
shouldFailCompile('require("fs")', 'require', 'Blocked identifier');
shouldFailCompile('process.exit()', 'process', 'Blocked identifier');
shouldFailCompile('fetch("/api")', 'fetch', 'Blocked identifier');

// ── 3. Compile + run — basic expressions ────────────────────────────
console.log('── Should run correctly ──');

await shouldRun('return 1 + 2;', {}, 3, 'simple return');
await shouldRun('return 10 - 3;', {}, 7, 'subtraction');
await shouldRun('return 4 * 5;', {}, 20, 'multiplication');
await shouldRun('return 10 / 2;', {}, 5, 'division');
await shouldRun('return 10 % 3;', {}, 1, 'modulo');
await shouldRun('return 2 ** 8;', {}, 256, 'exponentiation');

// Scope injection
await shouldRun('return x + y;', { x: 10, y: 20 }, 30, 'scope variables');
await shouldRun('return msg.length;', { msg: 'hello' }, 5, 'dot access on scope');
await shouldRun('return fn(3, 4);', { fn: function(a, b) { return a + b; } }, 7, 'injected function');

// Variables and control flow
await shouldRun('var x = 5; return x * 2;', {}, 10, 'var declaration');
await shouldRun('let x = 5; return x * 2;', {}, 10, 'let declaration');
await shouldRun('const x = 5; return x * 2;', {}, 10, 'const declaration');
await shouldRun('if (true) { return 1; } else { return 2; }', {}, 1, 'if true');
await shouldRun('if (false) { return 1; } else { return 2; }', {}, 2, 'if false');

// Loops
await shouldRun('var s = 0; for (var i = 0; i < 5; i++) { s = s + i; } return s;',
  {}, 10, 'for loop sum');
await shouldRun('var s = 0; var i = 5; while (i > 0) { s = s + i; i--; } return s;',
  {}, 15, 'while loop sum');
await shouldRun('var s = 0; var i = 0; do { s = s + 1; i++; } while (i < 3); return s;',
  {}, 3, 'do-while');

// Functions
await shouldRun('function add(a, b) { return a + b; } return add(3, 4);',
  {}, 7, 'function declaration call');
await shouldRun('var double = function(n) { return n * 2; }; return double(5);',
  {}, 10, 'function expression call');
await shouldRun('var add = (a, b) => a + b; return add(3, 4);',
  {}, 7, 'arrow function');
await shouldRun('var f = () => 42; return f();',
  {}, 42, 'arrow no params');

// Try/catch
await shouldRun('try { throw "err"; } catch(e) { return e; }', {}, 'err', 'try/catch');

// Switch
await shouldRun('var x = 2; switch(x) { case 1: return "a"; case 2: return "b"; default: return "c"; }',
  {}, 'b', 'switch case');

// Ternary
await shouldRun('return true ? "yes" : "no";', {}, 'yes', 'ternary true');
await shouldRun('return false ? "yes" : "no";', {}, 'no', 'ternary false');

// Typeof
await shouldRun('return typeof x;', {}, 'undefined', 'typeof undefined');
await shouldRun('return typeof "hello";', {}, 'string', 'typeof string');

// Logical operators
await shouldRun('return 0 || 5;', {}, 5, 'logical or');
await shouldRun('return 1 && 5;', {}, 5, 'logical and');
await shouldRun('return null ?? 42;', {}, 42, 'nullish coalescing');

// ── 4. Bracket access → __at/__set rewriting ────────────────────────
console.log('── Bracket access rewriting ──');

await shouldRun('var arr = [10, 20, 30]; return arr[0];',
  {}, 10, 'array index read');
await shouldRun('var arr = [10, 20, 30]; return arr[2];',
  {}, 30, 'array index read [2]');
await shouldRun('var obj = { x: 42 }; return obj["x"];',
  {}, 42, 'bracket string read');
await shouldRun('var arr = [0, 0]; arr[0] = 99; return arr[0];',
  {}, 99, 'bracket write');

// Blocked property — bracket access returns undefined via __at
await shouldRun('var obj = { name: "test" }; return obj["constructor"];',
  {}, undefined, '__at blocks constructor via bracket');
await shouldRun('var obj = {}; return obj["__proto__"];',
  {}, undefined, '__at blocks __proto__ via bracket');

// Blocked property — bracket write throws via __set
await shouldThrowRun('var obj = {}; obj["constructor"] = "evil"; return true;',
  {}, '__set throws on constructor write');
await shouldThrowRun('var obj = {}; obj["__proto__"] = {}; return true;',
  {}, '__set throws on __proto__ write');

// String concat bypass — __at still catches it
await shouldRun('var key = "con" + "structor"; var obj = {}; return obj[key];',
  {}, undefined, 'string concat → __at blocks constructed key');

// ── 5. Security: globals are shadowed ───────────────────────────────
console.log('── Global shadowing ──');

await shouldRun('return typeof Object;', {}, 'undefined', 'Object shadowed');
await shouldRun('return typeof Array;', {}, 'undefined', 'Array shadowed');
await shouldRun('return typeof console;', {}, 'undefined', 'console shadowed');
await shouldRun('return typeof JSON;', {}, 'undefined', 'JSON shadowed');
await shouldRun('return typeof Math;', {}, 'undefined', 'Math shadowed');
await shouldRun('return typeof Date;', {}, 'undefined', 'Date shadowed');
await shouldRun('return typeof Promise;', {}, 'undefined', 'Promise shadowed');

// But scope-injected capabilities work
await shouldRun('return typeof Date;', { Date: Date }, 'function', 'Date injected via scope');
await shouldRun('return JSON.stringify({ a: 1 });', { JSON: JSON }, '{"a":1}', 'JSON injected via scope');

// ── 6. AST hashing ─────────────────────────────────────────────────
console.log('── AST hashing ──');

(function() {
  var r1 = SafeScript.compile('var x = 1 + 2;');
  var r2 = SafeScript.compile('var   x   =   1   +   2  ;');
  var r3 = SafeScript.compile('// comment\nvar x = 1 + 2;');
  var r4 = SafeScript.compile('var x = 1 + 3;');

  assert(r1.hash === r2.hash, 'whitespace difference → same hash');
  assert(r1.hash === r3.hash, 'comment difference → same hash');
  assert(r1.hash !== r4.hash, 'different code → different hash');
  assert(typeof r1.hash === 'string' && r1.hash.length === 64, 'hash is sha256 hex');
})();

// ── 7. Destructuring ────────────────────────────────────────────────
console.log('── Destructuring ──');

await shouldRun('var { a, b } = { a: 1, b: 2 }; return a + b;', {}, 3, 'object destructuring');
await shouldRun('var [a, b] = [10, 20]; return a + b;', {}, 30, 'array destructuring');
await shouldRun('var { a: x } = { a: 42 }; return x;', {}, 42, 'object destructuring rename');
await shouldRun('function f({ a, b }) { return a + b; } return f({ a: 3, b: 4 });',
  {}, 7, 'destructured params');
await shouldRun('var [a, ...rest] = [1, 2, 3]; return rest.length;',
  {}, 2, 'array destructuring rest');

// ── 8. Spread ───────────────────────────────────────────────────────
console.log('── Spread ──');

await shouldRun('var a = [1, 2]; var b = [0, ...a, 3]; return b.length;',
  {}, 4, 'array spread');

// ── 9. Default parameters ──────────────────────────────────────────
console.log('── Default parameters ──');

await shouldRun('function f(a, b) { if (b === undefined) b = 10; return a + b; } return f(5);',
  {}, 15, 'manual default param');
await shouldRun('var f = (a, b = 10) => a + b; return f(5);',
  {}, 15, 'arrow default param');

// ── 10. Sanitizer ──────────────────────────────────────────────────
console.log('── Sanitizer ──');

(function() {
  var obj = { a: 1, b: { c: 2 } };
  var s = SafeScript.sanitize(obj);
  assert(s.a === 1, 'sanitize preserves values');
  assert(s.b.c === 2, 'sanitize preserves nested');
  assert(s.constructor === undefined, 'sanitized has no constructor');
  assert(Object.getPrototypeOf(s) === null, 'sanitized has null prototype');

  var cycle = { a: 1 };
  cycle.self = cycle;
  var sc = SafeScript.sanitize(cycle);
  assert(sc.a === 1, 'sanitize handles cycle');
  assert(sc.self === sc, 'sanitize preserves cycle ref');
})();

// ── 11. Validate API ───────────────────────────────────────────────
console.log('── Validate API ──');

(function() {
  var r1 = SafeScript.validate('var x = 1;');
  assert(r1.ok === true, 'validate accepts clean code');

  var r2 = SafeScript.validate('eval("bad")');
  assert(r2.ok === false, 'validate rejects eval');
  assert(r2.errors.length > 0, 'validate returns errors');

  var r3 = SafeScript.validate('new Object()');
  assert(r3.ok === false, 'validate rejects new');
})();

// ── 12. For-in / For-of ─────────────────────────────────────────────
console.log('── For-in / For-of ──');

await shouldRun(
  'var keys = []; var obj = { a: 1, b: 2 }; for (var k in obj) { keys.push(k); } return keys.length;',
  {}, 2, 'for-in collects keys');
await shouldRun(
  'var sum = 0; var arr = [1, 2, 3]; for (var v of arr) { sum = sum + v; } return sum;',
  {}, 6, 'for-of sums values');

// ── 13. Auto-async model ────────────────────────────────────────────
console.log('── Auto-async model ──');

// run() always returns a Promise
(function() {
  var result = SafeScript.run('return 1;', {});
  assert(result && typeof result.then === 'function', 'run() returns a Promise');
})();

// Auto-await: injected async functions resolve transparently
await shouldRun('return fn();', {
  fn: function() { return Promise.resolve(42); }
}, 42, 'auto-await resolves injected Promise');

// Auto-await: non-Promise values pass through
await shouldRun('return fn();', {
  fn: function() { return 7; }
}, 7, 'auto-await is no-op on non-Promise');

// Timeout option — verify that timeout rejects the Promise
// Use a never-resolving promise (no timer) so nothing holds the event loop after race
var timeoutThrew = false;
try {
  await SafeScript.run(
    'return hang();',
    { hang: function() { return new Promise(function() {}); } },  // never resolves
    { timeout: 50 }
  );
} catch(e) {
  timeoutThrew = true;
  assert(e.message.indexOf('timed out') >= 0, 'timeout error message');
}
assert(timeoutThrew, 'timeout throws on slow execution');

// ── Guards (__check) ─────────────────────────────────────────────────
console.log('── Guards ──');

// Infinite while loop
try {
  await SafeScript.run('while (true) {}', {}, {maxOps: 500});
  assert(false, 'infinite while should throw');
} catch(e) {
  assert(e.message.indexOf('operations exceeded') >= 0, 'infinite while — ops exceeded');
}

// Infinite for loop
try {
  await SafeScript.run('for (;;) {}', {}, {maxOps: 500});
  assert(false, 'infinite for should throw');
} catch(e) {
  assert(e.message.indexOf('operations exceeded') >= 0, 'infinite for — ops exceeded');
}

// Infinite do-while
try {
  await SafeScript.run('do {} while (true)', {}, {maxOps: 500});
  assert(false, 'infinite do-while should throw');
} catch(e) {
  assert(e.message.indexOf('operations exceeded') >= 0, 'infinite do-while — ops exceeded');
}

// Infinite recursion
try {
  await SafeScript.run('function f() { return f() } return f()', {}, {maxOps: 500});
  assert(false, 'infinite recursion should throw');
} catch(e) {
  assert(e.message.indexOf('operations exceeded') >= 0, 'infinite recursion — ops exceeded');
}

// Arrow recursion
try {
  await SafeScript.run('var f = () => f(); return f()', {}, {maxOps: 500});
  assert(false, 'arrow recursion should throw');
} catch(e) {
  assert(e.message.indexOf('operations exceeded') >= 0, 'arrow recursion — ops exceeded');
}

// Normal script within limits
var normalResult = await SafeScript.run('var s = 0; for (var i = 0; i < 100; i++) { s = s + i } return s', {}, {maxOps: 50000});
assert(normalResult === 4950, 'normal loop within ops limit');

// Timeout via __check
try {
  await SafeScript.run('while (true) {}', {}, {timeout: 100, maxOps: 999999999});
  assert(false, 'timeout should throw');
} catch(e) {
  assert(e.message.indexOf('timed out') >= 0, 'timeout via __check');
}

// ── Hooks ─────────────────────────────────────────────────────────────
console.log('── Hooks ──');

// beforeCall — log
var hookLog = [];
var hookR1 = await SafeScript.run('return greet("world")', {
  greet: function(name) { return 'hello ' + name; }
}, {
  hooks: {
    beforeCall: function(info) { hookLog.push('before:' + info.name); }
  }
});
assert(hookR1 === 'hello world', 'hooks beforeCall — result correct');
assert(hookLog[0] === 'before:greet', 'hooks beforeCall — logged');

// beforeCall — block
var hookR2 = await SafeScript.run('return dangerous("x")', {
  dangerous: function(x) { return 'EXECUTED:' + x; }
}, {
  hooks: {
    beforeCall: function(info) { if (info.name === 'dangerous') return false; }
  }
});
assert(hookR2 === undefined, 'hooks beforeCall — block returns undefined');

// beforeCall — short-circuit
var hookR3 = await SafeScript.run('return loadData("k1")', {
  loadData: function(k) { return 'real:' + k; }
}, {
  hooks: {
    beforeCall: function(info) {
      if (info.name === 'loadData') return {value: 'cached:' + info.args[0]};
    }
  }
});
assert(hookR3 === 'cached:k1', 'hooks beforeCall — short-circuit');

// beforeCall — transform args
var hookR4 = await SafeScript.run('return add(1, 2)', {
  add: function(a, b) { return a + b; }
}, {
  hooks: {
    beforeCall: function(info) {
      return {args: info.args.map(function(a) { return a * 2; })};
    }
  }
});
assert(hookR4 === 6, 'hooks beforeCall — transform args');

// afterCall — replace result
var hookR5 = await SafeScript.run('return compute(5)', {
  compute: function(x) { return x * x; }
}, {
  hooks: {
    afterCall: function(info) {
      if (info.result > 20) return {value: 20};
    }
  }
});
assert(hookR5 === 20, 'hooks afterCall — cap result');

// afterCall — block
var hookR6 = await SafeScript.run('return getData()', {
  getData: function() { return {secret: 'password'}; }
}, {
  hooks: {
    afterCall: function(info) { return false; }
  }
});
assert(hookR6 === undefined, 'hooks afterCall — block returns undefined');

// Resource throttling use case
var callCount = 0;
try {
  await SafeScript.run(
    'var r = []; for (var i = 0; i < 10; i++) { r.push(loadItem(i)) } return r',
    { loadItem: function(id) { return 'data:' + id; } },
    {
      hooks: {
        beforeCall: function(info) {
          if (info.name === 'loadItem') {
            callCount++;
            if (callCount > 3) throw new Error('too many loadItem calls');
          }
        }
      }
    }
  );
  assert(false, 'resource throttle should throw');
} catch(e) {
  assert(e.message.indexOf('too many loadItem calls') >= 0, 'hooks — resource throttle');
}

// ── Results ─────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log('  Total:  ' + total);
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('═══════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);

})();

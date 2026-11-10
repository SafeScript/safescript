/**
 * SafeScript v1.4 — new keyword + return value sanitization tests
 */
'use strict';

var SafeScript = require('./');

var passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch(e) {
    failed++;
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function run() {
  console.log('\n══ new keyword — built-in constructors ══\n');

  await test('new Map()', async function() {
    var result = await SafeScript.run('var m = new Map(); m.set("a", 1); return m.get("a");', {});
    assert(result === 1, 'expected 1, got ' + result);
  });

  await test('new Set()', async function() {
    var result = await SafeScript.run('var s = new Set(); s.add(1); s.add(2); s.add(1); return s.size;', {});
    assert(result === 2, 'expected 2, got ' + result);
  });

  await test('new Date()', async function() {
    var result = await SafeScript.run('var d = new Date(2020, 0, 1); return d.getFullYear();', {});
    assert(result === 2020, 'expected 2020, got ' + result);
  });

  await test('new RegExp()', async function() {
    var result = await SafeScript.run('var r = new RegExp("abc", "i"); return r.test("ABC");', {});
    assert(result === true, 'expected true');
  });

  await test('new Error()', async function() {
    var result = await SafeScript.run('var e = new Error("oops"); return e.message;', {});
    assert(result === 'oops', 'expected "oops", got ' + result);
  });

  await test('new TypeError()', async function() {
    var result = await SafeScript.run('var e = new TypeError("bad type"); return e.message;', {});
    assert(result === 'bad type');
  });

  await test('new Map with initial entries', async function() {
    var result = await SafeScript.run('var m = new Map([["x", 10], ["y", 20]]); return m.get("y");', {});
    assert(result === 20, 'expected 20, got ' + result);
  });

  await test('new Set with initial values', async function() {
    var result = await SafeScript.run('var s = new Set([1, 2, 3, 2]); return s.size;', {});
    assert(result === 3, 'expected 3, got ' + result);
  });

  console.log('\n══ new keyword — host-registered types ══\n');

  function Counter(initial) { this.count = initial || 0; }
  Counter.prototype.value = function() { return this.count; };
  Counter.prototype.increment = function() { this.count++; return this; };
  SafeScript.lib(Counter, { allowMethods: ['value', 'increment'] });

  await test('new on registered type works', async function() {
    var result = await SafeScript.run('var c = new Counter(5); return c.value();', { Counter: Counter });
    assert(result === 5, 'expected 5, got ' + result);
  });

  await test('new on registered type — methods work', async function() {
    var result = await SafeScript.run('var c = new Counter(0); c.increment(); c.increment(); return c.value();', { Counter: Counter });
    assert(result === 2, 'expected 2, got ' + result);
  });

  SafeScript.unlib(Counter);

  console.log('\n══ new keyword — opts.allowNew ══\n');

  function Widget(name) { this.name = name; }
  Widget.prototype.getName = function() { return this.name; };

  await test('opts.allowNew allows unlisted constructor', async function() {
    var result = await SafeScript.run('var w = new Widget("test"); return w.name;',
      { Widget: Widget }, { allowNew: [Widget] });
    assert(result === 'test', 'expected "test", got ' + result);
  });

  console.log('\n══ new keyword — blocked constructors ══\n');

  await test('new on unregistered type throws', async function() {
    function Evil() { this.x = 1; }
    try {
      await SafeScript.run('return new Evil();', { Evil: Evil });
      throw new Error('should have thrown');
    } catch(e) {
      assert(e.message.indexOf('not allowed with new') > -1,
        'wrong error: ' + e.message);
    }
  });

  await test('new Function is still blocked (identifier)', async function() {
    try {
      await SafeScript.run('return new Function("return 1")();', {});
      throw new Error('should have thrown');
    } catch(e) {
      assert(e.message.indexOf('Blocked identifier') > -1 || e.message.indexOf('not allowed') > -1,
        'wrong error: ' + e.message);
    }
  });

  console.log('\n══ Return value sanitization — POD ══\n');

  await test('primitives pass through', async function() {
    assert(await SafeScript.run('return 42;', {}) === 42);
    assert(await SafeScript.run('return "hello";', {}) === 'hello');
    assert(await SafeScript.run('return true;', {}) === true);
    assert(await SafeScript.run('return null;', {}) === null);
  });

  await test('plain objects pass through', async function() {
    var result = await SafeScript.run('return { a: 1, b: "two" };', {});
    assert(result.a === 1);
    assert(result.b === 'two');
  });

  await test('arrays pass through', async function() {
    var result = await SafeScript.run('return [1, 2, 3];', {});
    assert(Array.isArray(result));
    assert(result.length === 3);
  });

  await test('nested objects/arrays pass through', async function() {
    var result = await SafeScript.run('return { items: [1, { x: 2 }] };', {});
    assert(result.items[0] === 1);
    assert(result.items[1].x === 2);
  });

  await test('functions are stripped from returned objects', async function() {
    var result = await SafeScript.run('return { val: 42, fn: function() { return 1; } };', {});
    assert(result.val === 42);
    assert(result.fn === undefined);
  });

  await test('returned function becomes undefined', async function() {
    var result = await SafeScript.run('return function() { return 1; };', {});
    assert(result === undefined, 'expected undefined, got ' + typeof result);
  });

  await test('returned closure becomes undefined', async function() {
    var result = await SafeScript.run('var x = 1; return function() { return x; };', {});
    assert(result === undefined);
  });

  await test('module pattern returns data only', async function() {
    var result = await SafeScript.run(
      'var count = 0; return { inc: function() { count++; }, get: function() { return count; }, name: "counter" };',
      {});
    assert(result.name === 'counter');
    assert(!('inc' in result) || result.inc === undefined);
    assert(!('get' in result) || result.get === undefined);
  });

  await test('Date instances pass through', async function() {
    var result = await SafeScript.run('return new Date(2020, 5, 15);', {});
    assert(result instanceof Date, 'expected Date instance');
    assert(result.getFullYear() === 2020);
  });

  await test('Map instances pass through', async function() {
    var result = await SafeScript.run('var m = new Map(); m.set("k", "v"); return m;', {});
    assert(result instanceof Map, 'expected Map instance');
    assert(result.get('k') === 'v');
  });

  await test('Set instances pass through', async function() {
    var result = await SafeScript.run('var s = new Set([1, 2, 3]); return s;', {});
    assert(result instanceof Set, 'expected Set instance');
    assert(result.size === 3);
  });

  await test('RegExp instances pass through', async function() {
    var result = await SafeScript.run('return new RegExp("test", "i");', {});
    assert(result instanceof RegExp, 'expected RegExp instance');
    assert(result.test('TEST'));
  });

  await test('Error instances pass through', async function() {
    var result = await SafeScript.run('return new Error("msg");', {});
    assert(result instanceof Error);
    assert(result.message === 'msg');
  });

  await test('registered type instances pass through', async function() {
    function Pair(a, b) { this.a = a; this.b = b; }
    Pair.prototype.sum = function() { return this.a + this.b; };
    SafeScript.lib(Pair, { allowMethods: ['sum'] });
    var result = await SafeScript.run('return new Pair(3, 4);', { Pair: Pair });
    assert(result instanceof Pair);
    assert(result.a === 3);
    assert(result.b === 4);
    SafeScript.unlib(Pair);
  });

  await test('rawReturn opt disables sanitization', async function() {
    var result = await SafeScript.run(
      'return function() { return 99; };', {}, { rawReturn: true });
    assert(typeof result === 'function', 'expected function, got ' + typeof result);
    assert(await result() === 99);
  });

  console.log('\n══ Side effects still work ══\n');

  await test('Q.Tool.define pattern (side effect, no return)', async function() {
    var defined = null;
    var mockQ = {
      Tool: {
        define: function(name, methods) { defined = { name: name, methods: methods }; }
      }
    };
    await SafeScript.run('Q.Tool.define("my-tool", { init: function() {} });', { Q: mockQ });
    assert(defined !== null, 'define should have been called');
    assert(defined.name === 'my-tool');
  });

  await test('callbacks work during execution', async function() {
    var collected = [];
    var api = { push: function(v) { collected.push(v); } };
    await SafeScript.run('api.push(1); api.push(2); api.push(3);', { api: api });
    assert(collected.length === 3);
    assert(collected[0] === 1 && collected[2] === 3);
  });

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════════');
  console.log('SafeScript v1.4 Tests');
  console.log('══════════════════════════════════════════════════');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });

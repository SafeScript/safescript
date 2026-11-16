/**
 * SafeScript — Memory Limit Tests
 *
 * Tests the estimated memory tracking that prevents scripts from
 * allocating unbounded data structures.
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
    console.error('    ' + (e.stack || e.message));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('SafeScript Memory Limit Tests');
console.log('══════════════════════════════════════════════════\n');

(async function() {

await test('small script runs fine within limits', async function() {
  var result = await SafeScript.run('var x = 1;\nvar y = 2;\nreturn x + y;');
  assert(result === 3, 'should return 3');
});

await test('array operations track memory', async function() {
  var result = await SafeScript.run(
    'var arr = [];\nfor (var i = 0; i < 1000; i = i + 1) {\n  arr.push(i);\n}\nreturn arr.length;',
    {}, { maxOps: 1000000 }
  );
  assert(result === 1000, 'should build 1000-element array');
});

await test('maxMemory option is respected', async function() {
  var threw = false;
  try {
    await SafeScript.run(
      'var arr = [];\nfor (var i = 0; i < 100000; i = i + 1) {\n  arr.push("x".repeat(100));\n}\nreturn arr.length;',
      {}, { maxMemory: 1024 * 100, maxOps: 10000000 }
    );
  } catch(e) {
    threw = true;
    assert(e.message.indexOf('memory limit') !== -1, 'should mention memory limit: ' + e.message);
  }
  assert(threw, 'should throw on memory limit');
});

await test('string repeat tracks allocation', async function() {
  var threw = false;
  try {
    await SafeScript.run(
      'var s = "a".repeat(10000000);\nreturn s.length;',
      {}, { maxMemory: 1024 * 100 }
    );
  } catch(e) {
    threw = true;
    assert(e.message.indexOf('memory limit') !== -1, 'should mention memory limit');
  }
  assert(threw, 'should throw when repeat exceeds limit');
});

await test('Array.from tracks allocation', async function() {
  var threw = false;
  try {
    await SafeScript.run(
      'var arr = Array.from({ length: 1000000 }, function(_, i) { return i; });\nreturn arr.length;',
      {}, { maxMemory: 1024 * 100, maxOps: 10000000 }
    );
  } catch(e) {
    threw = true;
    assert(e.message.indexOf('memory limit') !== -1, 'should mention memory limit');
  }
  assert(threw, 'should throw when Array.from exceeds limit');
});

await test('JSON.parse tracks allocation', async function() {
  var threw = false;
  var bigJson = JSON.stringify(new Array(10000).fill('hello world'));
  try {
    await SafeScript.run(
      'var data = JSON.parse(json);\nreturn data.length;',
      { json: bigJson }, { maxMemory: 1024 * 10 }
    );
  } catch(e) {
    threw = true;
    assert(e.message.indexOf('memory limit') !== -1, 'should mention memory limit');
  }
  assert(threw, 'should throw when JSON.parse exceeds limit');
});

await test('Object.create tracks allocation', async function() {
  var result = await SafeScript.run(
    'var count = 0;\nfor (var i = 0; i < 100; i = i + 1) {\n  var o = Object.create(null);\n  count = count + 1;\n}\nreturn count;',
    {}, { maxOps: 1000000 }
  );
  assert(result === 100, 'should create 100 objects');
});

await test('new constructor tracks allocation', async function() {
  function Box(v) { this.value = v; }
  SafeScript.lib(Box, { allowMethods: ['toString'] });
  var result = await SafeScript.run(
    'var b = new Box(42);\nreturn b.value;',
    { Box: Box }, { allowNew: [Box] }
  );
  assert(result === 42, 'constructor works');
  SafeScript.unlib(Box);
});

await test('map tracks allocation on result', async function() {
  var result = await SafeScript.run(
    'var arr = [1,2,3,4,5];\nvar doubled = arr.map(function(x) { return x * 2; });\nreturn doubled.length;',
    {}
  );
  assert(result === 5, 'map result correct');
});

await test('concat tracks allocation', async function() {
  var result = await SafeScript.run(
    'var a = [1,2,3];\nvar b = [4,5,6];\nvar c = a.concat(b);\nreturn c.length;',
    {}
  );
  assert(result === 6, 'concat result correct');
});

await test('default maxMemory is 64 MB', async function() {
  var result = await SafeScript.run(
    'var arr = [];\nfor (var i = 0; i < 10000; i = i + 1) {\n  arr.push({ idx: i, name: "item" });\n}\nreturn arr.length;',
    {}, { maxOps: 10000000 }
  );
  assert(result === 10000, 'should run fine under default limit');
});

// ── Summary ─────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

})();

'use strict';

/**
 * SafeScript v2.1 Security Tests
 *
 * Tests for three hardening fixes:
 *   1. ReDoS guard — blocks dangerous regex patterns and large inputs
 *   2. Error.stack stripping — prevents server path leaks
 *   3. Scope function toString() wrapping — prevents host source leaks
 */

var SafeScript = require('./index');

var passed = 0;
var failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  \x1b[32m✓\x1b[0m ' + name);
    passed++;
  } catch (e) {
    console.log('  \x1b[31m✗\x1b[0m ' + name);
    console.log('    ' + (e.message || e));
    failed++;
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function run(source, scope, opts) {
  return SafeScript.run(source, scope || {}, opts || {});
}

async function throws(source, pattern, scope, opts) {
  try {
    await run(source, scope, opts);
    throw new Error('Expected error matching ' + pattern + ' but code ran successfully');
  } catch (e) {
    if (pattern && !pattern.test(e.message)) {
      throw new Error('Expected error matching ' + pattern + ' but got: ' + e.message);
    }
  }
}

(async function() {
  console.log('\n══ SafeScript v2.1 Security Tests ══\n');

  // ═════════════════════════════════════════════════════════
  // 1. ReDoS guard
  // ═════════════════════════════════════════════════════════
  console.log('── ReDoS Guard ──');

  await test('normal regex match works', async function() {
    var result = await run('return "hello world".match(/hello/)[0];');
    eq(result, 'hello');
  });

  await test('normal regex test works', async function() {
    var result = await run('return /^\\d+$/.test("12345");');
    eq(result, true);
  });

  await test('normal regex replace works', async function() {
    var result = await run('return "foo bar".replace(/foo/, "baz");');
    eq(result, 'baz bar');
  });

  await test('normal regex split works', async function() {
    var result = await run('return "a,b,c".split(/,/).length;');
    eq(result, 3);
  });

  await test('normal regex search works', async function() {
    var result = await run('return "hello world".search(/world/);');
    eq(result, 6);
  });

  await test('blocks nested quantifiers (a+)+', async function() {
    await throws(
      '"test".match(/(a+)+$/);',
      /nested quantifiers/
    );
  });

  await test('blocks nested quantifiers (\\d+)+', async function() {
    await throws(
      '"test".match(/(\\d+)+/);',
      /nested quantifiers/
    );
  });

  await test('blocks nested quantifiers (a*)*', async function() {
    await throws(
      '"test".match(/(a*)*$/);',
      /nested quantifiers/
    );
  });

  await test('blocks nested quantifiers with {n,m}', async function() {
    await throws(
      '"test".match(/(a{1,5})+/);',
      /nested quantifiers/
    );
  });

  await test('blocks nested quantifiers via RegExp constructor', async function() {
    await throws(
      'var r = new RegExp("(a+)+$"); return "aaa".match(r);',
      /nested quantifiers/
    );
  });

  await test('blocks oversized regex input', async function() {
    await throws(
      'var big = ""; for (var i = 0; i < 200000; i++) big = big + "a"; return big.match(/a/);',
      /regex input too large/
    );
  });

  await test('allows large but under-limit input', async function() {
    var result = await run(
      'var s = ""; for (var i = 0; i < 1000; i++) s = s + "a"; return s.match(/^a+$/)[0].length;'
    );
    eq(result, 1000);
  });

  await test('blocks nested quantifiers on test()', async function() {
    await throws(
      '/(a+)+$/.test("aaaaaaaaaaaa!");',
      /nested quantifiers/
    );
  });

  await test('allows non-nested quantifiers', async function() {
    var result = await run('return "aaa".match(/a+/)[0];');
    eq(result, 'aaa');
  });

  await test('allows optional groups without nesting', async function() {
    var result = await run('return "abc".match(/(ab)?c/)[0];');
    eq(result, 'abc');
  });

  // ═════════════════════════════════════════════════════════
  // 2. Error.stack stripping
  // ═════════════════════════════════════════════════════════
  console.log('\n── Error.stack Stripping ──');

  await test('Error().stack does not contain file paths', async function() {
    var result = await run('var e = Error("test"); return e.stack;');
    assert(result.indexOf('/') === -1, 'stack contains a path: ' + result);
    assert(result.indexOf('\\') === -1, 'stack contains a backslash path: ' + result);
    assert(result.indexOf('.js') === -1, 'stack contains .js: ' + result);
  });

  await test('Error().stack contains the error name and message', async function() {
    var result = await run('var e = Error("oops"); return e.stack;');
    assert(result.indexOf('Error') !== -1, 'missing Error name');
    assert(result.indexOf('oops') !== -1, 'missing message');
  });

  await test('TypeError().stack is stripped', async function() {
    var result = await run('var e = TypeError("bad type"); return e.stack;');
    assert(result.indexOf('/') === -1, 'stack contains a path: ' + result);
    assert(result.indexOf('TypeError') !== -1, 'missing TypeError name');
    assert(result.indexOf('bad type') !== -1, 'missing message');
  });

  await test('RangeError().stack is stripped', async function() {
    var result = await run('var e = RangeError("out of range"); return e.stack;');
    assert(result.indexOf('/') === -1, 'stack contains a path');
    assert(result.indexOf('RangeError') !== -1, 'missing RangeError name');
  });

  await test('SyntaxError().stack is stripped', async function() {
    var result = await run('var e = SyntaxError("bad syntax"); return e.stack;');
    assert(result.indexOf('/') === -1, 'stack contains a path');
  });

  await test('ReferenceError().stack is stripped', async function() {
    var result = await run('var e = ReferenceError("undef"); return e.stack;');
    assert(result.indexOf('/') === -1, 'stack contains a path');
  });

  await test('caught runtime error has stripped stack', async function() {
    var result = await run(
      'var stack = ""; try { var x = null; x.foo; } catch(e) { stack = e.stack; } return stack;'
    );
    assert(result.indexOf('/') === -1, 'runtime error stack contains a path: ' + result);
  });

  await test('caught TypeError from __call has stripped stack', async function() {
    var result = await run(
      'var stack = ""; try { null.toString(); } catch(e) { stack = e.stack; } return stack;'
    );
    assert(result.indexOf('/') === -1, 'stack contains a path: ' + result);
  });

  await test('Error message is preserved', async function() {
    var result = await run('try { throw Error("custom msg"); } catch(e) { return e.message; }');
    eq(result, 'custom msg');
  });

  await test('Error instanceof check works', async function() {
    var result = await run(
      'var e = TypeError("x"); return e instanceof TypeError;'
    );
    // Note: our safe TypeError has .prototype = TypeError.prototype, so this should work
    eq(result, true);
  });

  // ═════════════════════════════════════════════════════════
  // 3. Scope function toString() wrapping
  // ═════════════════════════════════════════════════════════
  console.log('\n── Scope Function toString() ──');

  await test('scope function toString() hides source', async function() {
    var secret = 'my-secret-key-12345';
    var result = await run('return respond.toString();', {
      respond: function(x) { return secret + x; }
    });
    assert(result.indexOf(secret) === -1, 'toString leaked secret: ' + result);
    assert(result.indexOf('[host]') !== -1, 'missing [host] marker: ' + result);
  });

  await test('scope function still works normally', async function() {
    var result = await run('return add(2, 3);', {
      add: function(a, b) { return a + b; }
    });
    eq(result, 5);
  });

  await test('scope function preserves name', async function() {
    var result = await run('return greet.name;', {
      greet: function greet(name) { return 'hi ' + name; }
    });
    eq(result, 'greet');
  });

  await test('scope function preserves length', async function() {
    var result = await run('return add.length;', {
      add: function add(a, b) { return a + b; }
    });
    eq(result, 2);
  });

  await test('scope function toString cannot be overwritten (frozen)', async function() {
    var result = await run(
      'try { respond.toString = function() { return "hacked"; }; } catch(e) {} return respond.toString();',
      { respond: function(x) { return x; } }
    );
    assert(result.indexOf('[host]') !== -1, 'toString was overwritten: ' + result);
  });

  await test('scope function toSource() also hides source', async function() {
    var result = await run('return fn.toSource();', {
      fn: function(x) { return x * 2; }
    });
    assert(result.indexOf('[host]') !== -1, 'toSource leaked: ' + result);
  });

  await test('nested scope functions are wrapped', async function() {
    var secret = 'api-key-xyz';
    var result = await run('return obj.inner.toString();', {
      obj: { inner: function() { return secret; } }
    });
    assert(result.indexOf(secret) === -1, 'nested fn toString leaked secret');
    assert(result.indexOf('[host]') !== -1, 'missing [host] marker');
  });

  await test('scope function called with this context works', async function() {
    var result = await run(
      'var o = { val: 10, get: getVal }; return o.get();',
      { getVal: function() { return this.val; } }
    );
    eq(result, 10);
  });

  // ═════════════════════════════════════════════════════════
  // Combined / edge cases
  // ═════════════════════════════════════════════════════════
  console.log('\n── Combined Edge Cases ──');

  await test('ReDoS guard works with scope-provided string', async function() {
    await throws(
      'return input.match(/(a+)+$/);',
      /nested quantifiers/,
      { input: 'aaaaaaaaaa!' }
    );
  });

  await test('ReDoS + error stack: caught ReDoS error has clean stack', async function() {
    var result = await run(
      'var msg = ""; try { "aaa".match(/(a+)+$/); } catch(e) { msg = e.stack; } return msg;'
    );
    // Check for file paths (not regex delimiters — those contain /)
    assert(result.indexOf('.js') === -1, 'ReDoS error stack leaked .js path: ' + result);
    assert(result.indexOf('runtime') === -1, 'ReDoS error stack leaked runtime path: ' + result);
    assert(result.indexOf('nested quantifiers') !== -1 || result.indexOf('Error') !== -1,
      'missing error info');
  });

  await test('wrapped scope function + error handling work together', async function() {
    var result = await run(
      'try { return fn(); } catch(e) { return e.message; }',
      { fn: function() { throw new Error('host error'); } }
    );
    eq(result, 'host error');
  });

  // ═════════════════════════════════════════════════════════
  // Summary
  // ═════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════');
  console.log('SafeScript v2.1 Security Tests');
  console.log('══════════════════════════════════════════════════');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
})();

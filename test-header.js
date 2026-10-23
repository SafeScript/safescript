/**
 * SafeScript header parser tests.
 */
'use strict';

var SafeScript = require('./index');
var header = require('./src/header');

var pass = 0, fail = 0;

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL: ' + msg);
  }
}

function eq(a, b, msg) {
  var as = JSON.stringify(a), bs = JSON.stringify(b);
  if (as === bs) {
    pass++;
  } else {
    fail++;
    console.log('FAIL: ' + msg);
    console.log('  expected: ' + bs);
    console.log('  got:      ' + as);
  }
}

// ── No header ───────────────────────────────────────────────────────

(function() {
  var r = SafeScript.capabilities('return 1 + 2;');
  eq(r.version, null, 'no header: version null');
  eq(r.env, null, 'no header: env null');
  eq(r.needs.length, 0, 'no header: no needs');
  eq(r.uses.length, 0, 'no header: no uses');
})();

// ── Empty header ────────────────────────────────────────────────────

(function() {
  var r = SafeScript.capabilities('/** */\nreturn 1;');
  eq(r.version, null, 'empty header: version null');
  eq(r.needs.length, 0, 'empty header: no needs');
})();

// ── @safescript version ─────────────────────────────────────────────

(function() {
  var src = '/**\n * @safescript 0.2\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.version, '0.2', '@safescript version');
})();

(function() {
  var src = '/**\n * @safescript 1.0.0-beta\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.version, '1.0.0-beta', '@safescript semver version');
})();

// ── @env ────────────────────────────────────────────────────────────

(function() {
  var src = '/**\n * @env browser\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.env, ['browser'], '@env single');
})();

(function() {
  var src = '/**\n * @env browser, node\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.env, ['browser', 'node'], '@env multiple');
})();

(function() {
  var src = '/**\n * @env browser,node,deno\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.env, ['browser', 'node', 'deno'], '@env no spaces');
})();

// ── @needs ──────────────────────────────────────────────────────────

(function() {
  var src = '/**\n * @needs request: Request\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.needs.length, 1, '@needs count');
  eq(r.needs[0].name, 'request', '@needs name');
  eq(r.needs[0].type, 'Request', '@needs type');
})();

(function() {
  var src = '/**\n * @needs db\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.needs.length, 1, '@needs no type: count');
  eq(r.needs[0].name, 'db', '@needs no type: name');
  eq(r.needs[0].type, null, '@needs no type: type is null');
})();

// ── @uses ───────────────────────────────────────────────────────────

(function() {
  var src = '/**\n * @uses console: Console\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.uses.length, 1, '@uses count');
  eq(r.uses[0].name, 'console', '@uses name');
  eq(r.uses[0].type, 'Console', '@uses type');
})();

(function() {
  var src = '/**\n * @uses logger\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.uses.length, 1, '@uses no type: count');
  eq(r.uses[0].name, 'logger', '@uses no type: name');
  eq(r.uses[0].type, null, '@uses no type: type is null');
})();

// ── Full header ─────────────────────────────────────────────────────

(function() {
  var src = [
    '/**',
    ' * A sample SafeScript file.',
    ' * @safescript 0.2',
    ' * @env browser, node',
    ' * @needs request: Request',
    ' * @needs response: Response',
    ' * @uses console: Console',
    ' * @uses logger: Logger',
    ' */',
    'var body = request.json();',
    'if (console) console.log(body);',
    'return response.send(body);'
  ].join('\n');
  var r = SafeScript.capabilities(src);
  eq(r.version, '0.2', 'full: version');
  eq(r.env, ['browser', 'node'], 'full: env');
  eq(r.needs.length, 2, 'full: needs count');
  eq(r.needs[0].name, 'request', 'full: needs[0] name');
  eq(r.needs[0].type, 'Request', 'full: needs[0] type');
  eq(r.needs[1].name, 'response', 'full: needs[1] name');
  eq(r.needs[1].type, 'Response', 'full: needs[1] type');
  eq(r.uses.length, 2, 'full: uses count');
  eq(r.uses[0].name, 'console', 'full: uses[0] name');
  eq(r.uses[0].type, 'Console', 'full: uses[0] type');
  eq(r.uses[1].name, 'logger', 'full: uses[1] name');
  eq(r.uses[1].type, 'Logger', 'full: uses[1] type');
})();

// ── Whitespace variations ───────────────────────────────────────────

(function() {
  // No leading * on lines
  var src = '/**\n@safescript 0.3\n@needs data: Array\n*/\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.version, '0.3', 'no asterisk prefix: version');
  eq(r.needs[0].name, 'data', 'no asterisk prefix: needs');
})();

(function() {
  // Leading whitespace before source
  var src = '  \n\n/**\n * @safescript 0.2\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.version, '0.2', 'leading whitespace: version');
})();

// ── Non-header comment ──────────────────────────────────────────────

(function() {
  // Regular single-line comment, no header
  var src = '// just a comment\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.version, null, 'line comment: no header');
})();

(function() {
  // Regular /* */ comment (not /** */) — not a header
  var src = '/* not a header */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.version, null, 'block comment without **: no header');
})();

// ── checkScope ──────────────────────────────────────────────────────

(function() {
  var src = '/**\n * @needs request: Request\n * @needs db: Database\n * @uses logger: Logger\n */\nreturn 1;';

  // All needs satisfied
  var r1 = SafeScript.checkScope(src, { request: {}, db: {} });
  eq(r1.ok, true, 'checkScope: all needs met');
  eq(r1.missing.length, 0, 'checkScope: no missing');

  // Missing one need
  var r2 = SafeScript.checkScope(src, { request: {} });
  eq(r2.ok, false, 'checkScope: missing need');
  eq(r2.missing, ['db'], 'checkScope: missing db');

  // Missing all needs
  var r3 = SafeScript.checkScope(src, {});
  eq(r3.ok, false, 'checkScope: all missing');
  eq(r3.missing, ['request', 'db'], 'checkScope: both missing');

  // No scope at all
  var r4 = SafeScript.checkScope(src, null);
  eq(r4.ok, false, 'checkScope: null scope');

  // Uses don't affect checkScope (only needs)
  var r5 = SafeScript.checkScope(src, { request: {}, db: {} });
  eq(r5.ok, true, 'checkScope: uses ignored');
})();

// ── No needs → always ok ────────────────────────────────────────────

(function() {
  var src = '/**\n * @uses logger: Logger\n */\nreturn 1;';
  var r = SafeScript.checkScope(src, {});
  eq(r.ok, true, 'checkScope: no needs always ok');
})();

(function() {
  var r = SafeScript.checkScope('return 1;', {});
  eq(r.ok, true, 'checkScope: no header always ok');
})();

// ── Integration: capabilities + run ─────────────────────────────────

(async function() {
  var src = [
    '/**',
    ' * @safescript 0.2',
    ' * @needs math: Math',
    ' */',
    'return math.sqrt(16);'
  ].join('\n');

  var caps = SafeScript.capabilities(src);
  eq(caps.version, '0.2', 'integration: version');
  eq(caps.needs[0].name, 'math', 'integration: needs math');

  var check = SafeScript.checkScope(src, { math: Math });
  eq(check.ok, true, 'integration: scope satisfies needs');

  // The header comment is valid SafeScript (it's just a comment)
  // So we can compile and run the whole file
  var result = await SafeScript.run(src, { math: Math });
  eq(result, 4, 'integration: run with satisfied scope');
})()

// ── Multiple @env edge case ─────────────────────────────────────────

.then(function() {
  // Only last @env wins
  var src = '/**\n * @env browser\n * @env node\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.env, ['node'], 'duplicate @env: last wins');
})

// ── Complex type annotations ────────────────────────────────────────

.then(function() {
  var src = '/**\n * @needs fetch: http.Fetch\n * @uses cache: storage.Cache<string>\n */\nreturn 1;';
  var r = SafeScript.capabilities(src);
  eq(r.needs[0].type, 'http.Fetch', 'dotted type');
  eq(r.uses[0].type, 'storage.Cache<string>', 'generic type');
})

// ── SafeScript.run() bundle overload ─────────────────────────────────────

.then(async function() {
  // run() with bundle object — run() now returns a Promise
  var bundle = { source: 'return x + 1;', scope: { x: 10 } };
  eq(await SafeScript.run(bundle), 11, 'run(bundle): returns result');

  // run() with bundle and opts
  var bundle2 = { source: 'return x * 2;', scope: { x: 5 } };
  eq(await SafeScript.run(bundle2), 10, 'run(bundle): scope injected');

  // run() with bundle, no scope
  var bundle3 = { source: 'return 42;', scope: {} };
  eq(await SafeScript.run(bundle3), 42, 'run(bundle): empty scope');

  // run() still works with string args
  eq(await SafeScript.run('return 7;', {}), 7, 'run(string, scope): still works');
  eq(await SafeScript.run('return a + b;', { a: 3, b: 4 }), 7, 'run(string, scope): scope works');
})

// ── SafeScript.load() (async) ────────────────────────────────────────────

.then(async function() {
  var src = [
    '/**',
    ' * @safescript 0.2',
    ' * @needs math: Math',
    ' * @uses logger: Logger',
    ' */',
    'return math.sqrt(25);'
  ].join('\n');

  // load() returns a Promise
  var loadResult = SafeScript.load(src, function(caps) {
    return { math: Math };
  });
  assert(loadResult && typeof loadResult.then === 'function', 'load: returns a Promise');

  // Basic load with sync resolver → bundle
  var bundle = await SafeScript.load(src, function(caps) {
    return { math: Math };
  });
  assert(typeof bundle.source === 'string', 'load: bundle has source');
  assert(typeof bundle.scope === 'object', 'load: bundle has scope');
  eq(await SafeScript.run(bundle), 5, 'load→run: returns correct result');

  // Resolver receives parsed header
  await SafeScript.load(src, function(caps) {
    eq(caps.version, '0.2', 'load: resolver receives version');
    eq(caps.needs[0].name, 'math', 'load: resolver sees needs');
    eq(caps.uses[0].name, 'logger', 'load: resolver sees uses');
    return { math: Math };
  });

  // Load without resolver (no needs)
  var bundle2 = await SafeScript.load('return 42;', null);
  eq(await SafeScript.run(bundle2), 42, 'load: no resolver, no needs');

  // Load with missing capability - rejects
  var threw = false;
  try {
    await SafeScript.load(src, function() { return {}; });
  } catch(e) {
    threw = true;
    assert(e.message.indexOf('math') >= 0, 'load: error mentions missing cap');
  }
  assert(threw, 'load: rejects on missing needs');

  // Load with extra scope entries
  var bundle3 = await SafeScript.load(src, function() {
    return { math: Math, logger: { log: function() {} } };
  });
  eq(await SafeScript.run(bundle3), 5, 'load: extra scope entries fine');

  // Resolver called even with no header
  var called = false;
  await SafeScript.load('return 1;', function(caps) {
    called = true;
    eq(caps.version, null, 'load: no-header caps.version null');
    return {};
  });
  assert(called, 'load: resolver called even with no header');

  // Async resolver
  var bundle4 = await SafeScript.load(src, function(caps) {
    return Promise.resolve({ math: Math });
  });
  eq(await SafeScript.run(bundle4), 5, 'load: async resolver works');

  // Prepare once, run many
  var tplSrc = 'return n * n;';
  var tplBundle = await SafeScript.load(tplSrc, function() { return { n: 0 }; });
  tplBundle.scope.n = 3;
  eq(await SafeScript.run(tplBundle), 9, 'load→run: reuse bundle with modified scope');
  tplBundle.scope.n = 7;
  eq(await SafeScript.run(tplBundle), 49, 'load→run: reuse bundle again');

  // ── run() returns a Promise ─────────────────────────────────────────

  var runResult = SafeScript.run('return 1;', {});
  assert(runResult && typeof runResult.then === 'function', 'run: returns a Promise');

  // ── Summary ─────────────────────────────────────────────────────────

  console.log('\nHeader parser tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
});

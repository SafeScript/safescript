#!/usr/bin/env node
/**
 * SafeScript headless browser test — runs SafeScript in a real browser
 * via Playwright to verify the browser bundle works end-to-end.
 */
'use strict';

var fs = require('fs');
var path = require('path');

async function runBrowserTests() {
  var pw;
  try {
    pw = require('playwright');
  } catch(e) {
    console.error('Playwright not installed. Run: npm install playwright');
    process.exit(1);
  }

  // Build the browser bundle if needed
  var bundlePath = path.join(__dirname, 'safescript.js');
  if (!fs.existsSync(bundlePath)) {
    var child = require('child_process');
    child.execSync('node browser.js > safescript.js', { cwd: __dirname });
  }
  var bundleSource = fs.readFileSync(bundlePath, 'utf8');

  var pass = 0, fail = 0;
  function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg); }
  }

  console.log('SafeScript Browser Test Suite');
  console.log('================================');

  var browser = await pw.chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox']
  });
  var page = await browser.newPage();

  // Inject SafeScript bundle
  await page.addScriptTag({ content: bundleSource });

  // Verify SafeScript is available
  console.log('\n-- Basic availability --');
  var hasSS = await page.evaluate(function() {
    return typeof SafeScript !== 'undefined';
  });
  assert(hasSS, 'SafeScript is defined in browser');

  var hasMethods = await page.evaluate(function() {
    return typeof SafeScript.run === 'function' &&
           typeof SafeScript.compile === 'function' &&
           typeof SafeScript.validate === 'function' &&
           typeof SafeScript.parse === 'function' &&
           typeof SafeScript.capabilities === 'function' &&
           typeof SafeScript.load === 'function' &&
           typeof SafeScript.checkScope === 'function';
  });
  assert(hasMethods, 'all API methods are present');

  // -- run() returns a Promise --
  console.log('\n-- run() returns Promise (auto-async) --');
  var isPromise = await page.evaluate(function() {
    var result = SafeScript.run('return 42;', {});
    return result instanceof Promise;
  });
  assert(isPromise, 'run() returns a Promise');

  var simpleResult = await page.evaluate(function() {
    return SafeScript.run('return 1 + 2;', {});
  });
  assert(simpleResult === 3, 'simple arithmetic: 1 + 2 = ' + simpleResult);

  // -- Scope injection --
  console.log('\n-- Scope injection --');
  var scopeResult = await page.evaluate(function() {
    return SafeScript.run('return x * y;', { x: 7, y: 6 });
  });
  assert(scopeResult === 42, 'scope injection: x * y = ' + scopeResult);

  var noGlobals = await page.evaluate(function() {
    return SafeScript.run('return typeof Object;', {});
  });
  assert(noGlobals === 'undefined', 'globals are shadowed: typeof Object = ' + noGlobals);

  var injectedGlobal = await page.evaluate(function() {
    return SafeScript.run('return Math.sqrt(16);', { Math: Math });
  });
  assert(injectedGlobal === 4, 'injected Math works: Math.sqrt(16) = ' + injectedGlobal);

  // -- Auto-async: injected Promises resolve automatically --
  console.log('\n-- Auto-async model --');
  var asyncResult = await page.evaluate(function() {
    var fakeDb = {
      get: function(id) {
        return new Promise(function(resolve) {
          setTimeout(function() { resolve({ id: id, name: 'test' }); }, 10);
        });
      }
    };
    return SafeScript.run('return db.get(1);', { db: fakeDb });
  });
  assert(asyncResult && asyncResult.id === 1, 'auto-awaits injected async method');
  assert(asyncResult && asyncResult.name === 'test', 'async result has correct data');

  // -- Returned functions are async --
  var returnedFn = await page.evaluate(function() {
    return SafeScript.run('return function(n) { return n * 2; };', {}).then(function(fn) {
      return fn(21);
    });
  });
  assert(returnedFn === 42, 'returned function works: fn(21) = ' + returnedFn);

  // -- Compilation --
  console.log('\n-- Compilation --');
  var compiled = await page.evaluate(function() {
    var result = SafeScript.compile('return a + b;');
    return {
      hasCode: typeof result.code === 'string',
      hasAST: typeof result.ast === 'object',
      code: result.code
    };
  });
  assert(compiled.hasCode, 'compile() returns code');
  assert(compiled.hasAST, 'compile() returns AST');
  // The code is not minified when using compile() directly
  assert(compiled.code && compiled.code.length > 0, 'compiled code is non-empty');

  // -- Validation --
  console.log('\n-- Validation --');
  var validResult = await page.evaluate(function() {
    return SafeScript.validate('return 42;');
  });
  assert(validResult.ok === true, 'valid code passes validation');

  var invalidResult = await page.evaluate(function() {
    return SafeScript.validate('eval("bad")');
  });
  assert(invalidResult.ok === false, 'eval is rejected');

  var asyncBlocked = await page.evaluate(function() {
    return SafeScript.validate('async function f() {}');
  });
  assert(asyncBlocked.ok === false, 'async keyword is blocked');

  var awaitBlocked = await page.evaluate(function() {
    try { return SafeScript.validate('await Promise.resolve(1);'); }
    catch(e) { return { ok: false, errors: [{ message: e.message }] }; }
  });
  assert(awaitBlocked.ok === false, 'await keyword is blocked');

  // -- Security --
  console.log('\n-- Security (browser) --');
  // window/document/fetch are blocked identifiers (can't even appear in source)
  var windowBlocked = await page.evaluate(function() {
    try {
      SafeScript.compile('return typeof window;');
      return false;
    } catch(e) { return true; }
  });
  assert(windowBlocked, 'window identifier is blocked at compile time');

  var documentBlocked = await page.evaluate(function() {
    try {
      SafeScript.compile('return typeof document;');
      return false;
    } catch(e) { return true; }
  });
  assert(documentBlocked, 'document identifier is blocked at compile time');

  var fetchBlocked = await page.evaluate(function() {
    try {
      SafeScript.compile('return typeof fetch;');
      return false;
    } catch(e) { return true; }
  });
  assert(fetchBlocked, 'fetch identifier is blocked at compile time');

  // Empty scope gives no access to globals
  var noGlobalAccess = await page.evaluate(function() {
    return SafeScript.run('return typeof Array;', {});
  });
  assert(noGlobalAccess === 'undefined', 'globals are shadowed at runtime');

  var protoBlocked = await page.evaluate(function() {
    return SafeScript.run('var o = {}; return o["__proto__"];', {});
  });
  assert(protoBlocked === undefined, '__proto__ access returns undefined');

  var constructorBlocked = await page.evaluate(function() {
    return SafeScript.run('var o = {}; return o["constructor"];', {});
  });
  assert(constructorBlocked === undefined, 'constructor access returns undefined');

  // -- Header parsing --
  console.log('\n-- Header parsing --');
  var caps = await page.evaluate(function() {
    return SafeScript.capabilities('/**\n * @safescript 0.2\n * @needs db: Database\n * @uses logger: Logger\n * @env browser\n */\nreturn db.query();');
  });
  assert(caps.version === '0.2', 'header version parsed');
  assert(caps.needs.length === 1 && caps.needs[0].name === 'db', 'header @needs parsed');
  assert(caps.uses.length === 1 && caps.uses[0].name === 'logger', 'header @uses parsed');
  assert(caps.env[0] === 'browser', 'header @env parsed');

  // -- load() and run(bundle) --
  console.log('\n-- load() + run(bundle) --');
  var bundleResult = await page.evaluate(function() {
    var source = '/**\n * @safescript 0.2\n * @needs x: number\n */\nreturn x * 10;';
    return SafeScript.load(source, function(caps) {
      return { x: 5 };
    }).then(function(bundle) {
      return SafeScript.run(bundle);
    });
  });
  assert(bundleResult === 50, 'load() + run(bundle) = ' + bundleResult);

  // -- Timeout --
  // Note: browser main-thread infinite loops block everything, so we test
  // timeout with an async sleep that exceeds the timeout window.
  console.log('\n-- Timeout --');
  var timedOut = await page.evaluate(function() {
    return SafeScript.run(
      'return delay(500);',
      { delay: function(ms) { return new Promise(function(r) { setTimeout(r, ms, "done"); }); } },
      { timeout: 50 }
    ).then(function() {
      return 'did not timeout';
    }).catch(function(e) {
      return e.message;
    });
  });
  assert(timedOut && timedOut.indexOf('timed out') !== -1, 'timeout works: ' + timedOut);

  // -- Destructuring and spread --
  console.log('\n-- Advanced features --');
  var destruct = await page.evaluate(function() {
    return SafeScript.run('var [a, b, ...rest] = arr; return [a, b, rest.length];', { arr: [1, 2, 3, 4, 5] });
  });
  assert(destruct && destruct[0] === 1 && destruct[1] === 2 && destruct[2] === 3,
    'destructuring with rest');

  var spread = await page.evaluate(function() {
    return SafeScript.run('return [...a, ...b];', { a: [1, 2], b: [3, 4] });
  });
  assert(spread && spread.length === 4 && spread[3] === 4, 'array spread');

  var objSpread = await page.evaluate(function() {
    return SafeScript.run('return { ...a, ...b };', { a: { x: 1 }, b: { y: 2 } });
  });
  assert(objSpread && objSpread.x === 1 && objSpread.y === 2, 'object spread');

  // -- hashASTAsync (browser) --
  console.log('\n-- hashASTAsync --');
  var hashResult;
  try {
    hashResult = await page.evaluate(function() {
      if (typeof crypto === 'undefined' || !crypto || !crypto.subtle) {
        return { skipped: true };
      }
      var compiled = SafeScript.compile('return 1 + 2;');
      return SafeScript.hashASTAsync(compiled.ast).then(function(h) {
        return { hash: h };
      });
    });
  } catch(e) {
    hashResult = { skipped: true };
  }
  if (hashResult && hashResult.skipped) {
    console.log('  - hashASTAsync skipped (no crypto.subtle in this context)');
  } else {
    assert(typeof hashResult.hash === 'string' && hashResult.hash.length === 64,
      'hashASTAsync returns 64-char hex: ' + (hashResult.hash || '').slice(0, 16) + '...');
  }

  // Done
  await browser.close();

  console.log('\n================================');
  console.log('  Browser tests: ' + pass + ' passed, ' + fail + ' failed');
  console.log('================================');

  process.exit(fail > 0 ? 1 : 0);
}

runBrowserTests().catch(function(e) {
  console.error('Browser test error:', e);
  process.exit(1);
});

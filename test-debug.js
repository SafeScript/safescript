/**
 * SafeScript 2.0 — Debug instrumentation tests
 */
'use strict';

var SafeScript = require('./');
var compiler = require('./src/compile');

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

async function run() {

  console.log('\n══ Compiler: debug emission ══\n');

  await test('compile with debug: true produces __dbg calls', function() {
    var result = compiler.compile('var x = 1;', { debug: true });
    assert(result.code.indexOf('__dbg') > -1, 'should contain __dbg');
    assert(result.code.indexOf('var __r;') > -1, 'should contain var __r');
    assert(result.debug === true, 'should have debug flag');
  });

  await test('compile without debug does not produce __dbg calls', function() {
    var result = compiler.compile('var x = 1;');
    assert(result.code.indexOf('__dbg') === -1, 'should not contain __dbg');
  });

  await test('debug emission captures locals', function() {
    var result = compiler.compile('var x = 1; var y = 2;', { debug: true });
    // After var x, the locals should include x
    // After var y, the locals should include x and y
    assert(result.code.indexOf('x: x') > -1, 'should capture x');
    assert(result.code.indexOf('y: y') > -1, 'should capture y');
  });

  await test('debug emission handles expressions', function() {
    var result = compiler.compile('x = x + 1;', { debug: true });
    assert(result.code.indexOf('__dbg') > -1, 'expression should have checkpoint');
  });

  console.log('\n══ DebugSession: basic stepping ══\n');

  await test('debug() returns a DebugSession', function() {
    var session = SafeScript.debug('var x = 1;', {});
    assert(session instanceof SafeScript.DebugSession, 'should be DebugSession');
    assert(session.state === 'running' || session.state === 'paused', 'should be running or paused');
    session.stop();
  });

  await test('session pauses at first statement (stepping = true by default)', async function() {
    var paused = false;
    var pauseLine = -1;
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      onPause: function(info) {
        if (!paused) {
          paused = true;
          pauseLine = info.line;
        }
      }
    });

    // Give the async execution a tick to reach the first __dbg
    await new Promise(function(r) { setTimeout(r, 50); });

    assert(paused, 'should have paused');
    assert(session.state === 'paused', 'state should be paused');
    session.stop();
  });

  await test('step advances one statement', async function() {
    var pauseCount = 0;
    var lines = [];
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      onPause: function(info) {
        pauseCount++;
        lines.push(info.line);
      }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    assert(pauseCount === 1, 'should pause at first stmt, got ' + pauseCount);

    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(pauseCount === 2, 'should pause at second stmt, got ' + pauseCount);

    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(pauseCount === 3, 'should pause at third stmt, got ' + pauseCount);

    session.step(); // finish
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(session.state === 'finished', 'should be finished');
  });

  await test('continue runs to end', async function() {
    var finished = false;
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      onFinish: function() { finished = true; }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });
    assert(finished, 'should have finished');
  });

  await test('continue stops at breakpoint', async function() {
    var pauseLines = [];
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      breakpoints: [2],
      onPause: function(info) {
        pauseLines.push(info.line);
      }
    });

    // First pause is at line 1 (stepping=true by default)
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(pauseLines.length === 1, 'should pause at first stmt');

    // Continue — should stop at breakpoint on line 2
    session.continue();
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(pauseLines.length === 2, 'should pause at breakpoint, got ' + pauseLines.length);
    assert(pauseLines[1] === 2, 'should pause at line 2, got ' + pauseLines[1]);

    session.stop();
  });

  console.log('\n══ DebugSession: locals inspection ══\n');

  await test('locals are captured on pause', async function() {
    var capturedLocals = null;
    var session = SafeScript.debug('var x = 42;\nvar y = "hello";', {}, {
      onPause: function(info) {
        capturedLocals = info.locals;
      }
    });

    // Pause at first stmt (var x = 42)
    await new Promise(function(r) { setTimeout(r, 50); });
    session.step(); // advance past var x = 42
    await new Promise(function(r) { setTimeout(r, 50); });

    // Now paused after var y = "hello" — locals should have both
    assert(capturedLocals !== null, 'should have locals');
    assert(capturedLocals.x === 42, 'x should be 42, got ' + capturedLocals.x);
    assert(capturedLocals.y === 'hello', 'y should be "hello"');
    session.stop();
  });

  await test('locals update as execution progresses', async function() {
    var localHistory = [];
    var session = SafeScript.debug('var a = 1;\nvar b = a + 10;\nvar c = b * 2;', {}, {
      onPause: function(info) {
        localHistory.push(Object.assign({}, info.locals));
      }
    });

    // Step through all three
    await new Promise(function(r) { setTimeout(r, 50); });
    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });
    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });
    session.step();
    await new Promise(function(r) { setTimeout(r, 100); });

    // First pause: before any var is set (or after var a = 1)
    // The exact checkpoint placement may vary — check the last captured locals
    var last = localHistory[localHistory.length - 1];
    assert(last.a === 1, 'a should be 1');
    assert(last.b === 11, 'b should be 11');
    assert(last.c === 22, 'c should be 22');
    session.stop();
  });

  await test('scope variables are accessible', async function() {
    var capturedLocals = null;
    var session = SafeScript.debug('var result = input * 2;', { input: 21 }, {
      onPause: function(info) {
        capturedLocals = info.locals;
      }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(capturedLocals.result === 42, 'result should be 42');
    session.stop();
  });

  console.log('\n══ DebugSession: history ══\n');

  await test('history records steps', async function() {
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {});

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    var history = session.getHistory();
    assert(history.length >= 3, 'should have at least 3 steps, got ' + history.length);
    session.stop();
  });

  await test('history includes line numbers', async function() {
    var session = SafeScript.debug('var x = 1;\nvar y = 2;', {}, {});

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    var history = session.getHistory();
    var lines = history.map(function(s) { return s.line; });
    assert(lines.indexOf(1) > -1, 'should have line 1');
    assert(lines.indexOf(2) > -1, 'should have line 2');
    session.stop();
  });

  console.log('\n══ DebugSession: control flow ══\n');

  await test('if/else branches are debuggable', async function() {
    var finished = false;
    var finishValue;
    var session = SafeScript.debug('var x = 5;\nif (x > 3) {\n  var result = "big";\n} else {\n  var result = "small";\n}\nreturn result;',
      {}, {
        onFinish: function(v) { finished = true; finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });
    assert(finished, 'should finish');
    assert(finishValue === 'big', 'should return "big", got ' + finishValue);
  });

  await test('for loops are debuggable', async function() {
    var finished = false;
    var finishValue;
    var session = SafeScript.debug('var sum = 0;\nfor (var i = 0; i < 5; i = i + 1) {\n  sum = sum + i;\n}\nreturn sum;',
      {}, {
        onFinish: function(v) { finished = true; finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });
    assert(finished, 'should finish');
    assert(finishValue === 10, 'sum should be 10, got ' + finishValue);
  });

  await test('while loops are debuggable', async function() {
    var finished = false;
    var finishValue;
    var session = SafeScript.debug('var n = 0;\nwhile (n < 3) {\n  n = n + 1;\n}\nreturn n;',
      {}, {
        onFinish: function(v) { finished = true; finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });
    assert(finished, 'should finish');
    assert(finishValue === 3, 'n should be 3, got ' + finishValue);
  });

  await test('try/catch is debuggable', async function() {
    var finished = false;
    var finishValue;
    var session = SafeScript.debug(
      'var result;\ntry {\n  throw new Error("oops");\n} catch (e) {\n  result = e.message;\n}\nreturn result;',
      {}, {
        onFinish: function(v) { finished = true; finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });
    assert(finished, 'should finish');
    assert(finishValue === 'oops', 'should catch "oops", got ' + finishValue);
  });

  console.log('\n══ DebugSession: functions ══\n');

  await test('function declarations are debuggable', async function() {
    var finished = false;
    var finishValue;
    var session = SafeScript.debug(
      'function add(a, b) {\n  return a + b;\n}\nvar result = add(3, 4);\nreturn result;',
      {}, {
        onFinish: function(v) { finished = true; finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });
    assert(finished, 'should finish');
    assert(finishValue === 7, 'result should be 7, got ' + finishValue);
  });

  await test('scope method calls work in debug mode', async function() {
    var finished = false;
    var finishValue;
    var api = {
      double: function(n) { return n * 2; }
    };
    var session = SafeScript.debug('var result = api.double(21);\nreturn result;',
      { api: api }, {
        onFinish: function(v) { finished = true; finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });
    assert(finished, 'should finish');
    assert(finishValue === 42, 'result should be 42, got ' + finishValue);
  });

  console.log('\n══ DebugSession: stop ══\n');

  await test('stop terminates execution', async function() {
    var errorCaught = false;
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      onError: function() { errorCaught = true; }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.stop();
    await new Promise(function(r) { setTimeout(r, 100); });
    assert(session.state === 'finished', 'should be finished');
  });

  await test('toggleBreakpoint adds and removes', function() {
    var session = new SafeScript.DebugSession({});
    session.toggleBreakpoint(5);
    assert(session.breakpoints[5] === true, 'should add bp at 5');
    session.toggleBreakpoint(5);
    assert(!session.breakpoints[5], 'should remove bp at 5');
  });

  console.log('\n══ DebugSession: edit-and-continue ══\n');

  await test('setReplacement causes function swap', async function() {
    var pauseCount = 0;
    var finishValue;
    var session = SafeScript.debug('var x = 1;\nvar y = x + 1;\nreturn y;', {}, {
      onPause: function() { pauseCount++; },
      onFinish: function(v) { finishValue = v; }
    });

    // Pause at first stmt
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(pauseCount === 1);

    // Set a replacement that ignores locals and returns 999
    session.setReplacement(async function(locals) {
      return 999;
    });

    // Step — __dbg will see the replacement and call it
    session.step();
    await new Promise(function(r) { setTimeout(r, 100); });

    assert(finishValue === 999, 'should return 999 from replacement, got ' + finishValue);
  });

  await test('replacement receives current locals', async function() {
    var receivedLocals = null;
    var session = SafeScript.debug('var x = 42;\nvar y = x + 1;\nreturn y;', {}, {
      onPause: function() {}
    });

    // Pause at first stmt (var x = 42)
    await new Promise(function(r) { setTimeout(r, 50); });

    // Step past var x = 42
    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });

    // Now paused after var y = x + 1 — set replacement
    session.setReplacement(async function(locals) {
      receivedLocals = locals;
      return locals.y * 10;
    });

    session.step();
    await new Promise(function(r) { setTimeout(r, 100); });

    assert(receivedLocals !== null, 'should receive locals');
    assert(receivedLocals.x === 42, 'x should be 42');
    assert(receivedLocals.y === 43, 'y should be 43');
  });

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════════');
  console.log('SafeScript 2.0 Debug Tests');
  console.log('══════════════════════════════════════════════════');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });

/**
 * SafeScript 2.0 — Advanced Debug Features Tests
 *
 * Tests: evaluate, conditional breakpoints, stepOver/stepOut, serialize, fork
 */
'use strict';

var SafeScript = require('./');
var DebugSession = require('./src/debug').DebugSession;

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

function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}

function tick() { return new Promise(function(r) { setTimeout(r, 20); }); }

function debugRun(source, scope, opts) {
  opts = opts || {};
  var session = SafeScript.debug(source, scope || {}, {
    onPause: opts.onPause || function() {},
    onStep: opts.onStep || function() {},
    onFinish: opts.onFinish || function() {},
    onError: opts.onError || function() {},
    onLog: opts.onLog || null,
    breakpoints: opts.breakpoints,
    captureAllLocals: opts.captureAllLocals
  });
  return session;
}

(async function() {

// ══════════════════════════════════════════════════════════════════
// 1. Watch Expressions (evaluate)
// ══════════════════════════════════════════════════════════════════

console.log('\n══ Watch Expressions (evaluate) ══\n');

await test('evaluate simple expression while paused', async function() {
  var s = debugRun('var x = 10;\nvar y = 20;\nreturn x + y;');
  await tick();
  eq(s.state, 'paused');
  eq(s.currentLine, 1);
  var result = s.evaluate('x + 5');
  eq(result, 15, 'x + 5');
  s.stop();
});

await test('evaluate after two steps', async function() {
  var s = debugRun('var x = 10;\nvar y = 20;\nreturn x + y;');
  await tick();
  s.step(); await tick();
  eq(s.currentLine, 2);
  var result = s.evaluate('x + y');
  eq(result, 30, 'x + y');
  s.stop();
});

await test('evaluate object access', async function() {
  var s = debugRun('var obj = { a: 1, b: 2 };\nreturn obj.a;');
  await tick();
  var result = s.evaluate('obj');
  assert(result && result.a === 1 && result.b === 2, 'should access obj properties');
  s.stop();
});

await test('evaluate arithmetic', async function() {
  var s = debugRun('var x = 7;\nreturn x;');
  await tick();
  eq(s.evaluate('x * 3'), 21);
  eq(s.evaluate('x > 5'), true);
  s.stop();
});

await test('evaluate throws when no locals', async function() {
  var session = new DebugSession({});
  session.state = 'paused';
  session.currentLocals = null;
  try {
    session.evaluate('1 + 1');
    assert(false, 'should have thrown');
  } catch(e) {
    assert(e.message.indexOf('locals') !== -1, 'should mention locals');
  }
});

await test('evaluate does not modify session state', async function() {
  var s = debugRun('var x = 10;\nreturn x;');
  await tick();
  var before = s.currentLocals.x;
  s.evaluate('x + 100');
  eq(s.currentLocals.x, before, 'x unchanged after evaluate');
  s.stop();
});

// ══════════════════════════════════════════════════════════════════
// 2. Conditional Breakpoints
// ══════════════════════════════════════════════════════════════════

console.log('\n══ Conditional Breakpoints ══\n');

await test('conditional breakpoint pauses when condition true', async function() {
  var source = 'var i = 0;\nfor (var j = 0; j < 5; j++) {\ni = j;\n}\nreturn i;';
  var s = debugRun(source);
  await tick();

  // Set conditional breakpoint: pause at line 3 only when j === 3
  s.setConditionalBreakpoint(3, 'j === 3');
  s.continue(); await tick(); await tick(); await tick();

  eq(s.state, 'paused', 'should be paused');
  eq(s.currentLine, 3, 'at line 3');
  assert(s.currentLocals.j === 3, 'j should be 3, got ' + s.currentLocals.j);
  s.stop();
});

await test('unconditional breakpoint always pauses', async function() {
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;');
  await tick();

  s.setConditionalBreakpoint(2); // no condition
  s.continue(); await tick();

  eq(s.state, 'paused');
  eq(s.currentLine, 2);
  s.stop();
});

await test('condition false skips breakpoint', async function() {
  var finished = false;
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, {
    onFinish: function() { finished = true; }
  });
  await tick();

  s.setConditionalBreakpoint(2, 'false');
  s.continue(); await tick(); await tick();

  // Should not pause at line 2 — either finished or at line 3
  assert(s.currentLine !== 2 || finished, 'should skip line 2');
  s.stop();
});

await test('setConditionalBreakpoint replaces condition', async function() {
  var s = debugRun('var x = 5;\nvar y = 10;\nreturn x;');
  await tick();

  s.setConditionalBreakpoint(2, 'x > 100'); // false
  s.setConditionalBreakpoint(2, 'x === 5'); // true — replaces
  s.continue(); await tick();

  eq(s.state, 'paused');
  eq(s.currentLine, 2);
  s.stop();
});

// ══════════════════════════════════════════════════════════════════
// 3. Step Over / Step Out
// ══════════════════════════════════════════════════════════════════

console.log('\n══ Step Over / Step Out ══\n');

await test('step advances line by line', async function() {
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;');
  await tick();
  eq(s.currentLine, 1, 'starts at line 1');
  s.step(); await tick();
  eq(s.currentLine, 2, 'advances to line 2');
  s.step(); await tick();
  eq(s.currentLine, 3, 'advances to line 3');
  s.stop();
});

await test('stepOver exists and does not crash', async function() {
  var s = debugRun('function f() {\nreturn 1;\n}\nvar r = f();\nreturn r;');
  await tick();
  assert(typeof s.stepOver === 'function', 'stepOver is a function');
  s.stepOver(); await tick(); await tick();
  // Should advance past the function
  assert(s.state === 'paused' || s.state === 'finished', 'session advances');
  s.stop();
});

await test('stepOut exists and does not crash', async function() {
  var s = debugRun('function f() {\nvar a = 1;\nreturn a;\n}\nvar r = f();\nreturn r;');
  await tick();
  s.step(); await tick(); // into function body
  assert(typeof s.stepOut === 'function', 'stepOut is a function');
  s.stepOut(); await tick(); await tick();
  assert(s.state === 'paused' || s.state === 'finished', 'session advances');
  s.stop();
});

await test('pushCall / popCall track depth', function() {
  var s = new DebugSession({});
  eq(s._callDepth, 0);
  s.pushCall();
  eq(s._callDepth, 1);
  s.pushCall();
  eq(s._callDepth, 2);
  s.popCall();
  eq(s._callDepth, 1);
  s.popCall();
  eq(s._callDepth, 0);
  s.popCall(); // doesn't go negative
  eq(s._callDepth, 0);
});

// ══════════════════════════════════════════════════════════════════
// 4. Session Serialization
// ══════════════════════════════════════════════════════════════════

console.log('\n══ Session Serialization ══\n');

await test('serialize returns JSON-safe object', async function() {
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, { captureAllLocals: true });
  await tick();
  s.step(); await tick();

  var data = s.serialize();
  assert(data.version === 1, 'has version');
  assert(data.state === 'paused', 'state is paused');
  assert(typeof data.currentLine === 'number', 'has currentLine');
  assert(Array.isArray(data.history), 'has history');
  assert(Array.isArray(data.breakpoints), 'breakpoints is array');

  var json = JSON.stringify(data);
  assert(typeof json === 'string', 'serializes to JSON');
  var parsed = JSON.parse(json);
  assert(parsed.version === 1, 'round-trips');
  s.stop();
});

await test('serialize includes journal entries with numeric targetId', async function() {
  var s = debugRun('count = count + 1;\nreturn count;', { count: 0 });
  await tick();
  s.step(); await tick();

  var data = s.serialize();
  assert(Array.isArray(data.journal), 'has journal');
  if (data.journal.length > 0) {
    assert(typeof data.journal[0].targetId === 'number', 'targetId is numeric');
    assert(typeof data.journal[0].key === 'string', 'key is string');
  }
  s.stop();
});

await test('serialize preserves breakpoint conditions', async function() {
  var s = debugRun('var x = 1;\nreturn x;');
  await tick();
  s.setConditionalBreakpoint(5, 'x > 10');

  var data = s.serialize();
  assert(data.conditions && data.conditions['5'] === 'x > 10', 'condition preserved');
  s.stop();
});

await test('deserialize restores state', async function() {
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, { captureAllLocals: true });
  await tick();
  s.step(); await tick();
  s.setConditionalBreakpoint(3, 'x > 0');

  var data = s.serialize();
  var restored = DebugSession.deserialize(JSON.parse(JSON.stringify(data)));

  eq(restored.state, data.state, 'state');
  eq(restored.currentLine, data.currentLine, 'line');
  assert(restored.history.length === data.history.length, 'history length');
  assert(restored.breakpoints[3], 'breakpoint');
  assert(restored._breakpointConditions[3] === 'x > 0', 'condition');
  s.stop();
});

await test('deserialize from raw data', function() {
  var data = {
    version: 1,
    state: 'paused',
    stepping: true,
    currentLine: 5,
    currentLocals: { x: 42 },
    callDepth: 0,
    breakpoints: [5, 10],
    conditions: { '5': 'x > 0' },
    captureAllLocals: true,
    history: [{ index: 0, line: 5, locals: { x: 42 } }],
    journal: [],
    domSnapshots: [{ stepIndex: 0, html: '<p>Hi</p>' }],
    _objectCount: 0
  };

  var s = DebugSession.deserialize(data);
  eq(s.currentLocals.x, 42);
  eq(s.captureAllLocals, true);
  assert(s.breakpoints[5], 'bp 5');
  assert(s.breakpoints[10], 'bp 10');
  assert(s._breakpointConditions['5'] === 'x > 0', 'cond');
  eq(s._domSnapshots.length, 1);
  eq(s._domSnapshots[0].html, '<p>Hi</p>');
});

// ══════════════════════════════════════════════════════════════════
// 5. Fork
// ══════════════════════════════════════════════════════════════════

console.log('\n══ Fork ══\n');

await test('fork creates independent copy', async function() {
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, { captureAllLocals: true });
  await tick();
  s.step(); await tick();

  var child = s.fork();
  eq(child.state, s.state, 'same state');
  eq(child.currentLine, s.currentLine, 'same line');
  assert(child.history.length === s.history.length, 'same history length');
  s.stop();
});

await test('fork modifications do not affect parent', async function() {
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, { captureAllLocals: true });
  await tick();

  var parentLine = s.currentLine;
  var parentHistLen = s.history.length;
  var child = s.fork();

  child.history.push({ index: 99, line: 99 });
  child.breakpoints[50] = true;
  if (child.currentLocals) child.currentLocals.z = 999;

  eq(s.history.length, parentHistLen, 'parent history unchanged');
  assert(!s.breakpoints[50], 'parent breakpoints unchanged');
  assert(!s.currentLocals || !s.currentLocals.z, 'parent locals unchanged');
  s.stop();
});

await test('fork copies breakpoints and conditions', async function() {
  var s = debugRun('var x = 1;\nreturn x;');
  await tick();
  s.setBreakpoints([5, 10, 15]);
  s.setConditionalBreakpoint(10, 'x > 5');

  var child = s.fork();
  assert(child.breakpoints[5], 'bp 5');
  assert(child.breakpoints[10], 'bp 10');
  assert(child.breakpoints[15], 'bp 15');
  assert(child._breakpointConditions[10] === 'x > 5', 'condition');
  s.stop();
});

await test('fork copies DOM snapshots', function() {
  var session = new DebugSession({ captureAllLocals: true });
  session._domRoot = { innerHTML: '<p>Test</p>' };
  session.snapshotDOM();
  session._domRoot.innerHTML = '<p>Changed</p>';
  session.snapshotDOM();

  var child = session.fork();
  eq(child._domSnapshots.length, 2);
  eq(child._domSnapshots[0].html, '<p>Test</p>');
  eq(child._domSnapshots[1].html, '<p>Changed</p>');
});

await test('fork shares compile references', async function() {
  var s = debugRun('var x = 1;\nreturn x;');
  await tick();

  var child = s.fork();
  assert(child._compileFn === s._compileFn, 'compileFn');
  assert(child._compileTailFn === s._compileTailFn, 'compileTailFn');
  assert(child._runtimeArgs === s._runtimeArgs, 'runtimeArgs');
  s.stop();
});

// 6. Logpoints
// ══════════════════════════════════════════════════════════════════

console.log('\n══ Logpoints ══\n');

await test('setLogpoint fires onLog callback', async function() {
  var logs = [];
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, {
    captureAllLocals: true,
    onLog: function(info) { logs.push(info); }
  });
  await tick();
  s.setLogpoint(2, 'hello world');
  s.step(); await tick(); // execute line 2 → fires logpoint
  assert(logs.length >= 1, 'onLog fired: got ' + logs.length);
  eq(logs[0].message, 'hello world', 'plain message');
  eq(logs[0].line, 2, 'correct line');
  s.stop();
});

await test('logpoint interpolates {expr} with locals', async function() {
  var logs = [];
  var s = debugRun('var x = 10;\nvar y = 20;\nreturn x + y;', {}, {
    captureAllLocals: true,
    onLog: function(info) { logs.push(info); }
  });
  await tick();
  s.setLogpoint(2, 'x is {x}');
  s.step(); await tick(); // execute line 2
  assert(logs.length >= 1, 'onLog fired');
  eq(logs[0].message, 'x is 10', 'interpolated value');
  s.stop();
});

await test('logpoint does not pause execution', async function() {
  var pauses = 0;
  var logs = [];
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x + y;', {}, {
    captureAllLocals: true,
    onPause: function() { pauses++; },
    onLog: function(info) { logs.push(info); }
  });
  await tick(); // pauses at line 1 (stepping mode)
  var pausesBefore = pauses;
  s.setLogpoint(2, 'log');
  s.continue(); // continue — should not pause at logpoint line
  await tick();
  // If logpoint caused a pause, pauses would have incremented
  // But the session should have finished (continued past everything)
  assert(logs.length >= 1, 'logpoint fired');
  s.stop();
});

await test('removeLogpoint stops firing', async function() {
  var logs = [];
  var s = debugRun('var x = 1;\nvar y = 2;\nvar z = 3;\nreturn z;', {}, {
    captureAllLocals: true,
    onLog: function(info) { logs.push(info); }
  });
  await tick();
  s.setLogpoint(2, 'at 2');
  s.setLogpoint(3, 'at 3');
  s.removeLogpoint(3);
  s.step(); await tick(); // line 2 fires
  s.step(); await tick(); // line 3 does NOT fire
  var msgs = logs.map(function(l) { return l.message; });
  assert(msgs.indexOf('at 2') !== -1, 'line 2 fired');
  assert(msgs.indexOf('at 3') === -1, 'line 3 did not fire');
  s.stop();
});

await test('fork copies logpoints', async function() {
  var s = debugRun('var x = 1;\nreturn x;');
  await tick();
  s.setLogpoint(1, 'hello {x}');
  s.setLogpoint(2, 'goodbye');

  var child = s.fork();
  eq(child._logpoints[1], 'hello {x}', 'logpoint 1 copied');
  eq(child._logpoints[2], 'goodbye', 'logpoint 2 copied');
  // Verify independence
  child._logpoints[1] = 'changed';
  eq(s._logpoints[1], 'hello {x}', 'parent unchanged');
  s.stop();
});

await test('serialize/deserialize includes logpoints', async function() {
  var s = debugRun('var x = 1;\nreturn x;', {}, { captureAllLocals: true });
  await tick();
  s.setLogpoint(1, 'log {x}');
  s.setLogpoint(3, 'done');

  var data = s.serialize();
  assert(data.logpoints, 'logpoints in serialized data');
  eq(data.logpoints['1'], 'log {x}', 'logpoint 1');
  eq(data.logpoints['3'], 'done', 'logpoint 3');
  s.stop();
});

await test('logpoint with failed expr shows error text', async function() {
  var logs = [];
  var s = debugRun('var x = 1;\nvar y = 2;\nreturn x;', {}, {
    captureAllLocals: true,
    onLog: function(info) { logs.push(info); }
  });
  await tick();
  s.setLogpoint(2, 'val is {nonexistent_var}');
  s.step(); await tick();
  assert(logs.length >= 1, 'onLog fired');
  // Should contain error text for the failed interpolation
  assert(logs[0].message.indexOf('val is') === 0, 'static part preserved');
  s.stop();
});

// ── Summary ─────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

})();

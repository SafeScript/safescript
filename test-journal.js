/**
 * SafeScript 2.0 Phase 2 — Journal + debug-mode journal integration tests
 */
'use strict';

var SafeScript = require('./');
var Journal = require('./src/journal').Journal;

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

  console.log('\n══ Journal: unit tests ══\n');

  await test('write records entry in log', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, 2);
    var entries = j.entries();
    assert(entries.length === 1);
    assert(entries[0].target === obj);
    assert(entries[0].key === 'x');
    assert(entries[0].was === 1);
    assert(entries[0].to === 2);
  });

  await test('write does NOT mutate real object', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, 99);
    assert(obj.x === 1, 'real object should be unchanged');
  });

  await test('read returns overlay value when written', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, 99);
    assert(j.read(obj, 'x') === 99, 'should read 99 from overlay');
  });

  await test('read falls through to real value when not written', function() {
    var j = new Journal();
    var obj = { x: 1, y: 2 };
    j.write(obj, 'x', 1, 99);
    assert(j.read(obj, 'y') === 2, 'y should fall through to real value');
  });

  await test('has returns true for written keys', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, 99);
    assert(j.has(obj, 'x') === true);
    assert(j.has(obj, 'y') === false);
  });

  await test('multiple writes to same key keep latest', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, 2);
    j.write(obj, 'x', 2, 3);
    j.write(obj, 'x', 3, 4);
    assert(j.read(obj, 'x') === 4);
    assert(j.entries().length === 3, 'all writes in log');
  });

  await test('writes to different objects are independent', function() {
    var j = new Journal();
    var a = { val: 'a' };
    var b = { val: 'b' };
    j.write(a, 'val', 'a', 'A');
    j.write(b, 'val', 'b', 'B');
    assert(j.read(a, 'val') === 'A');
    assert(j.read(b, 'val') === 'B');
    assert(a.val === 'a', 'real a unchanged');
    assert(b.val === 'b', 'real b unchanged');
  });

  await test('writeExternal records external entries', function() {
    var j = new Journal();
    j.writeExternal({ kind: 'call', target: 'email.send', args: ['hello'] });
    var ext = j.externalEntries();
    assert(ext.length === 1);
    assert(ext[0].kind === 'call');
    assert(ext[0].target === 'email.send');
  });

  await test('commit applies all writes to real objects', function() {
    var j = new Journal();
    var obj = { x: 1, y: 2 };
    j.write(obj, 'x', 1, 10);
    j.write(obj, 'y', 2, 20);
    var result = j.commit();
    assert(obj.x === 10, 'x should be 10 after commit');
    assert(obj.y === 20, 'y should be 20 after commit');
    assert(result.writes === 2);
    assert(j.entries().length === 0, 'log should be empty after commit');
  });

  await test('clear discards all writes', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, 99);
    j.clear();
    assert(obj.x === 1, 'real object unchanged');
    assert(j.read(obj, 'x') === 1, 'overlay cleared, falls through');
    assert(j.entries().length === 0);
  });

  await test('summary reports state', function() {
    var j = new Journal();
    var obj = {};
    j.write(obj, 'a', undefined, 1);
    j.write(obj, 'b', undefined, 2);
    j.writeExternal({ kind: 'call' });
    var s = j.summary();
    assert(s.writes === 2);
    assert(s.externals === 1);
    assert(s.cursor === 2);
  });

  console.log('\n══ Journal: rewindTo (time travel) ══\n');

  await test('rewindTo rebuilds overlay', function() {
    var j = new Journal();
    var obj = { x: 0 };
    j.write(obj, 'x', 0, 1);  // log[0]
    j.write(obj, 'x', 1, 2);  // log[1]
    j.write(obj, 'x', 2, 3);  // log[2]
    assert(j.read(obj, 'x') === 3);

    j.rewindTo(2); // keep log[0] and log[1]
    assert(j.read(obj, 'x') === 2, 'should be 2 after rewind to step 2');
    assert(j.entries().length === 2, 'log truncated');
  });

  await test('rewindTo(0) clears overlay', function() {
    var j = new Journal();
    var obj = { x: 0 };
    j.write(obj, 'x', 0, 1);
    j.write(obj, 'x', 1, 2);
    j.rewindTo(0);
    assert(j.read(obj, 'x') === 0, 'should fall through to real value');
    assert(j.entries().length === 0, 'log should be empty');
  });

  await test('rewind then write creates new branch', function() {
    var j = new Journal();
    var obj = { x: 0 };
    j.write(obj, 'x', 0, 1);  // log[0]
    j.write(obj, 'x', 1, 2);  // log[1]
    j.write(obj, 'x', 2, 3);  // log[2]

    j.rewindTo(1); // keep log[0] only
    assert(j.read(obj, 'x') === 1);

    j.write(obj, 'x', 1, 99); // new branch
    assert(j.read(obj, 'x') === 99);
    assert(j.entries().length === 2, 'log[0] + new write');
  });

  await test('undefined values are handled correctly', function() {
    var j = new Journal();
    var obj = { x: 1 };
    j.write(obj, 'x', 1, undefined);
    assert(j.has(obj, 'x') === true, 'should track undefined writes');
    assert(j.read(obj, 'x') === undefined, 'should return undefined');
  });

  console.log('\n══ Debug mode: journal integration ══\n');

  await test('bracket writes go to journal in debug mode', async function() {
    var target = { count: 0 };
    var session = SafeScript.debug('target["count"] = 42;', { target: target }, {});

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    // Real object should be unchanged
    assert(target.count === 0, 'real object should be unchanged, got ' + target.count);
    // Journal should have the write
    var entries = session.journal.entries();
    assert(entries.length >= 1, 'journal should have entries');
    var found = entries.some(function(e) { return e.key === 'count' && e.to === 42; });
    assert(found, 'journal should have count=42 write');
  });

  await test('bracket reads see journal overlay', async function() {
    var target = { count: 0 };
    var finishValue;
    var session = SafeScript.debug(
      'target["count"] = 42;\nvar result = target["count"];\nreturn result;',
      { target: target }, {
        onFinish: function(v) { finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    // The read should see the journal value, not the real value
    assert(finishValue === 42, 'should read 42 from journal, got ' + finishValue);
    assert(target.count === 0, 'real object still 0');
  });

  await test('method calls are logged as side effects', async function() {
    var api = { doSomething: function(x) { return x * 2; } };
    var stepEffects = [];
    var session = SafeScript.debug('var r = api.doSomething(21);', { api: api }, {
      onStep: function(step) {
        if (step.effects) stepEffects.push.apply(stepEffects, step.effects);
      }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    var callEffects = stepEffects.filter(function(e) { return e.kind === 'call'; });
    assert(callEffects.length >= 1, 'should have call effects');
    assert(callEffects[0].method === 'doSomething', 'should log doSomething');
  });

  await test('commit applies journal writes to real state', async function() {
    var target = { x: 1 };
    var session = SafeScript.debug('target["x"] = 99;', { target: target }, {});

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    assert(target.x === 1, 'before commit: unchanged');
    session.commit();
    assert(target.x === 99, 'after commit: applied');
  });

  await test('discard leaves real state unchanged', async function() {
    var target = { x: 1 };
    var session = SafeScript.debug('target["x"] = 99;', { target: target }, {});

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    session.discard();
    assert(target.x === 1, 'after discard: unchanged');
    assert(session.journal.entries().length === 0, 'journal cleared');
  });

  await test('multiple writes accumulate in journal', async function() {
    var target = { a: 0, b: 0 };
    var session = SafeScript.debug(
      'target["a"] = 1;\ntarget["b"] = 2;\ntarget["a"] = 3;',
      { target: target }, {});

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    assert(target.a === 0 && target.b === 0, 'real state unchanged');
    var entries = session.journal.entries();
    assert(entries.length >= 3, 'should have 3 writes, got ' + entries.length);
    session.commit();
    assert(target.a === 3, 'a should be 3 after commit');
    assert(target.b === 2, 'b should be 2 after commit');
  });

  await test('onCommit callback receives result', async function() {
    var target = { x: 0 };
    var commitResult = null;
    var session = SafeScript.debug('target["x"] = 42;', { target: target }, {
      onCommit: function(result) { commitResult = result; }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    // Set the onCommit on the session (it was passed through debug opts)
    session.commit();
    assert(commitResult !== null, 'onCommit should have been called');
    assert(commitResult.writes >= 1, 'should report writes');
  });

  console.log('\n══ Debug mode: time travel ══\n');

  await test('rewindTo restores state and notifies host', async function() {
    var pauseInfo = null;
    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      captureAllLocals: true,
      onPause: function(info) { pauseInfo = info; }
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    // Should have history entries
    assert(session.getHistory().length >= 3, 'should have history');

    // Rewind to step 1
    session.rewindTo(1);
    assert(pauseInfo !== null, 'onPause should be called on rewind');
    assert(pauseInfo.rewound === true, 'should indicate rewind');
  });

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════════');
  console.log('SafeScript 2.0 Phase 2: Journal Tests');
  console.log('══════════════════════════════════════════════════');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });

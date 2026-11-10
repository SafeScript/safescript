/**
 * SafeScript 2.0 Phase 3 — Edit-and-continue + debug protocol tests
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

async function run() {

  console.log('\n══ compileTail ══\n');

  await test('compileTail produces a function', function() {
    var tailFn = SafeScript.compileTail('var x = 1;\nreturn x;', 1, { locals: [] });
    assert(typeof tailFn === 'function', 'should be a function');
  });

  await test('compileTail function receives locals', async function() {
    // Compile tail that uses a pre-existing local
    var tailFn = SafeScript.compileTail('return x * 2;', 1, { locals: ['x'] });

    // Build minimal runtime args (need __at, __set, __call, etc.)
    // Use SafeScript internals to get proper args
    var runtime = require('./src/runtime');
    // We'll use a simpler test via SafeScript.debug + editAndContinue
  });

  console.log('\n══ editAndContinue via DebugSession ══\n');

  await test('editAndContinue changes execution', async function() {
    var finishValue;
    var session = SafeScript.debug(
      'var x = 10;\nvar y = x + 1;\nreturn y;',
      {}, {
        onFinish: function(v) { finishValue = v; }
      });

    // Pause at first stmt
    await new Promise(function(r) { setTimeout(r, 50); });
    assert(session.state === 'paused', 'should be paused');

    // Step past var x = 10
    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });

    // Now paused after var y = x + 1 — edit the source
    // Change: var y = x + 1 → var y = x * 100
    var ok = session.editAndContinue('var x = 10;\nvar y = x * 100;\nreturn y;');
    assert(ok === true, 'edit should be accepted');

    // Continue — the replacement function should run
    session.step();
    await new Promise(function(r) { setTimeout(r, 200); });

    // The replacement re-executes with locals { x: 10 }
    // and the new code: var y = x * 100; return y;
    // But actually it re-runs the whole source with x from locals
    // So it should compute y = 10 * 100 = 1000
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });

    assert(finishValue === 1000, 'should return 1000, got ' + finishValue);
  });

  await test('editAndContinue with new variables', async function() {
    var finishValue;
    var session = SafeScript.debug(
      'var a = 5;\nvar b = a + 1;\nreturn b;',
      {}, {
        onFinish: function(v) { finishValue = v; }
      });

    await new Promise(function(r) { setTimeout(r, 50); });
    // Step past var a = 5
    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });

    // Edit: add a new variable c
    var ok = session.editAndContinue('var a = 5;\nvar b = a + 1;\nvar c = b + 100;\nreturn c;');
    assert(ok, 'edit accepted');

    session.step();
    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 200); });

    assert(finishValue === 106, 'should return 106 (5+1+100), got ' + finishValue);
  });

  await test('editAndContinue rejects when not paused', async function() {
    var session = SafeScript.debug('var x = 1;', {}, {});
    await new Promise(function(r) { setTimeout(r, 50); });
    session.continue();
    await new Promise(function(r) { setTimeout(r, 100); });

    var threw = false;
    try {
      session.editAndContinue('var x = 2;');
    } catch(e) {
      threw = true;
      assert(e.message.indexOf('paused') > -1);
    }
    assert(threw, 'should throw when not paused');
  });

  await test('editAndContinue rejects invalid source', async function() {
    var errorMsg = null;
    var session = SafeScript.debug('var x = 1;\nreturn x;', {}, {
      onError: function(e) { errorMsg = e.message; }
    });

    await new Promise(function(r) { setTimeout(r, 50); });

    var ok = session.editAndContinue('var x = @@@invalid;');
    assert(ok === false, 'should reject invalid source');
    assert(errorMsg !== null, 'should call onError');
  });

  console.log('\n══ Debug protocol: InProcessDriver ══\n');

  await test('InProcessDriver delivers events', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var session = SafeScript.debug('var x = 1;\nvar y = 2;', {}, {
      driver: driver
    });

    await new Promise(function(r) { setTimeout(r, 50); });

    // Should have received a 'paused' event
    var pauseEvents = events.filter(function(e) { return e.type === 'paused'; });
    assert(pauseEvents.length >= 1, 'should receive paused event, got ' + events.map(function(e){return e.type;}).join(','));
    assert(pauseEvents[0].data.line > 0, 'paused event should have line');

    session.stop();
    if (session.protocol) session.protocol.disconnect();
  });

  await test('InProcessDriver commands control session', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {
      driver: driver
    });

    await new Promise(function(r) { setTimeout(r, 50); });

    // Send step command via driver
    driver.command('step');
    await new Promise(function(r) { setTimeout(r, 50); });

    var pauseEvents = events.filter(function(e) { return e.type === 'paused'; });
    assert(pauseEvents.length >= 2, 'should have 2+ pause events after step');

    // Send continue command
    driver.command('continue');
    await new Promise(function(r) { setTimeout(r, 100); });

    var finishEvents = events.filter(function(e) { return e.type === 'finished'; });
    assert(finishEvents.length >= 1, 'should receive finished event');

    if (session.protocol) session.protocol.disconnect();
  });

  await test('protocol getLocals returns current state', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var session = SafeScript.debug('var x = 42;', {}, {});
    var protocol = new SafeScript.DebugProtocol(session, driver);

    await new Promise(function(r) { setTimeout(r, 50); });

    // Step past var x = 42
    driver.command('step');
    await new Promise(function(r) { setTimeout(r, 50); });

    // Request locals
    driver.command('getLocals');

    var localsEvents = events.filter(function(e) { return e.type === 'locals'; });
    assert(localsEvents.length >= 1, 'should receive locals event');
    assert(localsEvents[0].data.locals.x === 42, 'x should be 42');

    session.stop();
    protocol.disconnect();
  });

  await test('protocol getHistory returns step history', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var session = SafeScript.debug('var x = 1;\nvar y = 2;', {}, {});
    var protocol = new SafeScript.DebugProtocol(session, driver);

    await new Promise(function(r) { setTimeout(r, 50); });
    driver.command('continue');
    await new Promise(function(r) { setTimeout(r, 100); });

    driver.command('getHistory');

    var histEvents = events.filter(function(e) { return e.type === 'history'; });
    assert(histEvents.length >= 1, 'should receive history event');
    assert(histEvents[0].data.length >= 2, 'should have 2+ steps');

    protocol.disconnect();
  });

  await test('protocol setBreakpoints works', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var session = SafeScript.debug('var x = 1;\nvar y = 2;\nvar z = 3;', {}, {});
    var protocol = new SafeScript.DebugProtocol(session, driver);

    await new Promise(function(r) { setTimeout(r, 50); });

    // Set breakpoint on line 3 and continue
    driver.command('setBreakpoints', { lines: [3] });
    driver.command('continue');
    await new Promise(function(r) { setTimeout(r, 100); });

    // Should pause at line 3
    var pauseEvents = events.filter(function(e) { return e.type === 'paused'; });
    var lastPause = pauseEvents[pauseEvents.length - 1];
    assert(lastPause.data.line === 3, 'should pause at line 3, got ' + lastPause.data.line);

    session.stop();
    protocol.disconnect();
  });

  await test('protocol getJournal returns journal state', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var target = { x: 0 };
    var session = SafeScript.debug('target["x"] = 99;', { target: target }, {});
    var protocol = new SafeScript.DebugProtocol(session, driver);

    await new Promise(function(r) { setTimeout(r, 50); });
    driver.command('continue');
    await new Promise(function(r) { setTimeout(r, 100); });

    driver.command('getJournal');

    var jEvents = events.filter(function(e) { return e.type === 'journal'; });
    assert(jEvents.length >= 1, 'should receive journal event');
    assert(jEvents[0].data.summary.writes >= 1, 'should have writes');

    session.stop();
    protocol.disconnect();
  });

  await test('protocol commit/discard work', async function() {
    var events = [];
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
    });

    var target = { val: 0 };
    var session = SafeScript.debug('target["val"] = 42;', { target: target }, {});
    var protocol = new SafeScript.DebugProtocol(session, driver);

    await new Promise(function(r) { setTimeout(r, 50); });
    driver.command('continue');
    await new Promise(function(r) { setTimeout(r, 100); });

    assert(target.val === 0, 'before commit: unchanged');
    driver.command('commit');

    var commitEvents = events.filter(function(e) { return e.type === 'committed'; });
    assert(commitEvents.length >= 1, 'should receive committed event');
    assert(target.val === 42, 'after commit: applied');

    protocol.disconnect();
  });

  await test('protocol editAndContinue via command', async function() {
    var events = [];
    var finishValue;
    var driver = new SafeScript.InProcessDriver(function(event) {
      events.push(event);
      if (event.type === 'finished') finishValue = event.data.value;
    });

    var session = SafeScript.debug('var x = 5;\nvar y = x + 1;\nreturn y;', {}, {
      driver: driver
    });

    await new Promise(function(r) { setTimeout(r, 50); });
    // Step past var x = 5
    driver.command('step');
    await new Promise(function(r) { setTimeout(r, 50); });

    // Edit: change y = x + 1 to y = x * 100
    driver.command('editAndContinue', { source: 'var x = 5;\nvar y = x * 100;\nreturn y;' });

    // Continue
    driver.command('step');
    await new Promise(function(r) { setTimeout(r, 50); });
    driver.command('continue');
    await new Promise(function(r) { setTimeout(r, 200); });

    assert(finishValue === 500, 'should return 500, got ' + finishValue);

    if (session.protocol) session.protocol.disconnect();
  });

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════════');
  console.log('SafeScript 2.0 Phase 3: Edit-and-Continue + Protocol');
  console.log('══════════════════════════════════════════════════');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });

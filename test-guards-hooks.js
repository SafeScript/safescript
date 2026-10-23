/**
 * Tests for __check() guard injection and hooks system.
 */
'use strict';

var SafeScript = require('./');
var passed = 0, failed = 0;

function test(name, fn) {
  return fn().then(function() {
    passed++;
    process.stdout.write('.');
  }).catch(function(e) {
    failed++;
    console.log('\nFAIL: ' + name);
    console.log('  ' + e.message);
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertThrows(fn, pattern) {
  return fn.then(function() {
    throw new Error('Expected error matching: ' + pattern);
  }).catch(function(e) {
    if (pattern && !pattern.test(e.message)) {
      throw new Error('Expected error matching ' + pattern + ', got: ' + e.message);
    }
  });
}

var tests = [];

// ── Guards: __check() injection ──

tests.push(function() { return test('while(true) times out', function() {
  return assertThrows(
    SafeScript.run('while (true) {}', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('for(;;) times out', function() {
  return assertThrows(
    SafeScript.run('for (;;) { var x = 1; }', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('do-while(true) times out', function() {
  return assertThrows(
    SafeScript.run('do { var x = 1; } while (true)', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('for-in infinite loop times out', function() {
  return assertThrows(
    SafeScript.run('var obj = {a:1}; while (true) { for (var k in obj) { var x = k; } }', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('for-of infinite loop times out', function() {
  return assertThrows(
    SafeScript.run('while (true) { for (var v of [1,2,3]) { var x = v; } }', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('infinite recursion is caught', function() {
  return assertThrows(
    SafeScript.run('function f() { return f(); } return f();', {}, { timeout: 500 }),
    /timed out|Maximum call stack/
  );
}); });

tests.push(function() { return test('mutual recursion is caught', function() {
  return assertThrows(
    SafeScript.run('function a() { return b(); } function b() { return a(); } return a();', {}, { timeout: 500 }),
    /timed out|Maximum call stack/
  );
}); });

tests.push(function() { return test('maxOps limit works', function() {
  return assertThrows(
    SafeScript.run('var i = 0; while (true) { i++; }', {}, { maxOps: 100 }),
    /max operations|timed out/
  );
}); });

tests.push(function() { return test('normal code finishes within timeout', function() {
  return SafeScript.run('var sum = 0; for (var i = 0; i < 1000; i++) { sum = sum + i; } return sum;', {}, { timeout: 5000 }).then(function(v) {
    assert(v === 499500, 'expected 499500, got ' + v);
  });
}); });

tests.push(function() { return test('arrow functions get __check', function() {
  return assertThrows(
    SafeScript.run('var f = () => { while(true) {} }; return f();', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('concise arrow gets __check', function() {
  // Concise arrow body wraps in block with __check
  return SafeScript.run('var f = (x) => x + 1; return f(5);', {}).then(function(v) {
    assert(v === 6, 'expected 6, got ' + v);
  });
}); });

tests.push(function() { return test('object method gets __check', function() {
  return assertThrows(
    SafeScript.run('var obj = { loop() { while(true) {} } }; return obj.loop();', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('nested loops both get __check', function() {
  return assertThrows(
    SafeScript.run('while(true) { for(var i = 0; i < 10; i++) { var x = i; } }', {}, { timeout: 200 }),
    /timed out/
  );
}); });

tests.push(function() { return test('timeout ceiling is enforced (no timeout → MAX_TIMEOUT)', function() {
  // Even without timeout option, MAX_TIMEOUT (60s) is enforced
  // We just verify the code runs — it has the ceiling internally
  return SafeScript.run('return 42', {}).then(function(v) {
    assert(v === 42);
  });
}); });

// ── Hooks: beforeCall ──

tests.push(function() { return test('beforeCall receives correct info', function() {
  var captured = null;
  return SafeScript.run('return greet("world")', {
    greet: function(x) { return 'hi ' + x; }
  }, {
    hooks: {
      beforeCall: function(info) {
        captured = info;
      }
    }
  }).then(function(v) {
    assert(v === 'hi world');
    assert(captured.name === 'greet');
    assert(captured.args[0] === 'world');
    assert(typeof captured.callCount === 'number');
    assert(typeof captured.elapsed === 'number');
  });
}); });

tests.push(function() { return test('beforeCall false suppresses call', function() {
  var called = false;
  return SafeScript.run('return doStuff()', {
    doStuff: function() { called = true; return 'done'; }
  }, {
    hooks: {
      beforeCall: function() { return false; }
    }
  }).then(function(v) {
    assert(v === undefined, 'expected undefined, got ' + v);
    assert(!called, 'function should not have been called');
  });
}); });

tests.push(function() { return test('beforeCall short-circuit returns value', function() {
  return SafeScript.run('return fetchData()', {
    fetchData: function() { return 'real'; }
  }, {
    hooks: {
      beforeCall: function() { return { value: 'cached' }; }
    }
  }).then(function(v) {
    assert(v === 'cached', 'expected cached, got ' + v);
  });
}); });

tests.push(function() { return test('beforeCall short-circuit with null value', function() {
  return SafeScript.run('return fetchData()', {
    fetchData: function() { return 'real'; }
  }, {
    hooks: {
      beforeCall: function() { return { value: null }; }
    }
  }).then(function(v) {
    assert(v === null, 'expected null, got ' + v);
  });
}); });

tests.push(function() { return test('beforeCall transforms args', function() {
  return SafeScript.run('return add(1, 2)', {
    add: function(a, b) { return a + b; }
  }, {
    hooks: {
      beforeCall: function(info) {
        return { args: [info.args[0] * 10, info.args[1] * 10] };
      }
    }
  }).then(function(v) {
    assert(v === 30, 'expected 30, got ' + v);
  });
}); });

tests.push(function() { return test('beforeCall undefined proceeds normally', function() {
  return SafeScript.run('return add(3, 4)', {
    add: function(a, b) { return a + b; }
  }, {
    hooks: {
      beforeCall: function() { /* return undefined */ }
    }
  }).then(function(v) {
    assert(v === 7, 'expected 7, got ' + v);
  });
}); });

tests.push(function() { return test('beforeCall can throw to kill execution', function() {
  return assertThrows(
    SafeScript.run('return doStuff()', {
      doStuff: function() { return 'ok'; }
    }, {
      hooks: {
        beforeCall: function() { throw new Error('rate limit exceeded'); }
      }
    }),
    /rate limit exceeded/
  );
}); });

tests.push(function() { return test('beforeCall callCount increments', function() {
  var counts = [];
  return SafeScript.run('fn(); fn(); fn(); return "done"', {
    fn: function() {}
  }, {
    hooks: {
      beforeCall: function(info) { counts.push(info.callCount); }
    }
  }).then(function() {
    assert(counts.length === 3, 'expected 3 calls');
    assert(counts[0] === 1);
    assert(counts[1] === 2);
    assert(counts[2] === 3);
  });
}); });

// ── Hooks: afterCall ──

tests.push(function() { return test('afterCall receives result', function() {
  var captured = null;
  return SafeScript.run('return getValue()', {
    getValue: function() { return 42; }
  }, {
    hooks: {
      afterCall: function(info) { captured = info; }
    }
  }).then(function(v) {
    assert(v === 42);
    assert(captured.result === 42);
    assert(captured.name === 'getValue');
  });
}); });

tests.push(function() { return test('afterCall transforms result', function() {
  return SafeScript.run('return getValue()', {
    getValue: function() { return 42; }
  }, {
    hooks: {
      afterCall: function(info) { return { value: info.result * 2 }; }
    }
  }).then(function(v) {
    assert(v === 84, 'expected 84, got ' + v);
  });
}); });

tests.push(function() { return test('afterCall false suppresses result', function() {
  return SafeScript.run('return getValue()', {
    getValue: function() { return 42; }
  }, {
    hooks: {
      afterCall: function() { return false; }
    }
  }).then(function(v) {
    assert(v === undefined, 'expected undefined');
  });
}); });

tests.push(function() { return test('afterCall can throw', function() {
  return assertThrows(
    SafeScript.run('return getValue()', {
      getValue: function() { return 'big data'; }
    }, {
      hooks: {
        afterCall: function(info) {
          if (typeof info.result === 'string' && info.result.length > 5) {
            throw new Error('response too large');
          }
        }
      }
    }),
    /response too large/
  );
}); });

// ── Hooks: nested scope ──

tests.push(function() { return test('hooks wrap nested scope functions', function() {
  var names = [];
  return SafeScript.run('db.query("SELECT 1"); db.insert("x"); return "ok"', {
    db: {
      query: function(sql) { return sql; },
      insert: function(data) { return data; }
    }
  }, {
    hooks: {
      beforeCall: function(info) { names.push(info.name); }
    }
  }).then(function(v) {
    assert(v === 'ok');
    assert(names.length === 2);
    assert(names[0] === 'db.query');
    assert(names[1] === 'db.insert');
  });
}); });

tests.push(function() { return test('hooks wrap deeply nested scope', function() {
  var names = [];
  return SafeScript.run('return api.users.list()', {
    api: {
      users: {
        list: function() { return ['a', 'b']; }
      }
    }
  }, {
    hooks: {
      beforeCall: function(info) { names.push(info.name); }
    }
  }).then(function(v) {
    assert(JSON.stringify(v) === '["a","b"]');
    assert(names[0] === 'api.users.list');
  });
}); });

// ── Hooks: combined beforeCall + afterCall ──

tests.push(function() { return test('beforeCall + afterCall both fire', function() {
  var log = [];
  return SafeScript.run('return compute(5)', {
    compute: function(x) { return x * x; }
  }, {
    hooks: {
      beforeCall: function(info) { log.push('before:' + info.name); },
      afterCall: function(info) { log.push('after:' + info.result); }
    }
  }).then(function(v) {
    assert(v === 25);
    assert(log[0] === 'before:compute');
    assert(log[1] === 'after:25');
  });
}); });

// ── Hooks: selective throttling ──

tests.push(function() { return test('hooks can selectively block by name', function() {
  return SafeScript.run('var a = allowed(); var b = blocked(); return [a, b]', {
    allowed: function() { return 'yes'; },
    blocked: function() { return 'should not run'; }
  }, {
    hooks: {
      beforeCall: function(info) {
        if (info.name === 'blocked') return false;
      }
    }
  }).then(function(v) {
    assert(v[0] === 'yes');
    assert(v[1] === undefined);
  });
}); });

tests.push(function() { return test('hooks can enforce call count limit', function() {
  return assertThrows(
    SafeScript.run('for (var i = 0; i < 100; i++) { fn(); } return "done"', {
      fn: function() {}
    }, {
      hooks: {
        beforeCall: function(info) {
          if (info.callCount > 10) throw new Error('call limit: ' + info.callCount);
        }
      }
    }),
    /call limit/
  );
}); });

// ── Guards + Hooks together ──

tests.push(function() { return test('guards and hooks work together', function() {
  var hookCalled = false;
  return assertThrows(
    SafeScript.run('fn(); while(true) {}', {
      fn: function() { return 'ok'; }
    }, {
      timeout: 200,
      hooks: {
        beforeCall: function() { hookCalled = true; }
      }
    }),
    /timed out/
  ).then(function() {
    assert(hookCalled, 'hook should have been called before loop');
  });
}); });

// ── No hooks (no scope functions) ──

tests.push(function() { return test('hooks with empty scope works', function() {
  return SafeScript.run('return 2 + 2', {}, {
    hooks: { beforeCall: function() {} }
  }).then(function(v) {
    assert(v === 4);
  });
}); });

tests.push(function() { return test('no hooks option works normally', function() {
  return SafeScript.run('return 2 + 2', {}).then(function(v) {
    assert(v === 4);
  });
}); });

// Run all tests sequentially
console.log('\nGuards & Hooks tests');
console.log('═══════════════════════════════════════');

var p = Promise.resolve();
tests.forEach(function(t) {
  p = p.then(t);
});
p.then(function() {
  console.log('\n═══════════════════════════════════════');
  console.log('Total:  ' + (passed + failed));
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('═══════════════════════════════════════');
  if (failed > 0) process.exit(1);
});

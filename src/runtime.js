/**
 * SafeScript runtime — __at, __set, __check, sanitize, scope builder, hooks.
 *
 * These are injected into compiled SafeScript code and provide
 * the last line of defense: runtime property access guards,
 * scope sanitization (null-prototype deep copy), execution guards
 * (__check for timeout + ops limit), and hooks for resource throttling.
 */
'use strict';

var defs = require('./defs');

// Hardcoded ceilings — even if host passes higher, these cap it
var MAX_TIMEOUT = 60000;   // 1 minute
var MAX_OPS     = 100000000; // 100M ops

/**
 * Safe bracket read: obj[key] → __at(obj, key)
 * Returns undefined for blocked property names.
 * Throws on null/undefined receiver.
 */
function __at(obj, key) {
  if (obj == null) {
    throw new TypeError('Cannot read property "' + key + '" of ' + String(obj));
  }
  var k = String(key);
  if (defs.BLOCKED_PROPS[k]) return undefined;
  return obj[k];
}

/**
 * Safe bracket write: obj[key] = val → __set(obj, key, val)
 * Throws for blocked property names.
 * Throws on null/undefined receiver.
 */
function __set(obj, key, val) {
  if (obj == null) {
    throw new TypeError('Cannot set property "' + key + '" of ' + String(obj));
  }
  var k = String(key);
  if (defs.BLOCKED_PROPS[k]) {
    throw new TypeError('SafeScript: cannot set blocked property "' + k + '"');
  }
  obj[k] = val;
  return val;
}

/**
 * Deep-copy an object to null-prototype objects.
 * Functions pass through (they're trusted API).
 * Handles cycles via a seen-set.
 */
function sanitize(obj, _seen) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'function') return obj;
  if (typeof obj !== 'object') return obj;

  if (!_seen) _seen = new Map();
  if (_seen.has(obj)) return _seen.get(obj);

  if (Array.isArray(obj)) {
    var arr = [];
    _seen.set(obj, arr);
    for (var i = 0; i < obj.length; i++) {
      arr[i] = sanitize(obj[i], _seen);
    }
    return arr;
  }

  // Non-plain objects (built-ins like JSON, Math, class instances)
  // pass through — they're trusted API with non-enumerable methods.
  // Only plain objects ({} literals) get null-prototype treatment.
  var proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  var out = Object.create(null);
  _seen.set(obj, out);
  var keys = Object.getOwnPropertyNames(obj);
  for (var j = 0; j < keys.length; j++) {
    out[keys[j]] = sanitize(obj[keys[j]], _seen);
  }
  return out;
}

/**
 * Build the global shadow list — all globals set to undefined
 * so compiled code can't reach them.
 */
function buildShadowList() {
  var all = Object.create(null);
  defs.SHADOW_STATIC.forEach(function(k) { all[k] = 1; });
  // eval and arguments are illegal in strict mode var declarations
  delete all['eval'];
  delete all['arguments'];
  return Object.keys(all);
}

/**
 * Wrap a single function with beforeCall/afterCall hooks.
 * @param {Function} fn - The original function
 * @param {string} name - Dotted path name (e.g. "db.query")
 * @param {Object} hooks - { beforeCall, afterCall }
 * @param {Object} state - Shared mutable state { callCount, startTime }
 * @returns {Function} Wrapped async function
 */
function wrapFnWithHooks(fn, name, hooks, state) {
  return async function() {
    var args = Array.prototype.slice.call(arguments);
    state.callCount++;
    var elapsed = Date.now() - state.startTime;
    var info = { name: name, args: args, callCount: state.callCount, elapsed: elapsed };

    // beforeCall hook
    if (hooks.beforeCall) {
      var decision = hooks.beforeCall(info);
      if (decision === false) return undefined;  // suppress
      if (decision && typeof decision === 'object') {
        if ('value' in decision) return decision.value;  // short-circuit
        if (decision.args) args = decision.args;         // transform args
      }
      // undefined → proceed normally
    }

    var result = await fn.apply(undefined, args);

    // afterCall hook
    if (hooks.afterCall) {
      info.result = result;
      info.elapsed = Date.now() - state.startTime;
      var afterDecision = hooks.afterCall(info);
      if (afterDecision === false) return undefined;  // suppress result
      if (afterDecision && typeof afterDecision === 'object') {
        if ('value' in afterDecision) return afterDecision.value;  // transform result
      }
    }

    return result;
  };
}

/**
 * Walk a sanitized scope object and wrap every function with hooks.
 * Nested objects are walked recursively, building dotted name paths.
 * @param {Object} scopeObj - The sanitized scope (null-prototype)
 * @param {Object} hooks - { beforeCall, afterCall }
 * @param {Object} state - Shared mutable state
 * @param {string} [prefix] - Dotted path prefix
 * @returns {Object} The scope with functions wrapped
 */
function wrapScopeWithHooks(scopeObj, hooks, state, prefix) {
  if (!scopeObj || typeof scopeObj !== 'object') return scopeObj;
  var keys = Object.keys(scopeObj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = scopeObj[key];
    var path = prefix ? prefix + '.' + key : key;
    if (typeof val === 'function') {
      scopeObj[key] = wrapFnWithHooks(val, path, hooks, state);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      wrapScopeWithHooks(val, hooks, state, path);
    }
  }
  return scopeObj;
}

/**
 * Build a compiled function from emitted source with scope injection.
 *
 * @param {string} source - The emitted JS source
 * @param {Object} scope  - The scope object (capabilities)
 * @param {Object} opts   - Options { timeout, maxOps, hooks: { beforeCall, afterCall } }
 * @returns {Function} A function that executes the SafeScript code (always returns a Promise)
 */
function buildFunction(source, scope, opts) {
  opts = opts || {};
  var scopeObj = scope ? sanitize(scope) : Object.create(null);
  var scopeKeys = scope ? Object.keys(scope) : [];

  // Hooks: wrap scope functions before building
  var hooks = opts.hooks || null;
  var hookState = { callCount: 0, startTime: 0 };
  if (hooks && (hooks.beforeCall || hooks.afterCall)) {
    wrapScopeWithHooks(scopeObj, hooks, hookState);
  }

  // Compute effective timeout and maxOps (capped by ceilings)
  var timeout = opts.timeout || 0;
  if (timeout > MAX_TIMEOUT) timeout = MAX_TIMEOUT;
  if (timeout <= 0 && MAX_TIMEOUT > 0) timeout = MAX_TIMEOUT; // always enforce ceiling

  var maxOps = opts.maxOps || MAX_OPS;
  if (maxOps > MAX_OPS) maxOps = MAX_OPS;

  // Shadow all globals
  var shadowList = buildShadowList();
  var shadowDecl = shadowList.length > 0 ?
    'var ' + shadowList.join(', ') + ';\n' : '';

  // Build function body: shadow globals, then user code
  var body = '"use strict";\n' + shadowDecl + source;

  // Function params: __scope, __at, __set, __check, then scope keys
  var paramNames = ['__scope', '__at', '__set', '__check'].concat(scopeKeys);

  // Always use AsyncFunction constructor (auto-async model)
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  var fn = new AsyncFunction(paramNames.join(', '), body);

  return function() {
    // Reset guards for each invocation
    var deadline = Date.now() + timeout;
    var opsRemaining = maxOps;
    hookState.callCount = 0;
    hookState.startTime = Date.now();

    // __check: called at top of every function and every loop iteration
    function __check() {
      if (--opsRemaining <= 0) {
        throw new Error('SafeScript: max operations exceeded (' + maxOps + ')');
      }
      if (Date.now() > deadline) {
        throw new Error('SafeScript: execution timed out after ' + timeout + 'ms');
      }
    }

    // Bind the arguments
    var args = [scopeObj, __at, __set, __check];
    for (var i = 0; i < scopeKeys.length; i++) {
      args.push(scopeObj[scopeKeys[i]]);
    }

    var promise = fn.apply(undefined, args);

    // Promise.race as secondary defense (catches slow async injected methods)
    if (timeout > 0) {
      var timer;
      return Promise.race([
        promise.then(function(v) { clearTimeout(timer); return v; },
                     function(e) { clearTimeout(timer); throw e; }),
        new Promise(function(_, reject) {
          timer = setTimeout(function() {
            reject(new Error('SafeScript: execution timed out after ' + timeout + 'ms'));
          }, timeout);
        })
      ]);
    }
    return promise;
  };
}

exports.__at = __at;
exports.__set = __set;
exports.sanitize = sanitize;
exports.buildShadowList = buildShadowList;
exports.buildFunction = buildFunction;
exports.wrapScopeWithHooks = wrapScopeWithHooks;
exports.wrapFnWithHooks = wrapFnWithHooks;
exports.MAX_TIMEOUT = MAX_TIMEOUT;
exports.MAX_OPS = MAX_OPS;

/**
 * SafeScript — safe computational subset of JavaScript.
 * "JSON for code."
 *
 * Public API:
 *   SafeScript.compile(source)        → { code, ast, hash }
 *   SafeScript.run(source, scope)     → result
 *   SafeScript.run(bundle)            → result  (bundle from load())
 *   SafeScript.validate(source)       → { ok, errors }
 *   SafeScript.wrap(source, scope)    → result  (v0.1 linter mode)
 *   SafeScript.parse(source)          → AST
 *   SafeScript.sanitize(obj)          → null-prototype deep copy
 *   SafeScript.capabilities(source)   → { version, env, needs, uses }
 *   SafeScript.checkScope(source, scope) → { ok, missing }
 *   SafeScript.load(source, resolver)    → Promise<bundle> (one-call integration)
 */
'use strict';

var parser = require('./src/parse');
var validator = require('./src/validate');
var compiler = require('./src/compile');
var runtime = require('./src/runtime');
var header = require('./src/header');

var SafeScript = {
  /**
   * Compile SafeScript source to JavaScript.
   * Returns { code, ast, hash }.
   * Throws SyntaxError on invalid input.
   */
  compile: function(source) {
    return compiler.compile(source);
  },

  /**
   * Compile and run SafeScript source with the given scope.
   *
   * Two calling conventions:
   *   run(source, scope?, opts?)  — source is a string
   *   run(bundle)                 — bundle is { source, scope } from load()
   *
   * @param {string|Object} source - SafeScript source code, or a bundle from load()
   * @param {Object} [scope] - Capabilities to inject (e.g. { Date, fetch })
   * @param {Object} [opts]  - Options { timeout: 0 }
   * @returns {Promise<*>} A Promise resolving to the return value of the SafeScript code
   */
  run: function(source, scope, opts) {
    // Bundle overload: run({ source, scope })
    if (typeof source === 'object' && source !== null && typeof source.source === 'string') {
      opts = scope; // second arg becomes opts in bundle mode
      scope = source.scope;
      source = source.source;
    }
    var compiled = compiler.compile(source);
    var fn = runtime.buildFunction(compiled.code, scope, opts || {});
    return fn();
  },

  /**
   * Validate SafeScript source without compiling.
   * Returns { ok: boolean, errors: Array|null }.
   */
  validate: function(source) {
    try {
      var ast = parser.parse(source);
      return validator.validate(ast);
    } catch(e) {
      return {
        ok: false,
        errors: [{ message: e.message, line: e.line, col: e.col }]
      };
    }
  },

  /**
   * Parse SafeScript source to AST.
   * Throws SyntaxError on invalid input.
   */
  parse: function(source) {
    return parser.parse(source);
  },

  /**
   * Deep-copy an object to null-prototype objects.
   * Functions pass through (trusted API).
   */
  sanitize: function(obj) {
    return runtime.sanitize(obj);
  },

  /**
   * Parse .safe file header for capability declarations.
   * Returns { version, env, needs: [{name, type}], uses: [{name, type}] }.
   */
  capabilities: function(source) {
    return header.parseHeader(source);
  },

  /**
   * Check whether a scope satisfies a .safe file's @needs declarations.
   * Returns { ok: boolean, missing: string[] }.
   */
  checkScope: function(source, scope) {
    var caps = header.parseHeader(source);
    return header.checkScope(caps, scope);
  },

  /**
   * Load a .safe file: parse header, resolve capabilities, validate @needs.
   * Returns a Promise that resolves to a bundle { source, scope } you can
   * pass to run(). The resolver may be sync or async.
   *
   * @param {string} source - SafeScript source (with optional header)
   * @param {Function} [resolver] - function(caps) → scope object or Promise<scope>
   * @returns {Promise<{source: string, scope: Object}>} A bundle for run()
   */
  load: function(source, resolver) {
    var caps = header.parseHeader(source);
    var resolved = resolver ? resolver(caps) : {};
    // Support both sync and async resolvers
    return Promise.resolve(resolved).then(function(scope) {
      var check = header.checkScope(caps, scope);
      if (!check.ok) {
        throw new Error('Missing capabilities: ' + check.missing.join(', '));
      }
      return { source: source, scope: scope };
    });
  },

  /**
   * v0.1 compatibility: wrap mode (linter + global shadowing).
   * For quick demos. Use compile() + run() in production.
   */
  wrap: function(source, scope) {
    // Delegate to the old safe.js if available, or reimplement
    var SafeJS;
    try { SafeJS = require('./safe.js'); } catch(e) {}
    if (SafeJS && SafeJS.run) {
      return SafeJS.run(source, scope);
    }
    // Fallback: use the compiler pipeline
    return SafeScript.run(source, scope);
  }
};

module.exports = SafeScript;

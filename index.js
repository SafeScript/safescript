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
 *   SafeScript.capabilities(source)   → { version, env, needs, uses, types }
 *   SafeScript.checkScope(source, scope) → { ok, missing }
 *   SafeScript.load(source, resolver)    → Promise<bundle> (one-call integration)
 *   SafeScript.resolveUses(header)       → { dom, window, console, observers, canvas, media, navigation, usesEntries } (v1.3)
 *   SafeScript.types                     → built-in type names (v1.3)
 */
'use strict';

var parser = require('./src/parse');
var validator = require('./src/validate');
var compiler = require('./src/compile');
var runtime = require('./src/runtime');
var header = require('./src/header');
var debugModule = require('./src/debug');
var journalModule = require('./src/journal');
var protocolModule = require('./src/debug-protocol');

// Library registry — hosts register named libraries via SafeScript.lib()
var _libs = Object.create(null);

// Type name registry — maps string names (used in @type headers) to constructors
var _typeNames = Object.create(null);

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
    // Bundle overload: run({ source, scope, header })
    var parsedHeader = null;
    if (typeof source === 'object' && source !== null && typeof source.source === 'string') {
      opts = scope; // second arg becomes opts in bundle mode
      scope = source.scope;
      parsedHeader = source.header || null;
      source = source.source;
    }
    // v1.3: Parse header for @uses directives and pass to runtime
    if (!parsedHeader) {
      parsedHeader = header.parseHeader(source);
    }
    var runOpts = opts || {};
    runOpts.header = parsedHeader;
    var compiled = compiler.compile(source);
    var fn = runtime.buildFunction(compiled.code, scope, runOpts);
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
   * Returns { version, env, needs: [{name, type}], uses: [{name, type}], types: [{name, methods}] }.
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
      scope = scope || {};
      // Auto-fill from registered libraries for any @needs not in scope
      if (caps.needs) {
        for (var i = 0; i < caps.needs.length; i++) {
          var name = caps.needs[i].name;
          if (!(name in scope) && (name in _libs)) {
            scope[name] = _libs[name];
          }
        }
      }
      // Same for @uses (optional, no error if missing)
      if (caps.uses) {
        for (var j = 0; j < caps.uses.length; j++) {
          var uname = caps.uses[j].name;
          if (!(uname in scope) && (uname in _libs)) {
            scope[uname] = _libs[uname];
          }
        }
      }
      var check = header.checkScope(caps, scope);
      if (!check.ok) {
        throw new Error('Missing capabilities: ' + check.missing.join(', '));
      }
      // Validate @type declarations against type registry
      if (caps.types) {
        for (var k = 0; k < caps.types.length; k++) {
          var typeDef = caps.types[k];
          var ctor = _typeNames[typeDef.name];
          // Fallback: match against constructor.name in the type registry
          if (!ctor) {
            var regTypes = runtime.getRegisteredTypes();
            for (var ri = 0; ri < regTypes.length; ri++) {
              if (regTypes[ri].name === typeDef.name) {
                ctor = regTypes[ri].ctor;
                break;
              }
            }
          }
          if (!ctor) {
            throw new Error('SafeScript: @type "' + typeDef.name + '" is not registered. Register with SafeScript.lib(\'' + typeDef.name + '\', Constructor, { allowMethods: [...] })');
          }
          // Check each declared method is in the host's allowMethods
          var typeConfig = runtime.getTypeConfig(ctor);
          if (!typeConfig) {
            throw new Error('SafeScript: @type "' + typeDef.name + '" constructor is registered by name but has no type config');
          }
          var hostMethods = typeConfig.allowMethods || [];
          for (var mi = 0; mi < typeDef.methods.length; mi++) {
            var dm = typeDef.methods[mi];
            if (hostMethods.indexOf(dm) === -1) {
              throw new Error('SafeScript: @type "' + typeDef.name + '" declares method "' + dm + '" but host does not allow it. Allowed: ' + hostMethods.join(', '));
            }
          }
        }
      }
      return { source: source, scope: scope, header: caps };
    });
  },

  /**
   * Register a named library or a type whitelist.
   *
   * Two forms:
   *   lib(name, value)         — register a named library (matches @needs <name>)
   *   lib(Constructor, config) — register type whitelist: { allowMethods: ['m1', 'm2'] }
   *
   * Type registration controls which methods SafeScript code can call on
   * instances returned from host functions. Unregistered types block all
   * method calls (sandbox violation).
   *
   * @param {string|Function} nameOrCtor - Library name or constructor function
   * @param {*} value - Library value, or config object with allowMethods
   */
  lib: function(nameOrCtor, value) {
    // Three-arg form: lib('TypeName', Constructor, { allowMethods: [...] })
    if (typeof nameOrCtor === 'string' && nameOrCtor && typeof value === 'function') {
      var config = arguments[2];
      if (!config || !Array.isArray(config.allowMethods)) {
        throw new Error('SafeScript.lib: three-arg form requires config with allowMethods array');
      }
      _typeNames[nameOrCtor] = value;
      runtime.registerType(value, config);
      return;
    }
    if (typeof nameOrCtor === 'function') {
      // Type registration: SafeScript.lib(Constructor, { allowMethods: [...] })
      runtime.registerType(nameOrCtor, value);
      return;
    }
    if (typeof nameOrCtor !== 'string' || !nameOrCtor) {
      throw new Error('SafeScript.lib: first argument must be a non-empty string or a constructor function');
    }
    _libs[nameOrCtor] = value;
  },

  /**
   * Unregister a previously registered library or type.
   */
  unlib: function(nameOrCtor) {
    if (typeof nameOrCtor === 'function') {
      // Also remove any name mapping that points to this constructor
      var names = Object.keys(_typeNames);
      for (var i = 0; i < names.length; i++) {
        if (_typeNames[names[i]] === nameOrCtor) {
          delete _typeNames[names[i]];
        }
      }
      runtime.unregisterType(nameOrCtor);
      return;
    }
    // If it's a type name, also unregister the constructor
    if (_typeNames[nameOrCtor]) {
      runtime.unregisterType(_typeNames[nameOrCtor]);
      delete _typeNames[nameOrCtor];
      return;
    }
    delete _libs[nameOrCtor];
  },

  /**
   * List registered library names.
   */
  libs: function() {
    return Object.keys(_libs);
  },

  /**
   * Clear all type registrations (both constructor whitelists and named type mappings).
   */
  clearTypeRegistry: function() {
    runtime.clearTypeRegistry();
    // Also clear the name → constructor mapping
    var names = Object.keys(_typeNames);
    for (var i = 0; i < names.length; i++) {
      delete _typeNames[names[i]];
    }
  },

  /**
   * v2.0: Start a debug session.
   *
   * Compiles the source in debug mode (with __dbg checkpoints after every
   * statement), creates a DebugSession, and begins execution. The execution
   * pauses at breakpoints and can be controlled via the returned session.
   *
   * @param {string} source - SafeScript source code
   * @param {Object} scope - Capabilities to inject
   * @param {Object} [opts] - Debug options
   * @param {Function} [opts.onPause] - Called when paused at a breakpoint
   * @param {Function} [opts.onStep] - Called after each statement
   * @param {Function} [opts.onFinish] - Called when execution completes
   * @param {Function} [opts.onError] - Called on runtime error
   * @param {Array<number>} [opts.breakpoints] - Initial breakpoint lines
   * @param {boolean} [opts.captureAllLocals] - Capture locals at every step
   * @param {number} [opts.timeout] - Execution timeout in ms
   * @param {number} [opts.maxOps] - Max operations
   * @returns {DebugSession}
   */
  debug: function(source, scope, opts) {
    opts = opts || {};

    // Create the debug session
    var session = new debugModule.DebugSession({
      onPause: opts.onPause,
      onStep: opts.onStep,
      onFinish: opts.onFinish,
      onError: opts.onError,
      onCommit: opts.onCommit,
      onLog: opts.onLog,
      breakpoints: opts.breakpoints,
      captureAllLocals: opts.captureAllLocals
    });

    // Parse header
    var parsedHeader = header.parseHeader(source);

    // Compile in debug mode
    var compiled = compiler.compile(source, { debug: true });

    // Build the runtime function with debug session attached
    var runOpts = {
      timeout: opts.timeout || 0,
      maxOps: opts.maxOps,
      header: parsedHeader,
      debugSession: session,
      rawReturn: true, // debug mode returns raw values
      dom: opts.dom,
      allowNew: opts.allowNew
    };
    var fn = runtime.buildFunction(compiled.code, scope, runOpts);

    // Store compile function for evaluate()
    session._compileFn = function(src) { return compiler.compile(src); };

    // Attach a debug protocol driver if provided
    var protocol = null;
    if (opts.driver) {
      protocol = new protocolModule.DebugProtocol(session, opts.driver);
      protocol.setCompileTail(require('./src/compile').compileTail);
      session.protocol = protocol;
    }

    // Start execution (non-blocking — pauses at first __dbg checkpoint)
    var promise = fn();
    promise.then(
      function(v) {
        session.state = 'finished';
        session.onFinish(v);
      },
      function(e) {
        if (e.message !== 'SafeScript: debug session stopped') {
          session.state = 'finished';
          session.onError(e);
        }
      }
    );

    return session;
  },

  /**
   * v2.0: DebugSession class (exported for advanced use).
   */
  DebugSession: debugModule.DebugSession,

  /**
   * v2.0: Journal class (exported for advanced use).
   */
  Journal: journalModule.Journal,

  /**
   * v2.0: Debug protocol — pluggable transport for driving debug sessions.
   */
  DebugProtocol: protocolModule.DebugProtocol,
  InProcessDriver: protocolModule.InProcessDriver,
  PostMessageDriver: protocolModule.PostMessageDriver,
  PortDriver: protocolModule.PortDriver,
  DEBUG_COMMANDS: protocolModule.COMMANDS,
  DEBUG_EVENTS: protocolModule.EVENTS,

  /**
   * v2.0: compileTail for edit-and-continue.
   */
  compileTail: require('./src/compile').compileTail,

  /**
   * v2.0: Web Worker transport.
   * createWorkerProxy(worker, opts) — main-thread proxy for worker debug session.
   * runInWorker(self, source, scope, opts) — run debug session inside a Worker.
   */
  createWorkerProxy: require('./src/worker').createWorkerProxy,
  runInWorker: require('./src/worker').runInWorker,
  DebugProxy: require('./src/worker').DebugProxy,

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

// v1.3: Built-in type names for @uses directives
SafeScript.types = {
  SafeDOMDocument: 'SafeDOMDocument',
  SafeHTMLElement: 'SafeHTMLElement',
  SafeWindow: 'SafeWindow',
  SafeConsole: 'SafeConsole',
  SafeObservers: 'SafeObservers',
  SafeCanvas: 'SafeCanvas',
  SafeMedia: 'SafeMedia',
  SafeNavigation: 'SafeNavigation'
};

// v1.3: Resolve @uses directives against built-in types
SafeScript.resolveUses = header.resolveUses;

module.exports = SafeScript;

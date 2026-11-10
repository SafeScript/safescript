/**
 * SafeScript browser bundle builder.
 *
 * Run: node browser.js > safescript.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

function read(f) {
  return fs.readFileSync(path.join(__dirname, f), 'utf8');
}

// Map from require path to bundle variable name
var MODULE_MAP = {
  './defs': 'defs',
  './parse': 'parser',
  './validate': 'validator',
  './transform': 'transformer',
  './emit': 'emitter',
  './header': 'headerParser',
  // DOM modules
  './dom/index': 'domIndex',
  './dom/budgets': 'domBudgets',
  './dom/ownership': 'domOwnership',
  './dom/identity-cache': 'domIdentityCache',
  './dom/url-policy': 'domURLPolicy',
  './dom/sanitizer': 'domSanitizer',
  './dom/event-bridge': 'domEventBridge',
  './dom/safe-handle': 'domSafeHandle',
  './dom/safe-document': 'domSafeDocument',
  './dom/safe-timers': 'domSafeTimers',
  './dom/safe-window': 'domSafeWindow',
  './dom/safe-jquery': 'domSafeJQuery',
  './dom/safe-q': 'domSafeQ',
};

function wrapModule(name, src) {
  var out = src;

  // Replace `var xxx = require('./yyy');` with `var xxx = <bundle_var>;`
  // If the local var name matches the bundle var name, just remove the line
  // (the outer-scope variable is already visible).
  // Replace `var xxx = require('./yyy').prop;` with bundle var property access
  // (must run BEFORE the simple require pattern to avoid partial matches)
  out = out.replace(/var\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)\.(\w+);?/g,
    function(match, varName, reqPath, prop) {
      if (MODULE_MAP[reqPath]) {
        var bundleVar = MODULE_MAP[reqPath];
        return 'var ' + varName + ' = ' + bundleVar + '.' + prop + ';';
      }
      // For relative DOM requires within dom/ modules (e.g. './safe-handle' → domSafeHandle)
      var domRelative = './dom/' + reqPath.replace(/^\.\//, '');
      if (MODULE_MAP[domRelative]) {
        return 'var ' + varName + ' = ' + MODULE_MAP[domRelative] + '.' + prop + ';';
      }
      return '// ' + match + ' (stripped)';
    });

  // Replace `var xxx = require('./yyy');` with bundle var reference
  out = out.replace(/var\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
    function(match, varName, reqPath) {
      if (reqPath === 'crypto') return 'var ' + varName + ' = null;';
      if (MODULE_MAP[reqPath]) {
        var bundleVar = MODULE_MAP[reqPath];
        if (varName === bundleVar) return '// (uses outer ' + bundleVar + ')';
        return 'var ' + varName + ' = ' + bundleVar + ';';
      }
      // For relative requires within dom/ modules (e.g. './safe-handle' → domSafeHandle)
      var domRelative = './dom/' + reqPath.replace(/^\.\//, '');
      if (MODULE_MAP[domRelative]) {
        var bundleVar2 = MODULE_MAP[domRelative];
        if (varName === bundleVar2) return '// (uses outer ' + bundleVar2 + ')';
        return 'var ' + varName + ' = ' + bundleVar2 + ';';
      }
      return '// ' + match + ' (stripped)';
    });

  // Replace bare `try { crypto = require('crypto'); } catch(e) {...}` pattern
  out = out.replace(/try\s*\{\s*crypto\s*=\s*require\('crypto'\);\s*\}\s*catch\s*\(\w+\)\s*\{[^}]*\}/g, '');

  // Remove module.exports
  out = out.replace(/^module\.exports\s*=.*/gm, '');

  // Remove 'use strict' (we have it at the top level)
  out = out.replace(/^'use strict';\s*$/gm, '');

  return '// ── ' + name + ' ' + '─'.repeat(Math.max(1, 60 - name.length)) + '\nvar ' + name + ' = (function() {\n  var exports = {};\n' + out + '\n  return exports;\n})();\n';
}

var bundle = `(function(root) {
"use strict";

${wrapModule('defs', read('src/defs.js'))}
${wrapModule('parser', read('src/parse.js'))}
${wrapModule('validator', read('src/validate.js'))}
${wrapModule('transformer', read('src/transform.js'))}
${wrapModule('emitter', read('src/emit.js'))}
${wrapModule('runtime', read('src/runtime.js'))}
${wrapModule('compiler', read('src/compile.js'))}
${wrapModule('headerParser', read('src/header.js'))}

// ── DOM Membrane modules ───────────────────────────────────────────
${wrapModule('domBudgets', read('src/dom/budgets.js'))}
${wrapModule('domOwnership', read('src/dom/ownership.js'))}
${wrapModule('domSafeHandle', read('src/dom/safe-handle.js'))}
${wrapModule('domIdentityCache', read('src/dom/identity-cache.js'))}
${wrapModule('domURLPolicy', read('src/dom/url-policy.js'))}
${wrapModule('domSanitizer', read('src/dom/sanitizer.js'))}
${wrapModule('domEventBridge', read('src/dom/event-bridge.js'))}
${wrapModule('domSafeDocument', read('src/dom/safe-document.js'))}
${wrapModule('domSafeTimers', read('src/dom/safe-timers.js'))}
${wrapModule('domSafeWindow', read('src/dom/safe-window.js'))}
${wrapModule('domSafeJQuery', read('src/dom/safe-jquery.js'))}
${wrapModule('domSafeQ', read('src/dom/safe-q.js'))}
${wrapModule('domIndex', read('src/dom/index.js'))}

// ── Library and type-name registries (browser-local) ───────────────
var _libs = Object.create(null);
var _typeNames = Object.create(null);

// ── Public API ──────────────────────────────────────────────────────
var SafeScript = {
  compile: function(source) {
    return compiler.compile(source);
  },
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
      parsedHeader = headerParser.parseHeader(source);
    }
    var runOpts = opts || {};
    runOpts.header = parsedHeader;
    var compiled = compiler.compile(source);
    var fn = runtime.buildFunction(compiled.code, scope, runOpts);
    return fn();
  },
  validate: function(source) {
    try {
      var ast = parser.parse(source);
      return validator.validate(ast);
    } catch(e) {
      return { ok: false, errors: [{ message: e.message, line: e.line, col: e.col }] };
    }
  },
  parse: function(source) {
    return parser.parse(source);
  },
  sanitize: function(obj) {
    return runtime.sanitize(obj);
  },
  capabilities: function(source) {
    return headerParser.parseHeader(source);
  },
  checkScope: function(source, scope) {
    var caps = headerParser.parseHeader(source);
    return headerParser.checkScope(caps, scope);
  },
  load: function(source, resolver) {
    var caps = headerParser.parseHeader(source);
    var resolved = resolver ? resolver(caps) : {};
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
      var check = headerParser.checkScope(caps, scope);
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
            throw new Error('SafeScript: @type "' + typeDef.name + '" is not registered. Register with SafeScript.lib("' + typeDef.name + '", Constructor, { allowMethods: [...] })');
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
   * Three forms:
   *   lib(name, value)                    — register a named library (matches @needs <name>)
   *   lib(Constructor, config)            — register type whitelist: { allowMethods: ['m1', 'm2'] }
   *   lib('TypeName', Constructor, config) — register both name mapping and type whitelist
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
      var names = Object.keys(_typeNames);
      for (var i = 0; i < names.length; i++) {
        if (_typeNames[names[i]] === nameOrCtor) {
          delete _typeNames[names[i]];
        }
      }
      runtime.unregisterType(nameOrCtor);
      return;
    }
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
   * Clear all type registrations.
   */
  clearTypeRegistry: function() {
    runtime.clearTypeRegistry();
    var names = Object.keys(_typeNames);
    for (var i = 0; i < names.length; i++) {
      delete _typeNames[names[i]];
    }
  },
  /**
   * Async AST hash using SubtleCrypto (browser).
   */
  hashASTAsync: function(ast) {
    var normalized = JSON.stringify(ast, function(key, value) {
      if (key === 'loc' || key === 'line' || key === 'col') return undefined;
      return value;
    });
    var data = new TextEncoder().encode(normalized);
    return crypto.subtle.digest('SHA-256', data).then(function(buf) {
      var bytes = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        hex += ('0' + bytes[i].toString(16)).slice(-2);
      }
      return hex;
    });
  }
};

// v1.3: Built-in type names for @uses directives
SafeScript.types = {
  SafeDOMDocument: 'SafeDOMDocument',
  SafeHTMLElement: 'SafeHTMLElement',
  SafeWindow: 'SafeWindow',
  SafeJQuery: 'SafeJQuery',
  SafeQ: 'SafeQ',
  SafeConsole: 'SafeConsole',
  SafeObservers: 'SafeObservers',
  SafeCanvas: 'SafeCanvas',
  SafeMedia: 'SafeMedia',
  SafeNavigation: 'SafeNavigation'
};

// v1.3: Resolve @uses directives against built-in types
SafeScript.resolveUses = headerParser.resolveUses;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SafeScript;
} else {
  root.SafeScript = SafeScript;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
`;

process.stdout.write(bundle);

/**
 * SafeScript DOM — SafeQ framework bridge.
 *
 * A safe bridge to the Qbix Q framework for tool rendering.
 * Provides scoped access to:
 *   - Q.activate(element) — activate Q.Tools within the container
 *   - Q.Template.render — render Handlebars/Mustache templates
 *   - Q.handle — event dispatching (scoped)
 *   - Q.Tool state and element access (scoped)
 *   - Q.text — localized text access
 *   - Utility functions: Q.extend, Q.each, Q.getObject, Q.setObject, Q.isPlainObject
 *   - Q.url — URL generation
 *   - Q.addEventListener / Q.removeEventListener (scoped)
 *
 * Does NOT expose:
 *   - Q.req / Q.request (use SafeNetwork if needed)
 *   - Q.Socket / Q.Streams
 *   - Q.Users / Q.Streams direct access
 *   - Q.cookie / Q.localStorage
 *   - Q.page() (global page lifecycle)
 *   - Q.onInit / Q.onReady (global hooks)
 *
 * Requires the Q framework to be loaded on the host page.
 */
'use strict';

var resolveNode = require('./safe-handle').resolveNode;

/**
 * Create a SafeQ bridge for a SafeScript execution context.
 *
 * @param {Object} context - Execution context with rootNode, ownership, cache, budgets, handleFactory
 * @param {Object} safe$ - The Safe$ instance (for tool.$())
 * @returns {Object} The SafeQ facade
 */
function createSafeQ(context, safe$) {
  var rootNode     = context.rootNode;
  var ownership    = context.ownership;
  var budgets      = context.budgets;
  var handleFactory = context.handleFactory;

  // Reference to the real Q framework
  var Q = (typeof window !== 'undefined' && window.Q) ? window.Q : null;

  if (!Q) {
    // Return a stub that throws helpful errors
    var stub = Object.create(null);
    stub.activate = function() { throw new Error('SafeScript: Q framework is not loaded'); };
    stub.Template = Object.freeze({ render: function() { throw new Error('SafeScript: Q framework is not loaded'); } });
    return Object.freeze(stub);
  }

  var safeQ = Object.create(null);

  // ── Q.activate — activate tools within the container ──────────

  safeQ.activate = function(element) {
    var node;
    if (element === undefined) {
      node = rootNode;
    } else if (element && typeof element === 'object') {
      node = resolveNode(element);
      if (!node) {
        throw new TypeError('SafeScript Q: activate requires a valid element');
      }
    } else {
      throw new TypeError('SafeScript Q: activate requires a valid element');
    }

    // Must be within owned subtree
    if (!ownership.isInSubtree(node)) {
      throw new Error('SafeScript Q: cannot activate elements outside the owned subtree');
    }

    return Q.activate(node);
  };

  // ── Q.Template — safe template rendering ──────────────────────

  safeQ.Template = Object.create(null);

  safeQ.Template.render = function(name, fields, callback) {
    if (typeof name !== 'string') {
      throw new TypeError('SafeScript Q: Template.render requires a string template name');
    }
    // Limit template name length
    if (name.length > 256) {
      throw new Error('SafeScript Q: template name exceeds 256-character limit');
    }
    // Fields must be a plain object
    if (fields && typeof fields !== 'object') {
      throw new TypeError('SafeScript Q: Template.render fields must be an object');
    }

    // Delegate to real Q.Template.render
    if (Q.Template && typeof Q.Template.render === 'function') {
      return Q.Template.render(name, fields || {}, callback);
    }
    throw new Error('SafeScript Q: Q.Template.render is not available');
  };

  safeQ.Template.set = function(name, content, partials) {
    if (typeof name !== 'string') {
      throw new TypeError('SafeScript Q: Template.set requires a string template name');
    }
    if (name.length > 256) {
      throw new Error('SafeScript Q: template name exceeds 256-character limit');
    }
    if (typeof content !== 'string') {
      throw new TypeError('SafeScript Q: Template.set requires string content');
    }
    // Size limit on template content
    if (content.length > 65536) {
      throw new Error('SafeScript Q: template content exceeds 64KB limit');
    }
    if (Q.Template && typeof Q.Template.set === 'function') {
      return Q.Template.set(name, content, partials);
    }
    throw new Error('SafeScript Q: Q.Template.set is not available');
  };

  Object.freeze(safeQ.Template);

  // ── Q.Tool — safe tool wrapper ────────────────────────────────

  /**
   * Create a safe tool wrapper that provides:
   *   - tool.element (SafeHandle)
   *   - tool.state (read/write)
   *   - tool.$() (scoped jQuery via Safe$)
   *   - tool.id
   *   - tool.name
   */
  function wrapTool(nativeTool) {
    if (!nativeTool) return null;

    var wrapped = Object.create(null);

    // tool.element — SafeHandle of the tool's root element
    var toolElement = nativeTool.element;
    if (toolElement && ownership.isInSubtree(toolElement)) {
      Object.defineProperty(wrapped, 'element', {
        get: function() { return handleFactory(toolElement); },
        enumerable: true
      });
    }

    // tool.state — direct access (tools use this for configuration)
    Object.defineProperty(wrapped, 'state', {
      get: function() { return nativeTool.state; },
      set: function(v) { nativeTool.state = v; },
      enumerable: true
    });

    // tool.$() — scoped jQuery queries (uses Safe$)
    wrapped.$ = function(selector) {
      if (!safe$) {
        throw new Error('SafeScript Q: Safe$ is required for tool.$()');
      }
      if (!toolElement) return safe$('');  // empty collection
      var handle = handleFactory(toolElement);
      if (selector === undefined) {
        return safe$(handle);
      }
      return safe$(selector, handle);
    };

    // tool.id — read-only
    Object.defineProperty(wrapped, 'id', {
      value: nativeTool.id || '',
      writable: false,
      enumerable: true
    });

    // tool.name — read-only
    Object.defineProperty(wrapped, 'name', {
      value: nativeTool.name || '',
      writable: false,
      enumerable: true
    });

    // tool.prefix — read-only
    Object.defineProperty(wrapped, 'prefix', {
      value: nativeTool.prefix || '',
      writable: false,
      enumerable: true
    });

    // tool.child(name, id) — get child tool, wrapped
    wrapped.child = function(toolName, id) {
      if (typeof nativeTool.child !== 'function') return null;
      var child = nativeTool.child(toolName, id);
      if (!child) return null;
      if (child.element && !ownership.isInSubtree(child.element)) return null;
      return wrapTool(child);
    };

    // tool.children(name) — get child tools, wrapped
    wrapped.children = function(toolName) {
      if (typeof nativeTool.children !== 'function') return {};
      var children = nativeTool.children(toolName);
      var result = Object.create(null);
      if (children && typeof children === 'object') {
        var keys = Object.keys(children);
        for (var i = 0; i < keys.length; i++) {
          var child = children[keys[i]];
          if (child && child.element && ownership.isInSubtree(child.element)) {
            result[keys[i]] = wrapTool(child);
          }
        }
      }
      return result;
    };

    // tool.remove() — remove the tool
    wrapped.remove = function() {
      if (typeof nativeTool.remove === 'function') {
        nativeTool.remove();
      }
    };

    // tool.setUpElement() passthrough
    wrapped.setUpElement = function() {
      if (typeof nativeTool.setUpElement === 'function') {
        return nativeTool.setUpElement.apply(nativeTool, arguments);
      }
    };

    return Object.freeze(wrapped);
  }

  // ── Q.Tool.define — define a new tool type ────────────────────

  safeQ.Tool = Object.create(null);

  safeQ.Tool.define = function(name, methods, stateKeys) {
    if (typeof name !== 'string') {
      throw new TypeError('SafeScript Q: Tool.define requires a string tool name');
    }
    if (name.length > 128) {
      throw new Error('SafeScript Q: tool name exceeds 128-character limit');
    }
    if (!methods || typeof methods !== 'object') {
      throw new TypeError('SafeScript Q: Tool.define requires a methods object');
    }

    // Wrap the methods so `this` is a safe tool wrapper
    var wrappedMethods = {};
    var keys = Object.keys(methods);
    for (var i = 0; i < keys.length; i++) {
      (function(key) {
        var original = methods[key];
        if (typeof original === 'function') {
          wrappedMethods[key] = function() {
            // `this` is the native Q.Tool instance — wrap it
            var safeTool = wrapTool(this);
            return original.apply(safeTool, arguments);
          };
        } else {
          wrappedMethods[key] = original;
        }
      })(keys[i]);
    }

    if (Q.Tool && typeof Q.Tool.define === 'function') {
      return Q.Tool.define(name, wrappedMethods, stateKeys);
    }
    throw new Error('SafeScript Q: Q.Tool.define is not available');
  };

  // Q.Tool.jQuery — define a jQuery plugin on tool elements
  safeQ.Tool.jQuery = function(config) {
    if (Q.Tool && typeof Q.Tool.jQuery === 'function') {
      return Q.Tool.jQuery(config);
    }
  };

  Object.freeze(safeQ.Tool);

  // ── Q.handle — safe event dispatching ──────────────────────────
  // Native Q.handle accepts strings (global function lookup) which
  // would be a sandbox escape.  The safe version only accepts
  // Function, Q.Event, or arrays of those — reference-based only.

  function sanitizeHandler(h) {
    if (typeof h === 'function') return h;
    // Q.Event objects are plain objects with a "handlers" array
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      // If it's a Q.Event, strip any string handlers from its internals
      if (Array.isArray(h.handlers)) {
        var clean = [];
        for (var i = 0; i < h.handlers.length; i++) {
          if (typeof h.handlers[i] === 'function') {
            clean.push(h.handlers[i]);
          }
          // skip strings silently
        }
        h.handlers = clean;
      }
      return h;
    }
    if (Array.isArray(h)) {
      var safe = [];
      for (var j = 0; j < h.length; j++) {
        if (typeof h[j] === 'string') continue; // skip string handlers
        safe.push(sanitizeHandler(h[j]));
      }
      return safe;
    }
    // strings and anything else → reject
    return null;
  }

  safeQ.handle = function(handler, context, args) {
    if (typeof handler === 'string') {
      throw new Error('SafeScript Q: Q.handle does not accept string handlers — pass a function or Q.Event instead');
    }
    var cleaned = sanitizeHandler(handler);
    if (cleaned === null) return undefined;
    if (typeof Q.handle === 'function') {
      return Q.handle(cleaned, context, args);
    }
  };

  // ── Q.text — localized text (read-only view) ─────────────────

  Object.defineProperty(safeQ, 'text', {
    get: function() {
      return Q.text || {};
    },
    enumerable: true
  });

  // ── Utility functions ─────────────────────────────────────────

  safeQ.extend = function() {
    if (typeof Q.extend === 'function') {
      return Q.extend.apply(null, arguments);
    }
    // Fallback
    var target = arguments[0] || {};
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src && typeof src === 'object') {
        var keys = Object.keys(src);
        for (var j = 0; j < keys.length; j++) {
          target[keys[j]] = src[keys[j]];
        }
      }
    }
    return target;
  };

  safeQ.each = function(obj, callback) {
    if (typeof Q.each === 'function') {
      return Q.each(obj, callback);
    }
    // Fallback
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        if (callback.call(obj[i], i, obj[i]) === false) break;
      }
    } else if (obj && typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var j = 0; j < keys.length; j++) {
        if (callback.call(obj[keys[j]], keys[j], obj[keys[j]]) === false) break;
      }
    }
    return obj;
  };

  safeQ.getObject = function(name, obj, delimiter) {
    if (typeof Q.getObject === 'function') {
      return Q.getObject(name, obj, delimiter);
    }
    // Minimal fallback
    if (typeof name !== 'string') return undefined;
    var parts = name.split(delimiter || '.');
    var current = obj || {};
    for (var i = 0; i < parts.length; i++) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[parts[i]];
    }
    return current;
  };

  safeQ.setObject = function(name, value, obj, delimiter) {
    if (typeof Q.setObject === 'function') {
      return Q.setObject(name, value, obj, delimiter);
    }
    // Minimal fallback
    if (typeof name !== 'string') return;
    var parts = name.split(delimiter || '.');
    var current = obj || {};
    for (var i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return obj;
  };

  safeQ.isPlainObject = function(obj) {
    if (typeof Q.isPlainObject === 'function') return Q.isPlainObject(obj);
    return obj !== null && typeof obj === 'object' && (Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null);
  };

  safeQ.isArrayLike = function(obj) {
    if (typeof Q.isArrayLike === 'function') return Q.isArrayLike(obj);
    if (Array.isArray(obj)) return true;
    if (!obj || typeof obj !== 'object') return false;
    return typeof obj.length === 'number' && obj.length >= 0;
  };

  safeQ.typeOf = function(obj) {
    if (typeof Q.typeOf === 'function') return Q.typeOf(obj);
    if (obj === null) return 'null';
    if (Array.isArray(obj)) return 'array';
    return typeof obj;
  };

  // ── Q.url — safe URL generation ───────────────────────────────

  safeQ.url = function(what, fields, options) {
    if (typeof Q.url === 'function') {
      return Q.url(what, fields, options);
    }
    return '';
  };

  // ── Q.addEventListener / removeEventListener (scoped) ─────────

  var registeredQEvents = [];

  safeQ.addEventListener = function(eventName, handler, key) {
    if (typeof eventName !== 'string' || typeof handler !== 'function') {
      throw new TypeError('SafeScript Q: addEventListener requires a string event name and function handler');
    }
    budgets.allocListener();
    registeredQEvents.push({ name: eventName, handler: handler, key: key });
    if (typeof Q.addEventListener === 'function') {
      Q.addEventListener(eventName, handler, key);
    }
  };

  safeQ.removeEventListener = function(eventName, key) {
    if (typeof Q.removeEventListener === 'function') {
      Q.removeEventListener(eventName, key);
    }
    // Track removal
    for (var i = registeredQEvents.length - 1; i >= 0; i--) {
      if (registeredQEvents[i].name === eventName && registeredQEvents[i].key === key) {
        registeredQEvents.splice(i, 1);
        budgets.releaseListener();
        break;
      }
    }
  };

  // ── Q.pipe — safe pipe creation ───────────────────────────────

  safeQ.pipe = function(name) {
    if (typeof Q.pipe === 'function') return Q.pipe(name);
    return null;
  };

  // ── Q.Masks — UI masks ───────────────────────────────────────

  safeQ.Masks = Object.create(null);
  if (Q.Masks) {
    safeQ.Masks.show = function(name, options) {
      if (typeof Q.Masks.show === 'function') {
        // Ensure mask applies to our container
        var opts = safeQ.extend({}, options || {});
        if (!opts.element) {
          opts.element = rootNode;
        } else {
          var node = resolveNode(opts.element);
          if (node && ownership.isInSubtree(node)) {
            opts.element = node;
          } else {
            opts.element = rootNode;
          }
        }
        return Q.Masks.show(name, opts);
      }
    };
    safeQ.Masks.hide = function(name) {
      if (typeof Q.Masks.hide === 'function') {
        return Q.Masks.hide(name);
      }
    };
  }
  Object.freeze(safeQ.Masks);

  // ── Blocked Q APIs ────────────────────────────────────────────
  // These are explicitly NOT exposed. Access attempts return undefined via null prototype.
  // Q.req, Q.request, Q.Socket, Q.Streams, Q.Users, Q.cookie,
  // Q.localStorage, Q.sessionStorage, Q.page, Q.onInit, Q.onReady

  // ── Cleanup ───────────────────────────────────────────────────

  var cleanup = function() {
    // Remove all registered Q event listeners
    for (var i = 0; i < registeredQEvents.length; i++) {
      var entry = registeredQEvents[i];
      if (typeof Q.removeEventListener === 'function') {
        Q.removeEventListener(entry.name, entry.key);
      }
    }
    registeredQEvents = [];
  };

  return { facade: safeQ, cleanup: cleanup };
}

exports.createSafeQ = createSafeQ;

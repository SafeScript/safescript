/**
 * SafeScript DOM — SafeWindow facade.
 *
 * Read-only window facade that exposes:
 *   - Viewport dimensions (innerWidth, innerHeight, outerWidth, outerHeight)
 *   - Scroll position (scrollX, scrollY, pageXOffset, pageYOffset)
 *   - Device pixel ratio
 *   - getComputedStyle (returns read-only copy)
 *   - matchMedia (returns read-only MediaQueryList-like)
 *   - requestAnimationFrame / cancelAnimationFrame (budget-tracked)
 *
 * Everything else is blocked. No access to location, history, navigator,
 * document, opener, parent, frames, localStorage, sessionStorage, etc.
 */
'use strict';

/**
 * Properties on the real window that must NEVER be exposed.
 */
var BLOCKED_WINDOW_PROPS = {
  document: 1, location: 1, history: 1, navigator: 1,
  localStorage: 1, sessionStorage: 1, indexedDB: 1, caches: 1,
  opener: 1, parent: 1, top: 1, frames: 1, frameElement: 1,
  self: 1, globalThis: 1,
  fetch: 1, XMLHttpRequest: 1, WebSocket: 1, EventSource: 1,
  Worker: 1, SharedWorker: 1, ServiceWorker: 1,
  importScripts: 1, postMessage: 1,
  alert: 1, confirm: 1, prompt: 1, print: 1,
  open: 1, close: 1, stop: 1, focus: 1, blur: 1,
  eval: 1, Function: 1,
  crypto: 1, performance: 1,
  screen: 1, screenX: 1, screenY: 1, screenLeft: 1, screenTop: 1,
  moveTo: 1, moveBy: 1, resizeTo: 1, resizeBy: 1,
  getSelection: 1, find: 1,
  name: 1, status: 1, menubar: 1, toolbar: 1, statusbar: 1,
  scrollbars: 1, personalbar: 1, locationbar: 1,
  customElements: 1, Notification: 1, Permissions: 1,
  speechSynthesis: 1, visualViewport: 1
};

/**
 * Create a SafeWindow facade for a SafeScript execution context.
 *
 * @param {Object} context - Execution context with rootNode, ownership, cache, budgets
 * @param {Object} [budgets] - Budget tracker (for rAF tracking)
 * @returns {Object} Frozen SafeWindow facade
 */
function createSafeWindow(context, budgets) {
  var win = Object.create(null);

  // ── Read-only viewport dimensions ──────────────────────────────
  // These are live getters — they read from the real window each time.

  Object.defineProperty(win, 'innerWidth', {
    get: function() { return window.innerWidth; },
    enumerable: true, configurable: false
  });

  Object.defineProperty(win, 'innerHeight', {
    get: function() { return window.innerHeight; },
    enumerable: true, configurable: false
  });

  Object.defineProperty(win, 'outerWidth', {
    get: function() { return window.outerWidth; },
    enumerable: true, configurable: false
  });

  Object.defineProperty(win, 'outerHeight', {
    get: function() { return window.outerHeight; },
    enumerable: true, configurable: false
  });

  // ── Scroll position ────────────────────────────────────────────

  Object.defineProperty(win, 'scrollX', {
    get: function() { return window.scrollX || window.pageXOffset || 0; },
    enumerable: true, configurable: false
  });

  Object.defineProperty(win, 'scrollY', {
    get: function() { return window.scrollY || window.pageYOffset || 0; },
    enumerable: true, configurable: false
  });

  // Aliases
  Object.defineProperty(win, 'pageXOffset', {
    get: function() { return window.scrollX || window.pageXOffset || 0; },
    enumerable: true, configurable: false
  });

  Object.defineProperty(win, 'pageYOffset', {
    get: function() { return window.scrollY || window.pageYOffset || 0; },
    enumerable: true, configurable: false
  });

  // ── Device pixel ratio ─────────────────────────────────────────

  Object.defineProperty(win, 'devicePixelRatio', {
    get: function() { return window.devicePixelRatio || 1; },
    enumerable: true, configurable: false
  });

  // ── getComputedStyle ───────────────────────────────────────────
  // Returns a plain-object snapshot (not a live CSSStyleDeclaration).
  // Only works on nodes within the owned subtree.

  var resolveNode = require('./safe-handle').resolveNode;
  var ownership = context.ownership;

  win.getComputedStyle = function(handle, pseudoElt) {
    if (handle == null || typeof handle !== 'object') {
      throw new TypeError('SafeScript DOM: getComputedStyle requires a valid element');
    }
    // Resolve SafeHandle → native node via the module's WeakMap
    var node = resolveNode(handle);
    if (!node) {
      throw new TypeError('SafeScript DOM: getComputedStyle requires a valid element');
    }

    // Ownership check — must be in the owned subtree
    if (!ownership.isInSubtree(node)) {
      throw new TypeError('SafeScript DOM: getComputedStyle target is outside the owned subtree');
    }

    var computed = window.getComputedStyle(node, pseudoElt || null);
    // Return a plain-object snapshot of commonly used properties
    var snapshot = Object.create(null);
    var props = [
      'display', 'visibility', 'opacity', 'overflow', 'overflowX', 'overflowY',
      'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
      'zIndex', 'cursor', 'pointerEvents', 'boxSizing',
      'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
      'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'border', 'borderWidth', 'borderStyle', 'borderColor',
      'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
      'borderBottomLeftRadius', 'borderBottomRightRadius',
      'background', 'backgroundColor', 'backgroundImage', 'backgroundSize',
      'backgroundPosition', 'backgroundRepeat',
      'color', 'font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration',
      'textTransform', 'whiteSpace', 'wordBreak', 'wordSpacing', 'textOverflow',
      'transform', 'transformOrigin', 'transition', 'animation',
      'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
      'alignSelf', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'order', 'gap',
      'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow',
      'gridGap', 'gridArea', 'gridAutoFlow',
      'outline', 'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset',
      'boxShadow', 'textShadow', 'filter', 'backdropFilter',
      'objectFit', 'objectPosition', 'verticalAlign',
      'listStyleType', 'listStylePosition', 'listStyleImage',
      'tableLayout', 'borderCollapse', 'borderSpacing',
      'userSelect', 'resize', 'contain', 'willChange'
    ];
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      try { snapshot[p] = computed[p] || ''; } catch(e) { snapshot[p] = ''; }
    }
    // Also provide getPropertyValue for any CSS property
    snapshot.getPropertyValue = function(prop) {
      try { return computed.getPropertyValue(prop) || ''; } catch(e) { return ''; }
    };
    return Object.freeze(snapshot);
  };

  // ── matchMedia ─────────────────────────────────────────────────
  // Returns a read-only result, no addEventListener (use resize event instead).

  win.matchMedia = function(query) {
    if (typeof query !== 'string') {
      throw new TypeError('SafeScript DOM: matchMedia requires a string query');
    }
    // Limit query length to prevent abuse
    if (query.length > 512) {
      throw new Error('SafeScript DOM: matchMedia query exceeds 512-character limit');
    }
    var mql = window.matchMedia(query);
    return Object.freeze({
      matches: mql.matches,
      media: mql.media
    });
  };

  // ── requestAnimationFrame / cancelAnimationFrame ───────────────
  // Budget-tracked via timer budget.

  var rafIds = Object.create(null);
  var nextRafId = 1;

  win.requestAnimationFrame = function(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('SafeScript DOM: requestAnimationFrame requires a function callback');
    }
    if (budgets) budgets.allocTimer();
    var id = nextRafId++;
    var nativeId = requestAnimationFrame(function(timestamp) {
      delete rafIds[id];
      if (budgets) budgets.releaseTimer();
      try { callback(timestamp); } catch(e) { /* swallow */ }
    });
    rafIds[id] = nativeId;
    return id;
  };

  win.cancelAnimationFrame = function(id) {
    var nativeId = rafIds[id];
    if (nativeId === undefined) return;
    cancelAnimationFrame(nativeId);
    delete rafIds[id];
    if (budgets) budgets.releaseTimer();
  };

  // ── Cleanup helper (for context teardown) ──────────────────────
  var cleanupFn = function() {
    var ids = Object.keys(rafIds);
    for (var i = 0; i < ids.length; i++) {
      cancelAnimationFrame(rafIds[ids[i]]);
    }
    rafIds = Object.create(null);
  };

  // Freeze to prevent mutation
  Object.freeze(win);

  return { facade: win, cleanup: cleanupFn };
}

exports.createSafeWindow = createSafeWindow;
exports.BLOCKED_WINDOW_PROPS = BLOCKED_WINDOW_PROPS;

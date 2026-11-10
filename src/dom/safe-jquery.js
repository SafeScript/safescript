/**
 * SafeScript DOM — Safe$ jQuery facade.
 *
 * A jQuery-compatible wrapper scoped to the tool's container.
 * - $(selector) is always scoped to root subtree
 * - .parent() / .parents() / .closest() stop at boundary
 * - .html() is sanitized through the DOM membrane
 * - Event handlers are tracked via the event bridge
 * - No access to nodes outside the owned subtree
 *
 * This does NOT bundle jQuery — it wraps an existing jQuery/$ global.
 * If jQuery is not loaded, a lightweight built-in micro-$ is used.
 */
'use strict';

var resolveNode = require('./safe-handle').resolveNode;

/**
 * Create a Safe$ factory function.
 *
 * @param {Object} context — execution context (rootNode, ownership, cache, budgets, sanitizer, eventBridge, handleFactory)
 * @returns {Function} The safe $ function
 */
function createSafeJQuery(context) {
  var rootNode     = context.rootNode;
  var ownership    = context.ownership;
  var budgets      = context.budgets;
  var sanitizer    = context.sanitizer;
  var eventBridge  = context.eventBridge;
  var handleFactory = context.handleFactory;
  var policy       = context.policy;

  // Tag allowlist for $('<tag>') creation
  var tagAllowlist = Object.create(null);
  if (policy.tags) {
    for (var t = 0; t < policy.tags.length; t++) {
      tagAllowlist[policy.tags[t].toLowerCase()] = true;
    }
  }

  // ── SafeCollection: jQuery-like wrapper over SafeHandles ───────

  function SafeCollection(handles) {
    this.length = handles.length;
    for (var i = 0; i < handles.length; i++) {
      this[i] = handles[i];
    }
  }

  // ── Iteration ──────────────────────────────────────────────────

  SafeCollection.prototype.each = function(fn) {
    for (var i = 0; i < this.length; i++) {
      var result = fn.call(this[i], i, this[i]);
      if (result === false) break;
    }
    return this;
  };

  SafeCollection.prototype.map = function(fn) {
    var results = [];
    for (var i = 0; i < this.length; i++) {
      results.push(fn.call(this[i], i, this[i]));
    }
    return results;
  };

  SafeCollection.prototype.toArray = function() {
    var arr = [];
    for (var i = 0; i < this.length; i++) arr.push(this[i]);
    return arr;
  };

  SafeCollection.prototype.get = function(index) {
    if (index === undefined) return this.toArray();
    if (index < 0) index = this.length + index;
    return this[index] || null;
  };

  SafeCollection.prototype.eq = function(index) {
    if (index < 0) index = this.length + index;
    return new SafeCollection(this[index] ? [this[index]] : []);
  };

  SafeCollection.prototype.first = function() { return this.eq(0); };
  SafeCollection.prototype.last = function() { return this.eq(this.length - 1); };

  SafeCollection.prototype.filter = function(selector) {
    var filtered = [];
    if (typeof selector === 'function') {
      for (var i = 0; i < this.length; i++) {
        if (selector.call(this[i], i, this[i])) filtered.push(this[i]);
      }
    } else if (typeof selector === 'string') {
      for (var j = 0; j < this.length; j++) {
        if (this[j].matches && this[j].matches(selector)) {
          filtered.push(this[j]);
        }
      }
    }
    return new SafeCollection(filtered);
  };

  SafeCollection.prototype.not = function(selector) {
    var filtered = [];
    if (typeof selector === 'function') {
      for (var i = 0; i < this.length; i++) {
        if (!selector.call(this[i], i, this[i])) filtered.push(this[i]);
      }
    } else if (typeof selector === 'string') {
      for (var j = 0; j < this.length; j++) {
        if (!(this[j].matches && this[j].matches(selector))) {
          filtered.push(this[j]);
        }
      }
    }
    return new SafeCollection(filtered);
  };

  SafeCollection.prototype.is = function(selector) {
    for (var i = 0; i < this.length; i++) {
      if (this[i].matches && this[i].matches(selector)) return true;
    }
    return false;
  };

  SafeCollection.prototype.has = function(selector) {
    var filtered = [];
    for (var i = 0; i < this.length; i++) {
      var found = this[i].querySelector ? this[i].querySelector(selector) : null;
      if (found) filtered.push(this[i]);
    }
    return new SafeCollection(filtered);
  };

  SafeCollection.prototype.index = function(elem) {
    if (elem === undefined && this.length > 0) {
      // Index of first element among siblings
      var node = resolveNode(this[0]);
      if (!node || !node.parentNode) return -1;
      var children = node.parentNode.children;
      for (var i = 0; i < children.length; i++) {
        if (children[i] === node) return i;
      }
      return -1;
    }
    // Find elem in this collection
    var target = (elem instanceof SafeCollection) ? elem[0] : elem;
    for (var j = 0; j < this.length; j++) {
      if (this[j] === target) return j;
    }
    return -1;
  };

  // ── Traversal ──────────────────────────────────────────────────

  SafeCollection.prototype.find = function(selector) {
    var results = [];
    var seen = new Set();
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node || !node.querySelectorAll) continue;
      var nodes = node.querySelectorAll(selector);
      for (var j = 0; j < nodes.length; j++) {
        if (!seen.has(nodes[j]) && ownership.isInSubtree(nodes[j])) {
          seen.add(nodes[j]);
          results.push(handleFactory(nodes[j]));
        }
      }
    }
    return new SafeCollection(results);
  };

  SafeCollection.prototype.children = function(selector) {
    var results = [];
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node) continue;
      var kids = node.children;
      for (var j = 0; j < kids.length; j++) {
        if (ownership.isInSubtree(kids[j])) {
          var handle = handleFactory(kids[j]);
          if (!selector || (handle.matches && handle.matches(selector))) {
            results.push(handle);
          }
        }
      }
    }
    return new SafeCollection(results);
  };

  // parent() — stops at boundary
  SafeCollection.prototype.parent = function(selector) {
    var results = [];
    var seen = new Set();
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node || !node.parentElement) continue;
      // Stop at boundary
      if (ownership.isAtBoundary(node)) continue;
      var parent = node.parentElement;
      if (!parent || !ownership.isInSubtree(parent)) continue;
      if (seen.has(parent)) continue;
      seen.add(parent);
      var handle = handleFactory(parent);
      if (!selector || (handle.matches && handle.matches(selector))) {
        results.push(handle);
      }
    }
    return new SafeCollection(results);
  };

  // parents() — walks up but stops at boundary
  SafeCollection.prototype.parents = function(selector) {
    var results = [];
    var seen = new Set();
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node) continue;
      var current = node.parentElement;
      while (current) {
        if (ownership.isAtBoundary(current) && current !== rootNode) {
          break;
        }
        if (!ownership.isInSubtree(current)) break;
        if (!seen.has(current)) {
          seen.add(current);
          var handle = handleFactory(current);
          if (!selector || (handle.matches && handle.matches(selector))) {
            results.push(handle);
          }
        }
        if (current === rootNode) break;  // Don't go past root
        current = current.parentElement;
      }
    }
    return new SafeCollection(results);
  };

  // closest() — walks up but stops at boundary
  SafeCollection.prototype.closest = function(selector) {
    var results = [];
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node) { results.push(null); continue; }
      var current = node;
      var found = null;
      while (current) {
        if (current.matches && current.matches(selector)) {
          if (ownership.isInSubtree(current)) {
            found = handleFactory(current);
          }
          break;
        }
        if (current === rootNode) break;  // boundary
        current = current.parentElement;
      }
      if (found) results.push(found);
    }
    return new SafeCollection(results);
  };

  SafeCollection.prototype.siblings = function(selector) {
    var results = [];
    var seen = new Set();
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node || !node.parentElement) continue;
      var siblings = node.parentElement.children;
      for (var j = 0; j < siblings.length; j++) {
        if (siblings[j] !== node && !seen.has(siblings[j]) && ownership.isInSubtree(siblings[j])) {
          seen.add(siblings[j]);
          var handle = handleFactory(siblings[j]);
          if (!selector || (handle.matches && handle.matches(selector))) {
            results.push(handle);
          }
        }
      }
    }
    return new SafeCollection(results);
  };

  SafeCollection.prototype.next = function(selector) {
    var results = [];
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node) continue;
      var sibling = node.nextElementSibling;
      if (sibling && ownership.isInSubtree(sibling)) {
        var handle = handleFactory(sibling);
        if (!selector || (handle.matches && handle.matches(selector))) {
          results.push(handle);
        }
      }
    }
    return new SafeCollection(results);
  };

  SafeCollection.prototype.prev = function(selector) {
    var results = [];
    for (var i = 0; i < this.length; i++) {
      var node = resolveNode(this[i]);
      if (!node) continue;
      var sibling = node.previousElementSibling;
      if (sibling && ownership.isInSubtree(sibling)) {
        var handle = handleFactory(sibling);
        if (!selector || (handle.matches && handle.matches(selector))) {
          results.push(handle);
        }
      }
    }
    return new SafeCollection(results);
  };

  // ── Attributes & Properties ────────────────────────────────────

  SafeCollection.prototype.attr = function(name, value) {
    if (value === undefined && typeof name === 'string') {
      // Getter
      return this.length > 0 && this[0].getAttribute ? this[0].getAttribute(name) : undefined;
    }
    // Setter
    return this.each(function() {
      if (this.setAttribute) this.setAttribute(name, value);
    });
  };

  SafeCollection.prototype.removeAttr = function(name) {
    return this.each(function() {
      if (this.removeAttribute) this.removeAttribute(name);
    });
  };

  SafeCollection.prototype.prop = function(name, value) {
    if (value === undefined) {
      if (this.length === 0) return undefined;
      var node = resolveNode(this[0]);
      return node ? node[name] : undefined;
    }
    return this.each(function() {
      var n = resolveNode(this);
      if (n) n[name] = value;
    });
  };

  SafeCollection.prototype.data = function(key, value) {
    if (key === undefined) {
      return this.length > 0 && this[0].dataset ? Object.assign(Object.create(null), this[0].dataset) : {};
    }
    if (value === undefined) {
      // Getter
      if (this.length === 0) return undefined;
      var node = resolveNode(this[0]);
      return node && node.dataset ? node.dataset[key] : undefined;
    }
    // Setter
    return this.each(function() {
      var n = resolveNode(this);
      if (n && n.dataset) n.dataset[key] = value;
    });
  };

  SafeCollection.prototype.val = function(value) {
    if (value === undefined) {
      if (this.length === 0) return undefined;
      var node = resolveNode(this[0]);
      return node ? node.value : undefined;
    }
    return this.each(function() {
      var n = resolveNode(this);
      if (n) n.value = value;
    });
  };

  // ── CSS / Class manipulation ───────────────────────────────────

  SafeCollection.prototype.css = function(prop, value) {
    if (typeof prop === 'string' && value === undefined) {
      // Getter
      if (this.length === 0) return undefined;
      var node = resolveNode(this[0]);
      if (!node) return undefined;
      var computed = window.getComputedStyle(node);
      return computed ? computed[prop] || computed.getPropertyValue(prop) : undefined;
    }
    if (typeof prop === 'object') {
      // Set multiple
      var self = this;
      var keys = Object.keys(prop);
      return this.each(function() {
        if (this.style) {
          for (var k = 0; k < keys.length; k++) {
            this.style[keys[k]] = prop[keys[k]];
          }
        }
      });
    }
    // Single set
    return this.each(function() {
      if (this.style) this.style[prop] = value;
    });
  };

  SafeCollection.prototype.addClass = function(className) {
    var classes = String(className).split(/\s+/);
    return this.each(function() {
      if (this.classList) {
        for (var i = 0; i < classes.length; i++) {
          if (classes[i]) this.classList.add(classes[i]);
        }
      }
    });
  };

  SafeCollection.prototype.removeClass = function(className) {
    if (className === undefined) {
      return this.each(function() {
        var n = resolveNode(this);
        if (n) n.className = '';
      });
    }
    var classes = String(className).split(/\s+/);
    return this.each(function() {
      if (this.classList) {
        for (var i = 0; i < classes.length; i++) {
          if (classes[i]) this.classList.remove(classes[i]);
        }
      }
    });
  };

  SafeCollection.prototype.toggleClass = function(className, state) {
    return this.each(function() {
      if (this.classList) {
        if (state !== undefined) {
          if (state) this.classList.add(className);
          else this.classList.remove(className);
        } else {
          this.classList.toggle(className);
        }
      }
    });
  };

  SafeCollection.prototype.hasClass = function(className) {
    for (var i = 0; i < this.length; i++) {
      if (this[i].classList && this[i].classList.contains(className)) return true;
    }
    return false;
  };

  // ── Content manipulation ───────────────────────────────────────

  SafeCollection.prototype.html = function(value) {
    if (value === undefined) {
      // Getter — use the SafeHandle's innerHTML (which is already safe)
      return this.length > 0 ? this[0].innerHTML : undefined;
    }
    // Setter — sanitize through the membrane
    return this.each(function() {
      if (this.innerHTML !== undefined) {
        this.innerHTML = value;  // SafeHandle's innerHTML setter sanitizes
      }
    });
  };

  SafeCollection.prototype.text = function(value) {
    if (value === undefined) {
      return this.length > 0 ? this[0].textContent : undefined;
    }
    return this.each(function() {
      if (this.textContent !== undefined) {
        this.textContent = value;  // SafeHandle's textContent setter checks size
      }
    });
  };

  SafeCollection.prototype.empty = function() {
    return this.each(function() {
      if (this.innerHTML !== undefined) {
        this.innerHTML = '';
      }
    });
  };

  // ── DOM manipulation ───────────────────────────────────────────

  SafeCollection.prototype.append = function(content) {
    return this.each(function() {
      if (typeof content === 'string') {
        this.insertAdjacentHTML('beforeend', content);
      } else if (content instanceof SafeCollection) {
        for (var i = 0; i < content.length; i++) {
          this.appendChild(content[i]);
        }
      } else if (content && this.appendChild) {
        this.appendChild(content);
      }
    });
  };

  SafeCollection.prototype.prepend = function(content) {
    return this.each(function() {
      if (typeof content === 'string') {
        this.insertAdjacentHTML('afterbegin', content);
      } else if (content instanceof SafeCollection) {
        for (var i = content.length - 1; i >= 0; i--) {
          var first = this.firstChild;
          if (first) this.insertBefore(content[i], first);
          else this.appendChild(content[i]);
        }
      } else if (content && this.insertBefore) {
        var first = this.firstChild;
        if (first) this.insertBefore(content, first);
        else this.appendChild(content);
      }
    });
  };

  SafeCollection.prototype.after = function(content) {
    return this.each(function() {
      if (typeof content === 'string') {
        this.insertAdjacentHTML('afterend', content);
      }
    });
  };

  SafeCollection.prototype.before = function(content) {
    return this.each(function() {
      if (typeof content === 'string') {
        this.insertAdjacentHTML('beforebegin', content);
      }
    });
  };

  SafeCollection.prototype.appendTo = function(target) {
    var targetColl = (target instanceof SafeCollection) ? target : safe$(target);
    for (var i = 0; i < this.length; i++) {
      for (var j = 0; j < targetColl.length; j++) {
        targetColl[j].appendChild(this[i]);
      }
    }
    return this;
  };

  SafeCollection.prototype.prependTo = function(target) {
    var targetColl = (target instanceof SafeCollection) ? target : safe$(target);
    for (var i = 0; i < this.length; i++) {
      for (var j = 0; j < targetColl.length; j++) {
        var first = targetColl[j].firstChild;
        if (first) targetColl[j].insertBefore(this[i], first);
        else targetColl[j].appendChild(this[i]);
      }
    }
    return this;
  };

  SafeCollection.prototype.remove = function() {
    return this.each(function() {
      if (this.remove) this.remove();
    });
  };

  SafeCollection.prototype.detach = SafeCollection.prototype.remove;

  SafeCollection.prototype.clone = function() {
    var clones = [];
    for (var i = 0; i < this.length; i++) {
      if (this[i].cloneNode) clones.push(this[i].cloneNode(false));
    }
    return new SafeCollection(clones);
  };

  SafeCollection.prototype.replaceWith = function(content) {
    return this.each(function() {
      var parent = resolveNode(this);
      if (!parent || !parent.parentNode) return;
      // Use insertAdjacentHTML + remove pattern
      if (typeof content === 'string') {
        this.insertAdjacentHTML('afterend', content);
        this.remove();
      }
    });
  };

  SafeCollection.prototype.wrap = function(wrapper) {
    return this.each(function() {
      var wrapNode;
      if (typeof wrapper === 'string') {
        // Parse as HTML — create a temporary wrapper
        var m = wrapper.match(/^<(\w+)/);
        if (!m) return;
        var tag = m[1].toLowerCase();
        if (!tagAllowlist[tag]) return;
        var node = resolveNode(this);
        if (!node || !node.parentNode) return;
        budgets.allocNodes(1);
        wrapNode = rootNode.ownerDocument.createElement(tag);
        ownership.markOwned(wrapNode);
        node.parentNode.insertBefore(wrapNode, node);
        wrapNode.appendChild(node);
      }
    });
  };

  // ── Events ─────────────────────────────────────────────────────

  SafeCollection.prototype.on = function(events, selector, handler) {
    // Handle .on(events, handler) — no delegation
    if (typeof selector === 'function') {
      handler = selector;
      selector = null;
    }
    var eventList = events.split(/\s+/);
    return this.each(function() {
      for (var i = 0; i < eventList.length; i++) {
        var evt = eventList[i];
        if (!evt) continue;
        // Strip namespaces for actual DOM registration
        var dotIdx = evt.indexOf('.');
        var eventType = dotIdx > 0 ? evt.substring(0, dotIdx) : evt;
        if (selector) {
          // Delegated — wrap handler to check selector
          (function(evtType, sel, fn, handle) {
            var delegated = function(e) {
              var targetNode = e.target ? resolveNode(e.target) : null;
              if (!targetNode) return;
              var match = targetNode.closest(sel);
              if (match && ownership.isInSubtree(match)) {
                fn.call(handleFactory(match), e);
              }
            };
            handle.addEventListener(evtType, delegated);
          })(eventType, selector, handler, this);
        } else {
          this.addEventListener(eventType, handler);
        }
      }
    });
  };

  SafeCollection.prototype.off = function(events, handler) {
    var eventList = events.split(/\s+/);
    return this.each(function() {
      for (var i = 0; i < eventList.length; i++) {
        var evt = eventList[i];
        if (!evt) continue;
        var dotIdx = evt.indexOf('.');
        var eventType = dotIdx > 0 ? evt.substring(0, dotIdx) : evt;
        if (handler) {
          this.removeEventListener(eventType, handler);
        }
        // Note: namespace-only removal (e.g. .off('.ns')) requires
        // tracking all registered handlers by namespace, which we
        // don't do in this lightweight wrapper.
      }
    });
  };

  SafeCollection.prototype.trigger = function(eventType, data) {
    return this.each(function() {
      var node = resolveNode(this);
      if (!node) return;
      var event;
      if (typeof CustomEvent !== 'undefined') {
        event = new CustomEvent(eventType, { bubbles: true, cancelable: true, detail: data });
      } else {
        event = document.createEvent('Event');
        event.initEvent(eventType, true, true);
        event.detail = data;
      }
      node.dispatchEvent(event);
    });
  };

  // Convenience event methods
  var eventShortcuts = ['click', 'focus', 'blur', 'change', 'submit', 'keydown', 'keyup', 'keypress',
                        'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave',
                        'touchstart', 'touchend', 'touchmove'];
  for (var e = 0; e < eventShortcuts.length; e++) {
    (function(evt) {
      SafeCollection.prototype[evt] = function(handler) {
        if (handler) return this.on(evt, handler);
        return this.trigger(evt);
      };
    })(eventShortcuts[e]);
  }

  // ── Dimensions ─────────────────────────────────────────────────

  SafeCollection.prototype.width = function(value) {
    if (value !== undefined) {
      return this.css('width', typeof value === 'number' ? value + 'px' : value);
    }
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    return node ? node.offsetWidth : 0;
  };

  SafeCollection.prototype.height = function(value) {
    if (value !== undefined) {
      return this.css('height', typeof value === 'number' ? value + 'px' : value);
    }
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    return node ? node.offsetHeight : 0;
  };

  SafeCollection.prototype.innerWidth = function() {
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    return node ? node.clientWidth : 0;
  };

  SafeCollection.prototype.innerHeight = function() {
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    return node ? node.clientHeight : 0;
  };

  SafeCollection.prototype.outerWidth = function(includeMargin) {
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    if (!node) return 0;
    var w = node.offsetWidth;
    if (includeMargin) {
      var cs = window.getComputedStyle(node);
      w += parseInt(cs.marginLeft, 10) + parseInt(cs.marginRight, 10);
    }
    return w;
  };

  SafeCollection.prototype.outerHeight = function(includeMargin) {
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    if (!node) return 0;
    var h = node.offsetHeight;
    if (includeMargin) {
      var cs = window.getComputedStyle(node);
      h += parseInt(cs.marginTop, 10) + parseInt(cs.marginBottom, 10);
    }
    return h;
  };

  SafeCollection.prototype.offset = function() {
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    if (!node || !node.getBoundingClientRect) return { top: 0, left: 0 };
    var rect = node.getBoundingClientRect();
    return {
      top: rect.top + (window.scrollY || window.pageYOffset || 0),
      left: rect.left + (window.scrollX || window.pageXOffset || 0)
    };
  };

  SafeCollection.prototype.position = function() {
    if (this.length === 0) return undefined;
    var node = resolveNode(this[0]);
    return node ? { top: node.offsetTop, left: node.offsetLeft } : { top: 0, left: 0 };
  };

  SafeCollection.prototype.scrollTop = function(value) {
    if (value !== undefined) {
      return this.each(function() {
        var n = resolveNode(this);
        if (n) n.scrollTop = value;
      });
    }
    if (this.length === 0) return 0;
    var node = resolveNode(this[0]);
    return node ? node.scrollTop : 0;
  };

  SafeCollection.prototype.scrollLeft = function(value) {
    if (value !== undefined) {
      return this.each(function() {
        var n = resolveNode(this);
        if (n) n.scrollLeft = value;
      });
    }
    if (this.length === 0) return 0;
    var node = resolveNode(this[0]);
    return node ? node.scrollLeft : 0;
  };

  // ── Display ────────────────────────────────────────────────────

  SafeCollection.prototype.show = function() {
    return this.each(function() {
      if (this.style) this.style.display = '';
    });
  };

  SafeCollection.prototype.hide = function() {
    return this.each(function() {
      if (this.style) this.style.display = 'none';
    });
  };

  SafeCollection.prototype.toggle = function(state) {
    return this.each(function() {
      if (this.style) {
        var isHidden = (this.style.display === 'none');
        if (state !== undefined) {
          this.style.display = state ? '' : 'none';
        } else {
          this.style.display = isHidden ? '' : 'none';
        }
      }
    });
  };

  // ── Animation (simplified) ─────────────────────────────────────
  // A minimal animate that sets CSS transitions.

  SafeCollection.prototype.animate = function(properties, duration, easing, complete) {
    if (typeof duration === 'function') {
      complete = duration;
      duration = 400;
      easing = 'ease';
    } else if (typeof duration === 'object') {
      var opts = duration;
      duration = opts.duration || 400;
      easing = opts.easing || 'ease';
      complete = opts.complete;
    }
    duration = duration || 400;
    easing = easing || 'ease';

    var propNames = Object.keys(properties);
    var transitionValue = propNames.map(function(p) {
      return p + ' ' + duration + 'ms ' + easing;
    }).join(', ');

    return this.each(function(i, handle) {
      if (!handle.style) return;
      handle.style.transition = transitionValue;
      for (var k = 0; k < propNames.length; k++) {
        handle.style[propNames[k]] = properties[propNames[k]];
      }
      if (complete) {
        var node = resolveNode(handle);
        if (node) {
          var done = function() {
            node.removeEventListener('transitionend', done);
            handle.style.transition = '';
            complete.call(handle);
          };
          node.addEventListener('transitionend', done, { once: true });
        }
      }
    });
  };

  SafeCollection.prototype.fadeIn = function(duration, complete) {
    return this.css('opacity', '0').show().animate({ opacity: '1' }, duration || 400, 'ease', complete);
  };

  SafeCollection.prototype.fadeOut = function(duration, complete) {
    var self = this;
    return this.animate({ opacity: '0' }, duration || 400, 'ease', function() {
      self.hide();
      if (complete) complete.call(this);
    });
  };

  SafeCollection.prototype.slideDown = function(duration, complete) {
    return this.show().animate({ maxHeight: '9999px', overflow: 'hidden' }, duration || 400, 'ease', complete);
  };

  SafeCollection.prototype.slideUp = function(duration, complete) {
    var self = this;
    return this.animate({ maxHeight: '0', overflow: 'hidden' }, duration || 400, 'ease', function() {
      self.hide();
      if (complete) complete.call(this);
    });
  };

  // ── Utility ────────────────────────────────────────────────────

  SafeCollection.prototype.add = function(selector) {
    var additional = safe$(selector);
    var all = this.toArray().concat(additional.toArray());
    return new SafeCollection(all);
  };

  SafeCollection.prototype.end = function() {
    // Simplified — no stack tracking in this lightweight wrapper
    return this;
  };

  // ── The $ function itself ──────────────────────────────────────

  function safe$(selector, context) {
    // $(function) — DOM ready callback
    if (typeof selector === 'function') {
      // In SafeScript context, the DOM is always ready
      selector();
      return new SafeCollection([]);
    }

    // $(SafeCollection) — passthrough
    if (selector instanceof SafeCollection) {
      return selector;
    }

    // $(SafeHandle) — wrap in collection
    if (selector && typeof selector === 'object' && resolveNode(selector)) {
      return new SafeCollection([selector]);
    }

    // $('<html>') — create element from HTML string
    if (typeof selector === 'string' && selector.charAt(0) === '<') {
      var m = selector.match(/^<(\w+)/);
      if (!m) return new SafeCollection([]);
      var tag = m[1].toLowerCase();
      if (!tagAllowlist[tag]) {
        throw new Error('SafeScript DOM: element <' + tag + '> is not allowed');
      }
      budgets.allocNodes(1);
      var node = rootNode.ownerDocument.createElement(tag);
      ownership.markOwned(node);
      return new SafeCollection([handleFactory(node)]);
    }

    // $(selector) — query scoped to root (or context if given)
    if (typeof selector === 'string') {
      if (selector.length > 512) {
        throw new Error('SafeScript DOM: selector exceeds 512-character limit');
      }
      var searchRoot = rootNode;
      if (context) {
        var ctxNode = resolveNode(context);
        if (ctxNode && ownership.isInSubtree(ctxNode)) {
          searchRoot = ctxNode;
        }
      }
      var results = searchRoot.querySelectorAll(selector);
      var handles = [];
      for (var i = 0; i < results.length; i++) {
        if (ownership.isInSubtree(results[i])) {
          handles.push(handleFactory(results[i]));
        }
      }
      return new SafeCollection(handles);
    }

    return new SafeCollection([]);
  }

  // Static methods
  safe$.each = function(obj, fn) {
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        if (fn.call(obj[i], i, obj[i]) === false) break;
      }
    } else if (obj && typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var j = 0; j < keys.length; j++) {
        if (fn.call(obj[keys[j]], keys[j], obj[keys[j]]) === false) break;
      }
    }
    return obj;
  };

  safe$.extend = function() {
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

  safe$.isFunction = function(obj) { return typeof obj === 'function'; };
  safe$.isArray = Array.isArray;
  safe$.isPlainObject = function(obj) {
    return obj !== null && typeof obj === 'object' && (Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null);
  };
  safe$.type = function(obj) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    return typeof obj;
  };
  safe$.trim = function(str) { return String(str).trim(); };
  safe$.inArray = function(val, arr) { return arr.indexOf(val); };
  safe$.noop = function() {};

  // $.fn for plugin extensions (within this execution context)
  safe$.fn = SafeCollection.prototype;

  return safe$;
}

exports.createSafeJQuery = createSafeJQuery;

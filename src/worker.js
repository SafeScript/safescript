/**
 * SafeScript 2.0 — Web Worker Transport.
 *
 * Runs a SafeScript debug session inside a Web Worker, communicating with
 * the main thread via postMessage. The main thread gets a DebugProxy that
 * mirrors the DebugSession API — all calls are forwarded as commands.
 *
 * Usage (main thread):
 *   var worker = new Worker('safescript-worker-bootstrap.js');
 *   var proxy = SafeScript.createWorkerProxy(worker, { channel: 'my-debug' });
 *   proxy.onEvent = function(event) { ... };
 *   proxy.step();
 *   proxy.continue();
 *
 * Usage (worker):
 *   SafeScript.runInWorker(self, source, scope, opts);
 *   // The worker receives commands and emits events automatically.
 *
 * The channel parameter prevents cross-talk when multiple debug sessions
 * share the same Worker or MessagePort.
 */
'use strict';

var DebugProtocol = require('./debug-protocol').DebugProtocol;
var PostMessageDriver = require('./debug-protocol').PostMessageDriver;

/**
 * Run a SafeScript debug session inside a Worker.
 *
 * Call this from inside a Web Worker. It starts the debug session and
 * wires it to postMessage so the main thread can control it.
 *
 * @param {DedicatedWorkerGlobalScope} workerSelf - The worker's `self`
 * @param {string} source - SafeScript source code
 * @param {Object} scope - Scope object (must be transferable or cloneable)
 * @param {Object} [opts] - Options passed to SafeScript.debug()
 * @returns {Promise} The debug session result
 */
function runInWorker(workerSelf, source, scope, opts) {
  opts = opts || {};
  var channel = opts.channel || 'safescript-debug';

  // Create postMessage driver bound to the worker's global scope
  var driver = new PostMessageDriver(workerSelf, channel);

  // Start debug session with the driver attached
  opts.driver = driver;

  var SafeScript = require('../');
  return SafeScript.debug(source, scope, opts);
}

/**
 * DebugProxy — main-thread proxy for a worker-hosted debug session.
 *
 * Sends commands to the worker and receives events. Mirrors the
 * DebugSession API so the driver (SafeStudio etc.) can use it
 * without knowing whether the session is local or remote.
 *
 * @param {Worker|MessagePort} target - The Worker or MessagePort
 * @param {Object} [opts] - { channel: string, onEvent: function }
 */
function DebugProxy(target, opts) {
  opts = opts || {};
  this._target = target;
  this._channel = opts.channel || 'safescript-debug';
  this.onEvent = opts.onEvent || function() {};

  // State mirrored from events
  this.state = 'running';
  this.currentLine = 0;
  this.currentLocals = null;

  var self = this;

  // Listen for events from the worker
  var listener = function(event) {
    var msg = event.data;
    if (!msg || msg.channel !== self._channel) return;
    if (msg.direction !== 'event') return;

    var payload = msg.payload;
    if (!payload) return;

    // Update mirrored state
    if (payload.type === 'paused') {
      self.state = 'paused';
      self.currentLine = payload.data.line;
      self.currentLocals = payload.data.locals;
    } else if (payload.type === 'stepped') {
      self.currentLine = payload.data.line;
    } else if (payload.type === 'finished') {
      self.state = 'finished';
    } else if (payload.type === 'error') {
      self.state = 'error';
    }

    // Deliver to handler
    self.onEvent(payload);
  };

  if (typeof target.addEventListener === 'function') {
    target.addEventListener('message', listener);
  } else if (typeof target.on === 'function') {
    target.on('message', function(data) { listener({ data: data }); });
  }

  this._listener = listener;
}

/**
 * Send a command to the worker debug session.
 */
DebugProxy.prototype._send = function(type, data) {
  PostMessageDriver.sendCommand(this._target, type, data, this._channel);
};

// ── Mirror the DebugSession API ─────────────────────────────────────

DebugProxy.prototype.step = function() {
  this._send('step');
};

DebugProxy.prototype.continue = function() {
  this._send('continue');
};

DebugProxy.prototype.stop = function() {
  this._send('stop');
};

DebugProxy.prototype.setBreakpoints = function(lines) {
  this._send('setBreakpoints', { lines: lines });
};

DebugProxy.prototype.toggleBreakpoint = function(line) {
  this._send('toggleBreakpoint', { line: line });
};

DebugProxy.prototype.runToLine = function(line) {
  this._send('runToLine', { line: line });
};

DebugProxy.prototype.editAndContinue = function(source) {
  this._send('editAndContinue', { source: source });
};

DebugProxy.prototype.rewindTo = function(stepIndex) {
  this._send('rewindTo', { stepIndex: stepIndex });
};

DebugProxy.prototype.commit = function() {
  this._send('commit');
};

DebugProxy.prototype.discard = function() {
  this._send('discard');
};

DebugProxy.prototype.getLocals = function() {
  this._send('getLocals');
};

DebugProxy.prototype.getHistory = function() {
  this._send('getHistory');
};

DebugProxy.prototype.getJournal = function() {
  this._send('getJournal');
};

DebugProxy.prototype.getNodeTimeline = function(node, prop) {
  this._send('getNodeTimeline', { node: node, prop: prop });
};

DebugProxy.prototype.getDOMSnapshots = function() {
  this._send('getDOMSnapshots');
};

DebugProxy.prototype.snapshotDOM = function() {
  this._send('snapshotDOM');
};

DebugProxy.prototype.restoreDOM = function(snapshotIndex) {
  this._send('restoreDOM', { snapshotIndex: snapshotIndex });
};

DebugProxy.prototype.stepOver = function() {
  this._send('stepOver');
};

DebugProxy.prototype.stepOut = function() {
  this._send('stepOut');
};

DebugProxy.prototype.evaluate = function(expression) {
  this._send('evaluate', { expression: expression });
};

DebugProxy.prototype.setConditionalBreakpoint = function(line, condition) {
  this._send('setConditionalBreakpoint', { line: line, condition: condition });
};

DebugProxy.prototype.fork = function() {
  this._send('fork');
};

DebugProxy.prototype.serialize = function() {
  this._send('serialize');
};

DebugProxy.prototype.setLogpoint = function(line, template) {
  this._send('setLogpoint', { line: line, template: template });
};

DebugProxy.prototype.removeLogpoint = function(line) {
  this._send('removeLogpoint', { line: line });
};

/**
 * Disconnect the proxy — stop listening for events.
 */
DebugProxy.prototype.disconnect = function() {
  if (this._listener && typeof this._target.removeEventListener === 'function') {
    this._target.removeEventListener('message', this._listener);
  }
  this._listener = null;
};

/**
 * Create a DebugProxy for a Worker or MessagePort.
 *
 * @param {Worker|MessagePort} target
 * @param {Object} [opts] - { channel, onEvent }
 * @returns {DebugProxy}
 */
function createWorkerProxy(target, opts) {
  return new DebugProxy(target, opts);
}

exports.runInWorker = runInWorker;
exports.createWorkerProxy = createWorkerProxy;
exports.DebugProxy = DebugProxy;

/**
 * SafeScript 2.0 — Debug Protocol.
 *
 * Pluggable bidirectional interface between a DebugSession (the engine)
 * and a driver (the UI/IDE). Transport-agnostic: works over postMessage,
 * WebSocket, TCP, or in-process function calls.
 *
 * The protocol defines:
 *   - 25 Commands (driver → engine): step, continue, stop, stepOver, stepOut,
 *     setBreakpoints, toggleBreakpoint, runToLine, setConditionalBreakpoint,
 *     editAndContinue, evaluate, rewindTo, commit, discard, getLocals,
 *     getHistory, getJournal, getNodeTimeline, getDOMSnapshots, snapshotDOM,
 *     restoreDOM, fork, serialize, setLogpoint, removeLogpoint
 *   - 18 Events (engine → driver): paused, stepped, finished, error,
 *     committed, discarded, rewound, locals, history, journal, nodeTimeline,
 *     domSnapshots, domSnapshot, domRestored, evaluated, forked, serialized,
 *     logpoint
 *
 * A driver implements send(event) to deliver events to its UI.
 * The engine calls driver.send() on state changes.
 * The driver calls session methods (via the protocol adapter) to control execution.
 *
 * Built-in transports:
 *   - InProcessDriver: direct function calls (same thread)
 *   - PostMessageDriver: Web Worker / iframe postMessage
 *   - PortDriver: MessagePort (SharedWorker, BroadcastChannel)
 *
 * Third-party transports (SafeStudio, xdebug-style):
 *   - WebSocketDriver: over ws:// (implement send/onMessage)
 *   - StreamDriver: over Qbix Streams (implement send/onMessage)
 */
'use strict';

// ── Protocol message types ──────────────────────────────────────────

var COMMANDS = {
  step: 'step',
  continue: 'continue',
  stop: 'stop',
  setBreakpoints: 'setBreakpoints',
  toggleBreakpoint: 'toggleBreakpoint',
  runToLine: 'runToLine',
  editAndContinue: 'editAndContinue',
  rewindTo: 'rewindTo',
  commit: 'commit',
  discard: 'discard',
  getLocals: 'getLocals',
  getHistory: 'getHistory',
  getJournal: 'getJournal',
  getNodeTimeline: 'getNodeTimeline',
  getDOMSnapshots: 'getDOMSnapshots',
  snapshotDOM: 'snapshotDOM',
  restoreDOM: 'restoreDOM',
  stepOver: 'stepOver',
  stepOut: 'stepOut',
  evaluate: 'evaluate',
  setConditionalBreakpoint: 'setConditionalBreakpoint',
  fork: 'fork',
  serialize: 'serialize',
  setLogpoint: 'setLogpoint',
  removeLogpoint: 'removeLogpoint'
};

var EVENTS = {
  paused: 'paused',
  stepped: 'stepped',
  finished: 'finished',
  error: 'error',
  committed: 'committed',
  discarded: 'discarded',
  rewound: 'rewound',
  locals: 'locals',
  history: 'history',
  journal: 'journal',
  nodeTimeline: 'nodeTimeline',
  domSnapshots: 'domSnapshots',
  domSnapshot: 'domSnapshot',
  domRestored: 'domRestored',
  evaluated: 'evaluated',
  forked: 'forked',
  serialized: 'serialized',
  logpoint: 'logpoint'
};

// ── DebugProtocol — adapter between DebugSession and a driver ───────

/**
 * DebugProtocol — bridges a DebugSession to a driver transport.
 *
 * @param {DebugSession} session - The debug session to control
 * @param {Object} driver - Transport with send(event) method
 */
function DebugProtocol(session, driver) {
  this.session = session;
  this.driver = driver;
  this._compileTailFn = null; // set externally for edit-and-continue

  var self = this;

  // Wire session callbacks to driver events
  // Use a wrapper that delegates to both the original callback AND the protocol
  var origOnPause = session.onPause || function(){};
  session.onPause = function(info) {
    if (typeof origOnPause === 'function') origOnPause(info);
    self._emit(EVENTS.paused, {
      line: info.line,
      locals: info.locals,
      effects: info.effects,
      rewound: info.rewound || false,
      state: session.state
    });
  };

  var origOnStep = session.onStep;
  session.onStep = function(step) {
    origOnStep(step);
    self._emit(EVENTS.stepped, {
      index: step.index,
      line: step.line,
      effects: step.effects || null
    });
  };

  var origOnFinish = session.onFinish;
  session.onFinish = function(value) {
    origOnFinish(value);
    self._emit(EVENTS.finished, {
      value: value,
      journalSummary: session.journal.summary(),
      historyLength: session.history.length
    });
  };

  var origOnError = session.onError;
  session.onError = function(err) {
    origOnError(err);
    self._emit(EVENTS.error, {
      message: err.message,
      line: session.currentLine
    });
  };

  // Wire logpoint callback to protocol event
  session.onLog = function(info) {
    self._emit(EVENTS.logpoint, {
      line: info.line,
      message: info.message,
      step: info.step
    });
  };

  // If driver has an onMessage method, wire it to handleCommand
  if (driver.onMessage) {
    driver.onMessage(function(msg) {
      self.handleCommand(msg);
    });
  }
}

/**
 * Emit an event to the driver.
 */
DebugProtocol.prototype._emit = function(type, data) {
  this.driver.send({ type: type, data: data });
};

/**
 * Handle a command from the driver.
 * Commands are { type: string, data?: any }.
 */
DebugProtocol.prototype.handleCommand = function(msg) {
  var session = this.session;
  var type = msg.type;
  var data = msg.data || {};

  switch (type) {
    case COMMANDS.step:
      session.step();
      break;

    case COMMANDS.continue:
      session.continue();
      break;

    case COMMANDS.stop:
      session.stop();
      break;

    case COMMANDS.setBreakpoints:
      session.setBreakpoints(data.lines || []);
      break;

    case COMMANDS.toggleBreakpoint:
      session.toggleBreakpoint(data.line);
      break;

    case COMMANDS.runToLine:
      session.runToLine(data.line);
      break;

    case COMMANDS.editAndContinue:
      if (data.source && session.editAndContinue) {
        try {
          var ok = session.editAndContinue(data.source);
          if (ok) {
            this._emit('editAccepted', { line: session.currentLine });
          }
        } catch (e) {
          this._emit(EVENTS.error, { message: 'Edit rejected: ' + e.message });
        }
      } else if (data.replacementFn) {
        // Direct function replacement (in-process driver)
        session.setReplacement(data.replacementFn);
      }
      break;

    case COMMANDS.rewindTo:
      session.rewindTo(data.stepIndex);
      this._emit(EVENTS.rewound, {
        stepIndex: data.stepIndex,
        line: session.currentLine,
        locals: session.currentLocals
      });
      break;

    case COMMANDS.commit:
      var result = session.commit();
      this._emit(EVENTS.committed, result);
      break;

    case COMMANDS.discard:
      session.discard();
      this._emit(EVENTS.discarded, {});
      break;

    case COMMANDS.getLocals:
      this._emit(EVENTS.locals, {
        line: session.currentLine,
        locals: session.currentLocals,
        state: session.state
      });
      break;

    case COMMANDS.getHistory:
      this._emit(EVENTS.history, {
        history: session.getHistory(),
        length: session.history.length
      });
      break;

    case COMMANDS.getJournal:
      this._emit(EVENTS.journal, {
        entries: session.journal.entries(),
        externals: session.journal.externalEntries(),
        summary: session.journal.summary()
      });
      break;

    case COMMANDS.getNodeTimeline:
      if (data.node) {
        this._emit(EVENTS.nodeTimeline, {
          timeline: session.getNodeTimeline(data.node),
          steps: session.queryNodeSteps(data.node, data.prop)
        });
      }
      break;

    case COMMANDS.getDOMSnapshots:
      this._emit(EVENTS.domSnapshots, {
        snapshots: session.getDOMSnapshots().map(function(s) {
          return { stepIndex: s.stepIndex, htmlLength: s.html.length };
        }),
        count: session._domSnapshots.length
      });
      break;

    case COMMANDS.snapshotDOM:
      var snap = session.snapshotDOM();
      this._emit(EVENTS.domSnapshot, {
        stepIndex: snap ? snap.stepIndex : null,
        index: session._domSnapshots.length - 1
      });
      break;

    case COMMANDS.restoreDOM:
      session.restoreDOM(data.snapshotIndex);
      this._emit(EVENTS.domRestored, {
        snapshotIndex: data.snapshotIndex
      });
      break;

    case COMMANDS.stepOver:
      session.stepOver();
      break;

    case COMMANDS.stepOut:
      session.stepOut();
      break;

    case COMMANDS.evaluate:
      try {
        var evalResult = session.evaluate(data.expression);
        this._emit(EVENTS.evaluated, { expression: data.expression, result: evalResult });
      } catch (evalErr) {
        this._emit(EVENTS.evaluated, { expression: data.expression, error: evalErr.message });
      }
      break;

    case COMMANDS.setConditionalBreakpoint:
      session.setConditionalBreakpoint(data.line, data.condition);
      break;

    case COMMANDS.fork:
      var forkedSession = session.fork();
      this._emit(EVENTS.forked, { state: forkedSession.state, line: forkedSession.currentLine });
      break;

    case COMMANDS.serialize:
      this._emit(EVENTS.serialized, { data: session.serialize() });
      break;

    case COMMANDS.setLogpoint:
      session.setLogpoint(data.line, data.template);
      break;

    case COMMANDS.removeLogpoint:
      session.removeLogpoint(data.line);
      break;

    default:
      // Unknown command — ignore (forward-compatible)
      break;
  }
};

/**
 * Set the compileTail function for edit-and-continue.
 * Called by SafeScript.debug() after creating the protocol.
 */
DebugProtocol.prototype.setCompileTail = function(fn) {
  this._compileTailFn = fn;
};

/**
 * Disconnect — remove session callback wiring.
 */
DebugProtocol.prototype.disconnect = function() {
  // Restore original no-op callbacks
  this.session.onPause = function(){};
  this.session.onStep = function(){};
  this.session.onFinish = function(){};
  this.session.onError = function(){};
};

// ── Built-in transports ─────────────────────────────────────────────

/**
 * InProcessDriver — direct function calls, same thread.
 * The simplest driver: events are delivered via a callback.
 */
function InProcessDriver(onEvent) {
  this._onEvent = onEvent || function(){};
  this._onMessageFn = null;
}

InProcessDriver.prototype.send = function(event) {
  this._onEvent(event);
};

InProcessDriver.prototype.onMessage = function(fn) {
  this._onMessageFn = fn;
};

/**
 * Send a command to the debug engine.
 * This is what the UI calls.
 */
InProcessDriver.prototype.command = function(type, data) {
  if (this._onMessageFn) {
    this._onMessageFn({ type: type, data: data || {} });
  }
};

/**
 * PostMessageDriver — communicates over window.postMessage or Worker.postMessage.
 *
 * @param {Object} target - The postMessage target (Worker, Window, or MessagePort)
 * @param {string} [channel] - Optional channel name for filtering messages
 */
function PostMessageDriver(target, channel) {
  this._target = target;
  this._channel = channel || 'safescript-debug';
  this._onMessageFn = null;

  var self = this;

  // Listen for incoming messages
  var listener = function(event) {
    var msg = event.data;
    if (!msg || msg.channel !== self._channel) return;
    if (msg.direction === 'command' && self._onMessageFn) {
      self._onMessageFn(msg.payload);
    }
  };

  if (typeof target.addEventListener === 'function') {
    target.addEventListener('message', listener);
  } else if (typeof target.on === 'function') {
    target.on('message', function(data) { listener({ data: data }); });
  }

  this._listener = listener;
}

PostMessageDriver.prototype.send = function(event) {
  var msg = {
    channel: this._channel,
    direction: 'event',
    payload: event
  };
  if (typeof this._target.postMessage === 'function') {
    this._target.postMessage(msg);
  }
};

PostMessageDriver.prototype.onMessage = function(fn) {
  this._onMessageFn = fn;
};

/**
 * Send a command from the driver side (UI thread).
 * Used by the UI to control the debug session running in a worker.
 */
PostMessageDriver.sendCommand = function(target, type, data, channel) {
  target.postMessage({
    channel: channel || 'safescript-debug',
    direction: 'command',
    payload: { type: type, data: data || {} }
  });
};

/**
 * PortDriver — communicates over a MessagePort (SharedWorker, BroadcastChannel).
 *
 * @param {MessagePort} port - The port to communicate over
 * @param {string} [channel] - Optional channel name
 */
function PortDriver(port, channel) {
  this._port = port;
  this._channel = channel || 'safescript-debug';
  this._onMessageFn = null;

  var self = this;
  port.onmessage = function(event) {
    var msg = event.data;
    if (!msg || msg.channel !== self._channel) return;
    if (msg.direction === 'command' && self._onMessageFn) {
      self._onMessageFn(msg.payload);
    }
  };
}

PortDriver.prototype.send = function(event) {
  this._port.postMessage({
    channel: this._channel,
    direction: 'event',
    payload: event
  });
};

PortDriver.prototype.onMessage = function(fn) {
  this._onMessageFn = fn;
};

// ── Exports ─────────────────────────────────────────────────────────

exports.DebugProtocol = DebugProtocol;
exports.InProcessDriver = InProcessDriver;
exports.PostMessageDriver = PostMessageDriver;
exports.PortDriver = PortDriver;
exports.COMMANDS = COMMANDS;
exports.EVENTS = EVENTS;

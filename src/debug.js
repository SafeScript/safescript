/**
 * SafeScript 2.0 — Debug runtime.
 *
 * DebugSession: breakpoints, step/continue/stop, edit-and-continue.
 * __dbg: checkpoint function injected after every statement in debug mode.
 *
 * The pause mechanism is `await` — __dbg returns a Promise that doesn't
 * resolve until the user acts (step, continue, stop). The browser event
 * loop stays alive; the UI stays responsive.
 */
'use strict';

var Journal = require('./journal').Journal;

/**
 * DebugSession — controls a running debug execution.
 *
 * @param {Object} opts
 * @param {Function} [opts.onPause] - Called when a breakpoint is hit or stepping
 * @param {Function} [opts.onStep]  - Called after each statement
 * @param {Function} [opts.onFinish] - Called when execution completes
 * @param {Function} [opts.onError]  - Called on runtime error
 * @param {Array<number>} [opts.breakpoints] - Initial breakpoint line numbers
 * @param {boolean} [opts.captureAllLocals] - Capture locals at every step, not just pauses
 */
function DebugSession(opts) {
  opts = opts || {};
  this.breakpoints = {};
  this._breakpointConditions = {}; // line → condition source string
  var bps = opts.breakpoints || [];
  for (var i = 0; i < bps.length; i++) {
    if (typeof bps[i] === 'object') {
      // { line: N, condition: 'expr' }
      this.breakpoints[bps[i].line] = true;
      if (bps[i].condition) this._breakpointConditions[bps[i].line] = bps[i].condition;
    } else {
      this.breakpoints[bps[i]] = true;
    }
  }
  this.stepping = true;           // start paused at first statement
  this._stepMode = 'into';       // 'into' | 'over' | 'out'
  this._stepDepth = 0;           // call depth when stepOver/stepOut was issued
  this._callDepth = 0;           // current call depth (tracked by __dbg)
  this.state = 'running';         // 'running' | 'paused' | 'finished'
  this.currentLine = 0;
  this.currentLocals = null;
  this.replacement = null;        // edit-and-continue replacement function
  this.resume = null;             // resolve function for the pause promise
  this.history = [];              // array of step snapshots
  this.captureAllLocals = !!opts.captureAllLocals;

  // Journal: write-ahead log with read overlay
  this.journal = new Journal();

  // Logpoints: line → template string with {expr} interpolation
  this._logpoints = {};

  // Host callbacks
  this.onPause = opts.onPause || function(){};
  this.onStep = opts.onStep || function(){};
  this.onFinish = opts.onFinish || function(){};
  this.onError = opts.onError || function(){};
  this.onCommit = opts.onCommit || null;
  this.onLog = opts.onLog || null;

  // Internal: side-effect log for current step (populated by __set/__at/__call in debug mode)
  this._effectLog = [];

  // DOM snapshots for time travel (innerHTML at commit points)
  this._domSnapshots = [];    // { stepIndex, html, root }
  this._domRoot = null;       // set when DOM context is attached
}

/**
 * Step one statement — resolves the pause promise, sets stepping flag.
 */
DebugSession.prototype.step = function() {
  this.stepping = true;
  if (this.resume) {
    var r = this.resume;
    this.resume = null;
    r();
  }
};

/**
 * Continue until next breakpoint or end.
 */
DebugSession.prototype.continue = function() {
  this.stepping = false;
  if (this.resume) {
    var r = this.resume;
    this.resume = null;
    r();
  }
};

/**
 * Run to a specific line (one-shot breakpoint).
 */
DebugSession.prototype.runToLine = function(line) {
  this.breakpoints[line] = true;
  this._oneShotLine = line;
  this.continue();
};

/**
 * Toggle a breakpoint on/off.
 */
DebugSession.prototype.toggleBreakpoint = function(line) {
  if (this.breakpoints[line]) {
    delete this.breakpoints[line];
    delete this._breakpointConditions[line]; // clean up condition too
  } else {
    this.breakpoints[line] = true;
  }
};

/**
 * Set breakpoints (replaces all).
 */
DebugSession.prototype.setBreakpoints = function(lines) {
  this.breakpoints = {};
  this._breakpointConditions = {}; // clear stale conditions
  for (var i = 0; i < lines.length; i++) {
    this.breakpoints[lines[i]] = true;
  }
};

/**
 * Stop execution.
 */
DebugSession.prototype.stop = function() {
  this.state = 'finished';
  if (this.resume) {
    var r = this.resume;
    this.resume = null;
    r('__stop');
  }
};

/**
 * Step over — run until the next statement at the same or lower call depth.
 * Skips into function bodies.
 */
DebugSession.prototype.stepOver = function() {
  this._stepMode = 'over';
  this._stepDepth = this._callDepth;
  this.stepping = false;
  if (this.resume) {
    var r = this.resume;
    this.resume = null;
    r();
  }
};

/**
 * Step out — run until we return to the caller's level.
 */
DebugSession.prototype.stepOut = function() {
  this._stepMode = 'out';
  this._stepDepth = this._callDepth;
  this.stepping = false;
  if (this.resume) {
    var r = this.resume;
    this.resume = null;
    r();
  }
};

/**
 * Notify the session that a function call is about to happen.
 * Called by the runtime's journal-aware __call wrapper.
 */
DebugSession.prototype.pushCall = function() {
  this._callDepth++;
};

/**
 * Notify the session that a function call has returned.
 */
DebugSession.prototype.popCall = function() {
  this._callDepth--;
  if (this._callDepth < 0) this._callDepth = 0;
};

/**
 * Evaluate an expression in the current paused scope.
 * Returns the result of the expression.
 *
 * @param {string} expression - SafeScript expression to evaluate
 * @returns {*} The evaluation result
 */
DebugSession.prototype.evaluate = function(expression) {
  if (this.state !== 'paused') {
    throw new Error('SafeScript: can only evaluate while paused');
  }
  if (!this.currentLocals) {
    throw new Error('SafeScript: no locals available');
  }

  var locals = this.currentLocals;
  var localNames = Object.keys(locals);
  var localValues = localNames.map(function(n) { return locals[n]; });

  // Build a simple evaluator function with locals as parameters
  // and runtime helpers available
  var runtimeArgs = this._runtimeArgs;
  var helperNames = ['__at', '__set', '__call', '__call_opt', '__new', '__check'];
  var helperValues = [];
  if (runtimeArgs) {
    helperValues = [runtimeArgs[1], runtimeArgs[2], runtimeArgs[3], runtimeArgs[4], runtimeArgs[5], runtimeArgs[6]];
  } else {
    helperValues = [
      function(o,k){ return o && o[k]; },
      function(o,k,v){ if(o) o[k]=v; return v; },
      function(o,m){ return o[m].apply(o, Array.prototype.slice.call(arguments, 2)); },
      function(o,m){ return o && o[m] ? o[m].apply(o, Array.prototype.slice.call(arguments, 2)) : undefined; },
      function(){ throw new Error('new not available in evaluate'); },
      function(){}
    ];
  }

  var allNames = localNames.concat(helperNames);
  var allValues = localValues.concat(helperValues);

  // Compile the expression through SafeScript for safety
  var code;
  if (this._compileFn) {
    // If SafeScript compilation fails (blocked identifier, syntax error),
    // let the error propagate — don't bypass safety by falling back to raw eval
    var compiled = this._compileFn('return (' + expression + ');');
    code = compiled.code;
  } else {
    // No compiler available — evaluate raw (only for standalone DebugSession without SafeScript)
    code = 'return (' + expression + ');';
  }

  var fn = new Function(allNames.join(', '), '"use strict";\n' + code);
  return fn.apply(undefined, allValues);
};

/**
 * Set a conditional breakpoint.
 * The condition is a SafeScript expression evaluated when the breakpoint line is hit.
 * The breakpoint only pauses if the condition is truthy.
 *
 * @param {number} line - Line number
 * @param {string} [condition] - SafeScript expression. Omit or null for unconditional.
 */
DebugSession.prototype.setConditionalBreakpoint = function(line, condition) {
  this.breakpoints[line] = true;
  if (condition) {
    this._breakpointConditions[line] = condition;
  } else {
    delete this._breakpointConditions[line];
  }
};

/**
 * Check if a conditional breakpoint should pause.
 * Returns true if no condition or condition is truthy.
 */
DebugSession.prototype._checkCondition = function(line, getLocals) {
  var cond = this._breakpointConditions[line];
  if (!cond) return true; // unconditional
  try {
    // Save and temporarily set locals for evaluate
    var savedState = this.state;
    var savedLocals = this.currentLocals;
    this.state = 'paused';
    this.currentLocals = getLocals();
    var result = this.evaluate(cond);
    this.state = savedState;
    this.currentLocals = savedLocals;
    return !!result;
  } catch (e) {
    // Condition error → treat as unconditional (pause)
    return true;
  }
};

/**
 * Set a logpoint — like a breakpoint that logs instead of pausing.
 * The template string can contain {expr} segments that are evaluated
 * against the current locals (same as VS Code logpoints).
 *
 * @param {number} line - Line number
 * @param {string} template - Template string, e.g. 'x is {x}, total is {x + y}'
 */
DebugSession.prototype.setLogpoint = function(line, template) {
  this._logpoints[line] = template;
};

/**
 * Remove a logpoint.
 */
DebugSession.prototype.removeLogpoint = function(line) {
  delete this._logpoints[line];
};

/**
 * Evaluate a logpoint template against the current locals.
 * Replaces {expr} with the evaluated result of each expression.
 * Plain text passes through. Evaluation errors show as [error: msg].
 *
 * @param {string} template
 * @param {Function} getLocals
 * @returns {string} The interpolated message
 */
DebugSession.prototype._evaluateLogpoint = function(template, getLocals) {
  var self = this;
  var savedState = this.state;
  var savedLocals = this.currentLocals;

  // Temporarily set state so evaluate() works
  this.state = 'paused';
  this.currentLocals = getLocals();

  var message = template.replace(/\{([^}]+)\}/g, function(match, expr) {
    try {
      var val = self.evaluate(expr.trim());
      if (val === undefined) return 'undefined';
      if (val === null) return 'null';
      if (typeof val === 'object') {
        try { return JSON.stringify(val); }
        catch(e) { return String(val); }
      }
      return String(val);
    } catch(e) {
      return '[error: ' + e.message + ']';
    }
  });

  // Restore state
  this.state = savedState;
  this.currentLocals = savedLocals;
  return message;
};

/**
 * Fork the session — create an independent copy with the same state.
 * The fork has its own journal, history, breakpoints and locals,
 * so you can explore different code paths without losing the original.
 *
 * @returns {DebugSession} A new independent session at the same point
 */
DebugSession.prototype.fork = function() {
  var child = new DebugSession({
    captureAllLocals: this.captureAllLocals
  });

  // Copy breakpoints, conditions, logpoints
  for (var line in this.breakpoints) {
    child.breakpoints[line] = true;
  }
  for (var cl in this._breakpointConditions) {
    child._breakpointConditions[cl] = this._breakpointConditions[cl];
  }
  for (var lp in this._logpoints) {
    child._logpoints[lp] = this._logpoints[lp];
  }

  // Copy state
  child.state = this.state;
  child.stepping = this.stepping;
  child.currentLine = this.currentLine;
  child._callDepth = this._callDepth;

  // Deep-copy locals
  if (this.currentLocals) {
    child.currentLocals = JSON.parse(JSON.stringify(this.currentLocals));
  }

  // Deep-copy history (step records with locals snapshots)
  for (var i = 0; i < this.history.length; i++) {
    var step = this.history[i];
    var copy = { index: step.index, line: step.line, effects: step.effects };
    if (step.locals) {
      try { copy.locals = JSON.parse(JSON.stringify(step.locals)); }
      catch(e) { copy.locals = step.locals; }
    }
    child.history.push(copy);
  }

  // Copy journal entries (the journal is a value log, not object references in the fork)
  var entries = this.journal.entries();
  for (var j = 0; j < entries.length; j++) {
    var ent = entries[j];
    child.journal.write(ent.target, ent.key, ent.was, ent.to);
  }

  // Copy compile/runtime references so evaluate/editAndContinue work
  child._compileFn = this._compileFn;
  child._compileTailFn = this._compileTailFn;
  child._runtimeArgs = this._runtimeArgs;

  // Copy DOM root (shared — both sessions refer to the same DOM)
  child._domRoot = this._domRoot;

  // Copy DOM snapshots
  for (var s = 0; s < this._domSnapshots.length; s++) {
    child._domSnapshots.push({
      stepIndex: this._domSnapshots[s].stepIndex,
      html: this._domSnapshots[s].html,
      root: this._domSnapshots[s].root
    });
  }

  return child;
};

/**
 * Serialize the session state to a JSON-safe object.
 * Object references (journal targets) are replaced with numeric IDs.
 * Use DebugSession.deserialize() to restore.
 *
 * @returns {Object} Serializable session state
 */
DebugSession.prototype.serialize = function() {
  // Build object → ID map for journal targets
  var objectMap = new Map();
  var objectList = [];
  var entries = this.journal.entries();

  function getObjectId(obj) {
    if (objectMap.has(obj)) return objectMap.get(obj);
    var id = objectList.length;
    objectMap.set(obj, id);
    objectList.push(obj);
    return id;
  }

  // Serialize journal entries
  var journalData = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    journalData.push({
      targetId: getObjectId(e.target),
      key: e.key,
      was: e.was,
      to: e.to,
      step: e.step
    });
  }

  // Serialize history
  var historyData = [];
  for (var h = 0; h < this.history.length; h++) {
    var step = this.history[h];
    historyData.push({
      index: step.index,
      line: step.line,
      locals: step.locals || null,
      effects: step.effects || null
    });
  }

  // Serialize DOM snapshots (without root ref)
  var snapshotData = [];
  for (var s = 0; s < this._domSnapshots.length; s++) {
    snapshotData.push({
      stepIndex: this._domSnapshots[s].stepIndex,
      html: this._domSnapshots[s].html
    });
  }

  return {
    version: 1,
    state: this.state,
    stepping: this.stepping,
    currentLine: this.currentLine,
    currentLocals: this.currentLocals,
    callDepth: this._callDepth,
    breakpoints: Object.keys(this.breakpoints).map(Number),
    conditions: JSON.parse(JSON.stringify(this._breakpointConditions)),
    logpoints: JSON.parse(JSON.stringify(this._logpoints)),
    captureAllLocals: this.captureAllLocals,
    history: historyData,
    journal: journalData,
    domSnapshots: snapshotData,
    _objectCount: objectList.length
  };
};

/**
 * Restore a session from serialized data.
 * Object references are rebuilt — the caller must supply the original
 * target objects via the objectResolver function.
 *
 * @param {Object} data - From session.serialize()
 * @param {Function} [objectResolver] - function(id) → original object. If omitted, fresh objects are created.
 * @returns {DebugSession}
 */
DebugSession.deserialize = function(data, objectResolver) {
  var session = new DebugSession({
    captureAllLocals: data.captureAllLocals,
    breakpoints: data.breakpoints
  });

  // Restore conditions and logpoints
  if (data.conditions) {
    session._breakpointConditions = data.conditions;
  }
  if (data.logpoints) {
    session._logpoints = data.logpoints;
  }

  // Restore state
  session.state = data.state;
  session.stepping = data.stepping;
  session.currentLine = data.currentLine;
  session.currentLocals = data.currentLocals;
  session._callDepth = data.callDepth || 0;

  // Restore history
  session.history = data.history || [];

  // Restore journal entries
  if (data.journal && data.journal.length > 0) {
    // Build object table
    var objects = [];
    var count = data._objectCount || 0;
    for (var i = 0; i < count; i++) {
      objects[i] = objectResolver ? objectResolver(i) : {};
    }
    for (var j = 0; j < data.journal.length; j++) {
      var ent = data.journal[j];
      var target = objects[ent.targetId] || {};
      session.journal.setStepIndex(ent.step);
      session.journal.write(target, ent.key, ent.was, ent.to);
    }
  }

  // Restore DOM snapshots (without root — caller sets it)
  if (data.domSnapshots) {
    for (var s = 0; s < data.domSnapshots.length; s++) {
      session._domSnapshots.push({
        stepIndex: data.domSnapshots[s].stepIndex,
        html: data.domSnapshots[s].html,
        root: null
      });
    }
  }

  return session;
};

/**
 * Commit the journal — apply all writes to real state.
 * Returns a summary of what was committed.
 * The host's onCommit callback receives the external entries.
 */
DebugSession.prototype.commit = function() {
  // Snapshot DOM before commit (for undo/time travel)
  if (this._domRoot) {
    this.snapshotDOM();
  }
  var result = this.journal.commit();
  if (this.onCommit) {
    this.onCommit(result);
  }
  return result;
};

/**
 * Discard the journal — clear all writes without applying.
 */
DebugSession.prototype.discard = function() {
  this.journal.clear();
};

/**
 * Time travel: rewind to a specific step.
 * Rewinds the journal, restores locals from the nearest snapshot.
 */
DebugSession.prototype.rewindTo = function(stepIndex) {
  if (stepIndex < 0 || stepIndex >= this.history.length) return;

  // Rewind the journal to the corresponding log position
  // (the journal cursor tracks with the step history)
  this.journal.rewindTo(stepIndex);

  // Restore locals from the nearest step with a snapshot
  var step = this.history[stepIndex];
  for (var i = stepIndex; i >= 0; i--) {
    if (this.history[i].locals) {
      step = this.history[i];
      break;
    }
  }
  this.currentLocals = step.locals || null;
  this.currentLine = step.line;

  // Truncate history after the rewind point
  this.history.length = stepIndex;

  // Notify host
  this.onPause({
    line: step.line,
    locals: step.locals,
    effects: step.effects,
    rewound: true
  });
};

/**
 * Edit-and-continue: set a replacement function.
 * The next __dbg checkpoint will call this function with the current locals
 * and exit the original function.
 *
 * @param {Function} tailFn - Compiled tail function that takes (locals) as parameter
 */
DebugSession.prototype.setReplacement = function(tailFn) {
  this.replacement = tailFn;
};

/**
 * Edit-and-continue: compile new source and set as replacement.
 * Requires _compileTailFn and _runtimeArgs to be set (done by SafeScript.debug).
 *
 * @param {string} newSource - The edited SafeScript source
 * @returns {boolean} true if the edit was accepted, false on compile error
 */
DebugSession.prototype.editAndContinue = function(newSource) {
  if (this.state !== 'paused') {
    throw new Error('SafeScript: can only edit-and-continue while paused');
  }
  if (!this._compileTailFn) {
    throw new Error('SafeScript: compileTail not available — use SafeScript.debug() to create sessions');
  }

  var locals = this.currentLocals || {};
  var localNames = Object.keys(locals);
  var runtimeArgs = this._runtimeArgs;

  try {
    var tailFn = this._compileTailFn(newSource, this.currentLine, {
      debug: true,
      locals: localNames
    });

    // Wrap the tail function so it receives the runtime args
    // tailFn signature: (__locals, __scope, __at, __set, __call, __call_opt, __new, __check, __thisCell, __safeGlobals, __dbg)
    var self = this;
    this.replacement = function(capturedLocals) {
      return tailFn.apply(undefined, [capturedLocals].concat(runtimeArgs));
    };

    return true;
  } catch (e) {
    this.onError(e);
    return false;
  }
};

/**
 * Get the step history.
 */
DebugSession.prototype.getHistory = function() {
  return this.history;
};

// ── DOM Snapshots ─────────────────────────────────────────────────

/**
 * Set the DOM root element for snapshots.
 * Called by the runtime when DOM context is attached in debug mode.
 */
DebugSession.prototype.setDOMRoot = function(root) {
  this._domRoot = root;
};

/**
 * Take a DOM snapshot (innerHTML) at the current point.
 * Called automatically on commit, or manually for checkpoints.
 */
DebugSession.prototype.snapshotDOM = function() {
  if (!this._domRoot) return null;
  var snap = {
    stepIndex: this.history.length,
    html: this._domRoot.innerHTML,
    root: this._domRoot
  };
  this._domSnapshots.push(snap);
  return snap;
};

/**
 * Restore a DOM snapshot — sets innerHTML back to a captured state.
 *
 * @param {number} snapshotIndex - Index into _domSnapshots
 */
DebugSession.prototype.restoreDOM = function(snapshotIndex) {
  if (snapshotIndex < 0 || snapshotIndex >= this._domSnapshots.length) return;
  var snap = this._domSnapshots[snapshotIndex];
  if (snap.root) {
    snap.root.innerHTML = snap.html;
  }
};

/**
 * Find the nearest DOM snapshot at or before a given step index.
 *
 * @param {number} stepIndex
 * @returns {number} Snapshot index, or -1 if none
 */
DebugSession.prototype.findSnapshotBefore = function(stepIndex) {
  var best = -1;
  for (var i = 0; i < this._domSnapshots.length; i++) {
    if (this._domSnapshots[i].stepIndex <= stepIndex) {
      best = i;
    }
  }
  return best;
};

/**
 * Get all DOM snapshots.
 */
DebugSession.prototype.getDOMSnapshots = function() {
  return this._domSnapshots;
};

// ── Reverse Lookup: Element → Operations → Time Travel ────────────

/**
 * Query which journal entries affected a specific DOM node.
 * Returns log entries with step indices, so the UI can offer
 * "jump to the moment this element was changed."
 *
 * @param {Element} node - The native DOM node
 * @param {string} [prop] - Optional: filter to a specific property
 *   (e.g. 'textContent', 'attr:class', 'style:color')
 * @returns {Array} Journal entries, newest first, each with .step index
 */
DebugSession.prototype.queryNodeHistory = function(node, prop) {
  return this.journal.queryTarget(node, prop);
};

/**
 * Get the step indices where a specific node was modified.
 * These are the moments you can rewindTo for this element.
 *
 * @param {Element} node - The native DOM node
 * @param {string} [prop] - Optional property filter
 * @returns {Array<number>} Step indices, newest first
 */
DebugSession.prototype.queryNodeSteps = function(node, prop) {
  return this.journal.queryTargetSteps(node, prop);
};

/**
 * For a given DOM node, get a timeline of all changes.
 * Returns an array of { step, line, prop, was, to } records
 * suitable for rendering a "changes to this element" panel.
 *
 * @param {Element} node - The native DOM node
 * @returns {Array} Timeline entries, oldest first
 */
DebugSession.prototype.getNodeTimeline = function(node) {
  var entries = this.journal.queryTarget(node);
  var timeline = [];
  for (var i = entries.length - 1; i >= 0; i--) {
    var e = entries[i];
    var stepLine = (e.step >= 0 && e.step < this.history.length)
      ? this.history[e.step].line
      : null;
    timeline.push({
      step: e.step,
      line: stepLine,
      prop: e.key,
      was: e.was,
      to: e.to
    });
  }
  return timeline;
};

/**
 * Get current locals (only available when paused).
 */
DebugSession.prototype.getLocals = function() {
  return this.currentLocals;
};

/**
 * Create a __dbg checkpoint function bound to this session.
 *
 * The returned function is injected into the compiled code's scope.
 * It is called after every statement:
 *
 *   __r = await __dbg(LINE, function(){ return { var1: var1, ... }; });
 *   if (__r) return __r.value;
 */
DebugSession.prototype.createCheckpoint = function() {
  var session = this;

  return async function __dbg(line, getLocals) {
    if (session.state === 'finished') return null;

    // Drain the effect log into history
    var effects = session._effectLog.length > 0 ? session._effectLog.splice(0) : null;

    // Record this step
    var stepIdx = session.history.length;
    var step = {
      index: stepIdx,
      line: line,
      effects: effects
    };

    // Tell the journal which step we're on (so writes are tagged)
    session.journal.setStepIndex(stepIdx);

    // Check logpoints — fire before pause logic, never pauses
    if (session._logpoints[line]) {
      var logMessage = session._evaluateLogpoint(session._logpoints[line], getLocals);
      if (session.onLog) {
        session.onLog({ line: line, message: logMessage, step: stepIdx });
      }
    }

    // Determine if we should pause
    var shouldPause = false;
    if (session.stepping) {
      shouldPause = true;
    } else if (session._stepMode === 'over' && session._callDepth <= session._stepDepth) {
      shouldPause = true;
      session._stepMode = 'into';
    } else if (session._stepMode === 'out' && session._callDepth < session._stepDepth) {
      shouldPause = true;
      session._stepMode = 'into';
    } else if (session.breakpoints[line]) {
      // Check conditional breakpoint
      shouldPause = session._checkCondition(line, getLocals);
    }

    if (session.captureAllLocals || shouldPause) {
      step.locals = getLocals();
    }

    session.history.push(step);
    session.currentLine = line;

    // Notify host of step (lightweight, even during continue)
    session.onStep(step);

    // Should we pause?
    if (shouldPause) {
      session.state = 'paused';
      var locals = step.locals || getLocals();
      session.currentLocals = locals;
      step.locals = locals;

      session.onPause({ line: line, locals: locals, effects: effects });

      // Clean up one-shot breakpoint
      if (session._oneShotLine === line) {
        delete session.breakpoints[line];
        delete session._oneShotLine;
      }

      // Suspend until user acts
      var signal = await new Promise(function(resolve) {
        session.resume = resolve;
      });

      if (signal === '__stop') {
        session.state = 'finished';
        throw new Error('SafeScript: debug session stopped');
      }

      session.state = 'running';
    }

    // Check for edit-and-continue replacement
    if (session.replacement) {
      var fn = session.replacement;
      session.replacement = null;
      var fnLocals = session.currentLocals || getLocals();
      var result = await fn(fnLocals);
      return { value: result };
    }

    return null;
  };
};

exports.DebugSession = DebugSession;

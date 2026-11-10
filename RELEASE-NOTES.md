# SafeScript 2.0 Release Notes

SafeScript 2.0 turns a safe language into a development environment. The compiler, sandbox, and DOM facades from v1.x remain unchanged. What's new is a transactional runtime layered on top: every mutation goes through a journal, nothing changes until you commit, and a debug protocol lets any driver (IDE, Web Worker, remote tool) control execution from outside.

## What's New

### `new` Keyword (v1.4+)

`new` is now allowed with a constructor whitelist. Built-in safe types (`Map`, `Set`, `Date`, `RegExp`, `Error` family) are always available. Host-registered types and per-run `opts.allowNew` constructors also work. Unregistered constructors throw at runtime.

```js
var m = new Map();
m.set('key', 'value');

var d = new Date(2024, 0, 1);
var pattern = new RegExp('^test', 'i');

// Host-allowed
await SafeScript.run('return new Point(1, 2);', { Point }, { allowNew: [Point] });
```

### Return Value Sanitization (v1.4+)

`run()` now sanitizes return values to POD (plain old data). Functions are stripped from returned objects. Primitives, plain objects/arrays, and instances of safe built-in types pass through. Use `opts.rawReturn: true` to disable.

### Debug Mode (v2.0)

`SafeScript.debug(source, scope, opts)` compiles with checkpoint instrumentation (`__dbg` after every statement) and returns a `DebugSession`. The session pauses at the first statement and waits for commands. No browser DevTools needed — the debug UI can be anything.

```js
var session = SafeScript.debug(source, scope, {
  onPause: function(info) { renderUI(info.line, info.locals); },
  onFinish: function(value) { showResult(value); }
});

session.step();           // advance one statement
session.continue();       // run to next breakpoint or end
session.toggleBreakpoint(10); // set/clear breakpoint at line 10
session.stop();           // abort
```

### Journal — Transactional Execution (v2.0)

All side effects in debug mode go through a journal (write-ahead log with read overlay). Property writes on scope objects are recorded without mutating the real objects. Reads check the overlay first. `commit()` applies all writes. `discard()` throws them away.

This means you can run code that modifies data and DOM, inspect what would change, and decide whether to keep the changes — without touching real state until you're ready.

### Time Travel (v2.0)

Every debug step is recorded in history with line number, locals snapshot, and side effects. `rewindTo(stepIndex)` rolls the journal cursor back and restores locals from that point. Use `captureAllLocals: true` for full snapshots at every step.

### Edit-and-Continue (v2.0)

While paused, `session.editAndContinue(newSource)` recompiles the entire source in debug mode and creates a replacement function that receives current locals via destructuring. New variables in the edited code work naturally. Resume with `session.continue()` to run the new logic.

### Debug Protocol (v2.0)

A bidirectional messaging interface between the engine (DebugSession) and a driver (IDE/UI). Transport-agnostic — works over postMessage, MessagePort, WebSocket, or in-process function calls.

23 commands (driver → engine), 17 events (engine → driver). Three built-in transports: `InProcessDriver` (same thread), `PostMessageDriver` (Web Worker/iframe), `PortDriver` (MessagePort/SharedWorker).

### DOM Journal Integration (v2.0)

When using SafeScript's DOM membrane in debug mode, DOM mutations automatically route through the journal. Attribute writes, text content, style changes, and innerHTML all go through the overlay. Reads check the overlay first. On commit, changes apply to the real DOM. On discard, the DOM is untouched.

### DOM Snapshots + Reverse Lookup (v2.0)

`snapshotDOM()` captures the container's `innerHTML`. `restoreDOM(index)` puts it back. `commit()` auto-snapshots before applying, so you always have the pre-commit state for structural undo.

The reverse lookup is bidirectional: given any DOM element, `getNodeTimeline(element)` returns every change to it — what property changed, from what to what, and which debug step caused it. `queryNodeSteps(element)` returns the step indices, which are `rewindTo()` targets.

### Watch Expressions (v2.0)

`session.evaluate(expression)` evaluates any SafeScript expression in the current paused scope. Compiled through SafeScript for the same safety guarantees. Read-only — does not modify session state.

### Conditional Breakpoints (v2.0)

`session.setConditionalBreakpoint(line, condition)` breaks only when the condition expression evaluates to truthy. The condition is evaluated via `session.evaluate()` each time the breakpoint line is hit.

### Step Over / Step Out (v2.0)

`session.stepOver()` advances one statement without entering function bodies. `session.stepOut()` runs until returning to the caller's level. Both use call-depth tracking via `pushCall()` / `popCall()`.

### Fork (v2.0)

`session.fork()` creates an independent copy of the debug session — same breakpoints, history, locals, journal — for parallel exploration of different code paths.

### Serialize / Deserialize (v2.0)

`session.serialize()` exports the session state as a JSON-safe object (object references in the journal are replaced with numeric IDs). `DebugSession.deserialize(data, objectResolver)` restores it. Designed for persistence in Qbix Streams.

### Logpoints (v2.0)

`session.setLogpoint(line, template)` fires a message when a line is reached without pausing. Templates support `{expr}` interpolation against current locals (evaluated through SafeScript, not raw eval). Via the protocol: `setLogpoint` / `removeLogpoint` commands, `logpoint` event. Preserved across fork and serialize.

### Web Worker Transport (v2.0)

`SafeScript.runInWorker(self, source, scope, opts)` runs a debug session inside a Web Worker. `SafeScript.createWorkerProxy(worker, opts)` creates a `DebugProxy` on the main thread that mirrors the full DebugSession API.

## Security Posture

SafeScript's safety comes from static analysis and compile-time instrumentation, not from a runtime sandbox:

1. **Token/grammar allowlist** blocks dangerous constructs before they reach the AST
2. **Runtime property guards** (`__at`/`__set`) block prototype-chain access even with computed keys
3. **Global shadowing** ensures nothing outside the scope is reachable
4. **Execution guards** (`__check()`) enforce timeout and operation limits at loop heads and function entries
5. **Constructor whitelist** (`__new()`) prevents `new` on unregistered types
6. **Return sanitization** strips functions from output, preventing capability leaks
7. **DOM membrane** (v1.3+) scopes DOM access to a container element — scripts can't touch anything outside it

This means SafeScript code is safe to run on the main thread without a Web Worker sandbox, an iframe, or any browser sandbox. The only resource SafeScript code can exhaust is memory (by building large data structures within the operation limit), and even that is bounded by the operation counter. For additional isolation — to prevent a single script from blocking the main thread — run it in a Web Worker using the built-in transport.

## Breaking Changes

None. v2.0 is fully backward-compatible with v1.x. The `new` keyword was previously blocked; code that relied on `new` being a parse error will now parse successfully but fail at runtime if the constructor isn't whitelisted.

## Test Coverage

311 tests across 8 suites:

- `test.js` — core compiler + runtime (153 tests)
- `test-v1.4.js` — constructors, return sanitization (30 tests)
- `test-debug.js` — debug instrumentation, stepping, breakpoints (24 tests)
- `test-journal.js` — journal, time travel, commit/discard (23 tests)
- `test-edit-continue.js` — edit-and-continue, debug protocol (14 tests)
- `test-dom-journal.js` — DOM journal integration (15 tests)
- `test-dom-snapshots.js` — DOM snapshots, reverse lookup, element timeline (21 tests)
- `test-advanced-debug.js` — evaluate, conditional breakpoints, stepOver/Out, fork, serialize, logpoints (31 tests)

## What's Next

SafeScript is framework-agnostic. The debugging infrastructure (debug protocol, journal, time travel, edit-and-continue) is designed to be driven by any IDE or tool. [SafeStudio](https://github.com/Qbix/SafeStudio) is a Qbix plugin that provides the visual development environment on top of SafeScript 2.0 — code editor, DOM inspector, timeline, collaborative debugging via Qbix Streams.

# Changelog

## [2.0.0] — 2026-11-08

### Added
- **Debug instrumentation (Phase 1).** `SafeScript.compile(source, { debug: true })` emits `__dbg` checkpoint calls after every statement. Each checkpoint can pause execution (via `await`), inspect locals, and hand off to a replacement function (edit-and-continue).
- **`SafeScript.debug(source, scope, opts)`** — starts a debug session. Compiles in debug mode, runs, returns a `DebugSession` object for controlling execution.
- **`DebugSession` class** — controls a running debug execution:
  - `step()` — advance one statement
  - `continue()` — run until next breakpoint or end
  - `runToLine(line)` — run to a specific line (one-shot breakpoint)
  - `toggleBreakpoint(line)` / `setBreakpoints(lines)` — manage breakpoints
  - `stop()` — abort execution
  - `setReplacement(fn)` — edit-and-continue: set a replacement function that receives current locals
  - `getHistory()` — all step records (line numbers, effects)
  - `getLocals()` — current local variables (when paused)
- **`src/debug.js`** — new module: DebugSession class and `__dbg` checkpoint factory.
- **Debug-mode emitter** — `src/emit.js` gains `emitDebug()` which instruments all statement types with checkpoints. Locals closures are lazy (materialized only on pause). Line numbers extracted from AST node positions.
- **`opts.captureAllLocals`** — when true, captures locals at every step (not just pause points). For time-travel debugging.
- `test-debug.js`: 24 tests covering debug emission, stepping, breakpoints, locals inspection, history, control flow (if/else, for, while, try/catch), function declarations, scope method calls, stop, and edit-and-continue via replacement functions.

### Phase 2: Journal (write-ahead log with read overlay)
- **`src/journal.js`** — new module: `Journal` class with write, read (overlay), has, rewindTo, commit, clear, writeExternal, summary.
- **Journal-aware runtime guards** — in debug mode, `__set` writes to the journal instead of the real object, `__at` reads from the journal overlay first. `__call`/`__call_opt` log calls as side effects.
- **Original-object tracking** — the runtime builds a reverse map from sanitized scope copies to original objects, so journal commits apply to the real state.
- **`session.commit()`** — applies all journal writes to real objects, calls `onCommit` callback with externals.
- **`session.discard()`** — clears the journal, real state unchanged.
- **`session.rewindTo(stepIndex)`** — rewinds journal cursor, restores locals, truncates history, notifies host.
- **`SafeScript.Journal`** — exported for advanced use.
- `test-journal.js`: 23 tests covering journal unit tests, rewindTo/time-travel, debug-mode bracket write/read integration, commit/discard, side-effect logging, and onCommit callback.

### Phase 3: Edit-and-continue + pluggable debug protocol
- **`SafeScript.compileTail(source, fromLine, opts)`** — compiles the full edited source in debug mode, wrapping it in a function that takes captured locals as a parameter. Used for edit-and-continue: the user edits code while paused, the tail is recompiled, and execution resumes with the current locals.
- **`session.editAndContinue(newSource)`** — compiles the edited source via `compileTail`, wraps it with the current runtime args, and sets it as the replacement function. New variables in the edited code work naturally.
- **`src/debug-protocol.js`** — pluggable bidirectional debug protocol. Transport-agnostic: works over postMessage, WebSocket, MessagePort, or in-process function calls.
  - **`DebugProtocol`** — adapter that bridges a `DebugSession` to a driver transport. Wires session callbacks to protocol events, handles incoming commands.
  - **Commands** (driver → engine): step, continue, stop, setBreakpoints, toggleBreakpoint, runToLine, editAndContinue, rewindTo, commit, discard, getLocals, getHistory, getJournal.
  - **Events** (engine → driver): paused, stepped, finished, error, committed, discarded, rewound, locals, history, journal, editAccepted.
- **Built-in transports:**
  - **`InProcessDriver`** — direct function calls, same thread. Events via callback, commands via `.command(type, data)`.
  - **`PostMessageDriver`** — Web Worker / iframe postMessage with channel filtering. Includes `PostMessageDriver.sendCommand()` static helper for the UI side.
  - **`PortDriver`** — MessagePort (SharedWorker, BroadcastChannel).
- **`opts.driver`** on `SafeScript.debug()` — attaches a driver before execution starts, so the protocol receives all events from the first checkpoint.
- `test-edit-continue.js`: 14 tests covering compileTail, editAndContinue (with new variables, rejection on bad state/source), and the full protocol (InProcessDriver events, commands, getLocals, getHistory, setBreakpoints, getJournal, commit/discard, editAndContinue via protocol).

### Phase 4–5: DOM Journal Integration + Time Travel
- **`src/dom/dom-journal.js`** — new module: `attachDOMJournal(context, journal, effectLog)` adapter that intercepts all SafeHandle/SafeStyle mutations and routes them through the journal. Reads check the journal overlay first, then fall through to the real DOM.
- **DOM context wiring** — `createDOMContext()` now accepts an optional `debugSession` parameter. When present with a journal, attaches the DOM journal adapter automatically. Cleanup detaches the adapter.
- **Style facade journal hooks** — `SafeStyle` sub-facade now routes all property get/set, `setProperty`/`getPropertyValue`/`removeProperty`, and `cssText` through the journal when hooks are active. Style writes are keyed as `style:<prop>` in the journal.
- **Runtime integration** — `buildFunction()` passes the `debugSession` through to `createDOMContext()`, completing the chain from debug session → journal → DOM facades.
- **Attribute journal** — attributes keyed as `attr:<name>` in the journal overlay. `setAttribute`/`getAttribute`/`removeAttribute` check the overlay.
- **Tree mutation logging** — `appendChild`/`insertBefore` log side effects but still apply to the real DOM (structural changes are not reversible in the journal model).
- `test-dom-journal.js`: 15 tests covering adapter lifecycle, journal write/read routing, attribute overlay, style facade integration (property access, setProperty, cssText), commit, and discard.

### Phase 5: Web Worker Transport
- **`src/worker.js`** — new module: Web Worker transport for running debug sessions off the main thread.
  - **`runInWorker(self, source, scope, opts)`** — run a SafeScript debug session inside a Web Worker. Wires a PostMessageDriver to the worker's `self` for bidirectional communication.
  - **`createWorkerProxy(worker, opts)`** — creates a `DebugProxy` on the main thread that mirrors the DebugSession API. All calls are forwarded as postMessage commands.
  - **`DebugProxy`** — main-thread proxy with mirrored state (`state`, `currentLine`, `currentLocals`), updated from incoming events. Exposes `step()`, `continue()`, `stop()`, `setBreakpoints()`, `toggleBreakpoint()`, `runToLine()`, `editAndContinue()`, `rewindTo()`, `commit()`, `discard()`, `getLocals()`, `getHistory()`, `getJournal()`, `disconnect()`.
- **Exports**: `SafeScript.createWorkerProxy`, `SafeScript.runInWorker`, `SafeScript.DebugProxy` added to main entry.

### DOM Snapshots + Reverse Lookup
- **DOM snapshots** — `session.snapshotDOM()` captures `innerHTML` of the container root. `session.restoreDOM(index)` restores a previous state. Snapshots are taken automatically before each `commit()`, giving structural undo for free.
- **`session.findSnapshotBefore(stepIndex)`** — finds the nearest snapshot at or before a given step, for efficient rewind.
- **Reverse lookup: element → operations** — Given a specific DOM element, find every journal entry that touched it:
  - `session.queryNodeHistory(node, prop?)` — all journal entries for a node, newest first, each tagged with `.step` index
  - `session.queryNodeSteps(node, prop?)` — deduplicated step indices, for "jump to the moment this element changed"
  - `session.getNodeTimeline(node)` — oldest-first timeline of `{ step, line, prop, was, to }` records for a "changes to this element" panel
- **Step-indexed journal entries** — every journal write carries a `.step` field linking it to the debug step that caused it.
- **`journal.queryTarget(target, key?)`** / **`journal.queryTargetSteps(target, key?)`** — reverse lookup on the journal itself.
- **Protocol commands** — `getNodeTimeline`, `getDOMSnapshots`, `snapshotDOM`, `restoreDOM` added to debug protocol and DebugProxy.
- `test-dom-snapshots.js`: 21 tests.

### Advanced Debug Features
- **Watch expressions** — `session.evaluate(expr)` evaluates any SafeScript expression in the current paused scope. Compiled through SafeScript for safety. Read-only.
- **Conditional breakpoints** — `session.setConditionalBreakpoint(line, condition?)` breaks only when condition is truthy. Condition evaluated via `evaluate()` at each hit.
- **Step over / step out** — `session.stepOver()` skips function bodies; `session.stepOut()` runs to caller level. Call-depth tracking via `pushCall()`/`popCall()`.
- **Fork** — `session.fork()` clones the session into an independent copy with its own journal, history, locals, breakpoints. For parallel "what if" exploration.
- **Serialize / deserialize** — `session.serialize()` exports JSON-safe state; `DebugSession.deserialize(data, resolver)` restores it. Journal object references → numeric IDs. For Qbix Stream persistence.
- **Protocol** — 6 new commands (`stepOver`, `stepOut`, `evaluate`, `setConditionalBreakpoint`, `fork`, `serialize`) and 3 new events (`evaluated`, `forked`, `serialized`). Total: 23 commands, 17 events.
- `test-advanced-debug.js`: 24 tests.

## [1.4.0] — 2026-11-08

### Added
- **`new` keyword**: `new` is now allowed with a constructor whitelist. Built-in safe constructors (`Map`, `Set`, `Date`, `RegExp`, `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`) are always available. Host-registered types (via `SafeScript.lib()`) and host-allowed constructors (via `opts.allowNew: [Ctor]`) also work. Unregistered constructors throw at runtime.
- **`__new` runtime guard**: `new Constructor(args)` compiles to `__new(Constructor, [args])`, which checks the constructor against the whitelist before instantiation.
- **Safe globals**: `Map`, `Set`, `Date`, `RegExp` are now exposed in safe globals (previously shadowed) so `new` can reference them.
- **`SAFE_CTORS` expanded**: `Map`, `Set`, `Date`, `RegExp` instances can now have their methods called without type registration.
- **Return value sanitization**: `run()` now sanitizes return values to POD (plain old data). Functions are stripped, primitives and plain objects/arrays pass through, instances of safe built-in types (`Date`, `Map`, `Set`, `RegExp`, `Error` family) and registered types pass through. Use `opts.rawReturn: true` to disable.
- **`opts.allowNew`**: Array of constructors the host allows `new` to call, beyond the built-in safe list and the type registry.
- **`opts.rawReturn`**: When true, skips return value sanitization (returns raw value including functions).
- `test-v1.4.js`: 30 tests covering `new` keyword, constructor whitelist, return sanitization, and side effects.

### Changed
- `src/defs.js`: `new` moved from `BLOCKED_KW` to `ALLOWED_KW`.
- `src/parse.js`: Added `NewExpression` parsing in `_parseUnary()`.
- `src/emit.js`: Added `NewExpression` emitter → `__new(Constructor, [args])`.
- `src/runtime.js`: Added `__new()`, `sanitizeReturn()`, `SAFE_NEW_CTORS`. Updated `buildFunction()` to pass `__new` and sanitize return values.
- `browser.js`: `__new` wired through bundle automatically via runtime module.
- **Q.handle hardening** (from v1.3 patch): `safeQ.handle()` now rejects string handlers (sandbox escape via global function lookup). Only `Function`, `Q.Event`, and arrays of those are accepted. String handlers inside `Q.Event.handlers` arrays are also stripped.

## [1.3.0] — 2026-10-25

### Added
- **Type renames**: `SafeHandle` → `SafeHTMLElement`, `SafeDocument` → `SafeDOMDocument`. Legacy aliases removed from type registry and BUILTIN_TYPES (factory function aliases retained for migration).
- **`@uses` directive wiring**: `@uses document: SafeDOMDocument` now auto-injects the DOM membrane context into the SafeScript scope. The header parser resolves built-in types and the runtime activates the corresponding providers.
- `SafeScript.types` — built-in type name registry (`SafeDOMDocument`, `SafeHTMLElement`, `SafeWindow`, `SafeConsole`, `SafeObservers`, `SafeCanvas`, `SafeMedia`, `SafeNavigation`, and legacy aliases).
- `SafeScript.resolveUses(header)` — resolve `@uses` directives against built-in type registry. Returns provider flags: `dom`, `window`, `console`, `observers`, `canvas`, `media`, `navigation`.
- `header.resolveUses()` — maps `@uses` type names to built-in providers.
- `header.BUILTIN_TYPES` — registry of built-in type names and their providers.
- **6 new built-in types** for `@uses` directives:
  - `SafeWindow` — `window.innerWidth/Height`, `scrollY`, resize events, `matchMedia`, `getComputedStyle`, `open()`
  - `SafeConsole` — `console.log/warn/error`
  - `SafeObservers` — `IntersectionObserver`, `MutationObserver`, `ResizeObserver`
  - `SafeCanvas` — `canvas.getContext('2d')`, SVG manipulation
  - `SafeMedia` — `new Audio()`, `<video>`, `Blob`, `URL.createObjectURL`
  - `SafeNavigation` — `location.hash`, `history.pushState/replaceState`
- `load()` now returns `{ source, scope, header }` bundles so `run()` can use the parsed header.
- `run()` now parses the header and passes it to the runtime for `@uses` auto-injection.

### Changed
- `src/runtime.js`: `buildFunction()` checks `opts.header` for `@uses` directives and auto-activates DOM context when `SafeDOMDocument` is declared.
- `src/dom/safe-handle.js`: Added `createSafeHTMLElement` export alias.
- `src/dom/safe-document.js`: Added `createSafeDOMDocument` export alias.
- `src/dom/index.js`: Added type name exports (`SafeDOMDocument`, `SafeHTMLElement`).

## [1.2.0] — 2026-10-25

### Added
- **DOM safety layer** (`src/dom/`): Safe wrappers for browser DOM manipulation — `safe-handle.js`, `safe-document.js`, ownership tracking, element budgets, HTML sanitizer, URL policy, event bridge, identity cache, safe timers, and sub-facades for classList, collection, dataset, and style.
- `browser.js`: Bundle builder for browser environments.
- `test-browser.js`, `test-dom.js`: Test coverage for the DOM safety layer.

### Changed
- All core compiler files unchanged from v1.1.0.

## [1.1.0] — 2026-10-25

### Added
- **`allow` option**: Host-provided scope identifiers now pass through the compiler. `SafeScript.run()` auto-builds the allow list from `Object.keys(scope)`, so hosts no longer need to work around the BLOCKED list for capabilities they explicitly provide.
- **`ThisExpression` transform**: `this` expressions are now rewritten to `__safeThis` during AST transformation, enabling safe `this` usage in facades.

### Changed
- `src/parse.js`: Tokenizer checks `_allow` before blocking an identifier.
- `src/validate.js`: Validator checks `allow` map before blocking.
- `src/runtime.js`: `buildFunction()`, `sanitize()`, `__call`, `applyFacades` updated for allow support.
- `index.js`: `run()` builds allow map from `Object.keys(scope)`.
- `src/compile.js`: Passes `opts` through the full pipeline.

### Removed
- Removed standalone documentation files (`Environments.md`, `Examples.md`, `RATIONALES.md`, `Specification.md`) — content consolidated into README.
- Removed pre-built browser bundles (`safescript.js`, `safescript.min.js`, `_safescript-bundle.js`, `browser.js`) — will return in v1.2 with the DOM safety layer.
- Removed superseded test files (`test-battle.js`, `test-browser.js`, `test-compiler.js`, `test-guards-hooks.js`, `test-header.js`) — coverage consolidated into `test.js`, `test-type-header.js`, `test-type-registry.js`.

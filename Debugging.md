# SafeScript 2.0 — Debugging Guide

SafeScript 2.0 includes a complete debugging system built from its own instrumentation. No browser DevTools, no source maps, no `debugger` statements. The compiled output in debug mode inserts checkpoint calls (`__dbg`) after every statement. Each checkpoint can pause execution (via `await` on a Promise that doesn't resolve until the driver says so), inspect locals, and hand off to a replacement function for edit-and-continue.

## Architecture

SafeScript's debugger has three layers:

**Engine** — the `DebugSession` class. Manages execution state, journal, history, breakpoints, and step/continue/stop logic. One session per execution.

**Journal** — the transactional runtime. All side effects (property writes, DOM mutations) go through a write-ahead log with a read overlay. Nothing changes until `commit()`. Supports `rewindTo()` for time travel. Each write is tagged with the debug step that caused it.

**Protocol** — the bidirectional messaging interface. Translates between session method calls and serializable command/event messages. Transport-agnostic: works over postMessage, MessagePort, WebSocket, or in-process function calls.

A **driver** is whatever controls the session from outside — an IDE panel, a Web Worker proxy, a remote debugging client, a test harness. The protocol sends events to the driver and receives commands from it.

```
┌──────────────┐     protocol      ┌──────────────┐
│   Driver     │ ◄──── events ──── │  DebugSession │
│  (IDE/UI)    │ ──── commands ──► │  + Journal    │
└──────────────┘                   └──────────────┘
```

## Quick Start

### Basic Stepping

```js
var SafeScript = require('safescript');

var session = SafeScript.debug(
  'var x = 1;\nvar y = x + 1;\nreturn y;',
  {},
  {
    onPause: function(info) {
      console.log('Line ' + info.line + ':', JSON.stringify(info.locals));
    },
    onFinish: function(value) {
      console.log('Result:', value);
    }
  }
);

// Execution pauses at the first statement
session.step();  // → Line 1: {"x":1}
session.step();  // → Line 2: {"x":1,"y":2}
session.step();  // → Result: 2
```

### Breakpoints

```js
var session = SafeScript.debug(source, scope, {
  breakpoints: [5, 10, 15],  // initial breakpoints
  onPause: function(info) { /* ... */ }
});

session.continue();           // run to line 5
session.toggleBreakpoint(5);  // remove breakpoint at 5
session.toggleBreakpoint(8);  // add breakpoint at 8
session.continue();           // run to line 8

session.setBreakpoints([20]); // replace all breakpoints
session.runToLine(25);        // one-shot: run to line 25, then pause
```

### Inspecting State

```js
session.currentLine;    // line number where paused
session.currentLocals;  // { varName: value, ... }
session.state;          // 'running', 'paused', 'finished', 'stopped'
session.getHistory();   // array of step records
```

## The Journal

### Transactional Execution

In debug mode, scope object writes don't mutate real state:

```js
var data = { count: 0, items: [] };

var session = SafeScript.debug(
  'count = count + 1;\nitems.push("added");',
  data,
  { onPause: function() {} }
);

session.step();
session.step();

// data.count is still 0 — journal captured the writes
// data.items is still [] — push was logged as a side effect

session.commit();
// NOW data.count is 1 and data.items is ["added"]
```

### How It Works

The journal is a `Map<object, Map<key, value>>` overlay. When the runtime writes `obj.prop = val`, it calls `journal.write(obj, 'prop', oldVal, newVal)`, which stores the new value in the overlay without touching `obj`. When the runtime reads `obj.prop`, it calls `journal.read(obj, 'prop')`, which checks the overlay first and falls through to the real value if nothing was written.

The `_debugOriginals` reverse map handles the fact that scope objects are sanitized (deep-copied) before entering the sandbox. Writes against the sanitized copy are recorded against the original object, so `commit()` applies changes to the right place.

### Commit and Discard

```js
session.commit();    // apply all journal writes to real objects
session.discard();   // clear journal, real state unchanged
```

`commit()` auto-snapshots the DOM container before applying (if a DOM root is set), so you can always undo structural changes.

### Side Effects

Method calls on scope objects (like `items.push("added")`) are logged as external effects rather than journal writes, because they execute immediately on the real object. The journal can't prevent them. The debug session records them in history so the UI can show what happened, but `discard()` can't undo them.

To fully defer method calls, the host can wrap scope objects in proxies that record calls instead of executing them. SafeScript's DOM facades do this automatically.

## Time Travel

### Step History

Every step is recorded:

```js
var history = session.getHistory();
// → [
//   { index: 0, line: 1, effects: [...] },
//   { index: 1, line: 2, effects: [...] },
//   ...
// ]
```

With `captureAllLocals: true`, each step also captures a full locals snapshot.

### Rewind

```js
session.rewindTo(stepIndex);
```

This rolls the journal cursor back to `stepIndex`, discarding all writes after that point, and restores the locals from that step's snapshot. Execution can continue from there with `step()` or `continue()` — the new path may diverge from the original history.

### DOM Snapshots

`snapshotDOM()` captures the container's `innerHTML`. `restoreDOM(index)` puts it back.

```js
session.snapshotDOM();       // manual checkpoint
session.commit();            // auto-snapshots before applying

var idx = session.findSnapshotBefore(stepIndex);
session.restoreDOM(idx);     // structural rewind
```

## Edit-and-Continue

While paused, edit the source and resume:

```js
session.step();  // paused after "var x = 1;"

session.editAndContinue('var x = 1;\nvar y = x * 10;\nreturn y;');
session.continue();  // runs the new logic with current locals
```

### How It Works

`editAndContinue(newSource)` calls `compileTail()`, which recompiles the *entire* source in debug mode and wraps the result in an `AsyncFunction` that takes `__locals` (a destructured parameter with all current local variables) plus the runtime arguments (`__at`, `__set`, `__call`, etc.). The replacement function receives the current locals, so existing variables keep their values. New variables in the edited code work naturally because they're fresh declarations in the new function scope.

### Limitations

- Only available when paused
- The new source must be valid SafeScript
- Cannot change function signatures of already-defined functions (the replacement starts from the current pause point, not the beginning)

## Debug Protocol

### Commands and Events

**25 commands** (driver → engine):

| Command | Data | Effect |
|---------|------|--------|
| `step` | — | Advance one statement |
| `continue` | — | Run to next breakpoint or end |
| `stop` | — | Abort execution |
| `setBreakpoints` | `{ lines: [5, 10] }` | Replace all breakpoints |
| `toggleBreakpoint` | `{ line: 10 }` | Toggle one breakpoint |
| `runToLine` | `{ line: 25 }` | One-shot breakpoint |
| `editAndContinue` | `{ source: '...' }` | Recompile and resume |
| `rewindTo` | `{ stepIndex: 3 }` | Time travel |
| `commit` | — | Apply journal writes |
| `discard` | — | Clear journal |
| `getLocals` | — | Request current locals |
| `getHistory` | — | Request step history |
| `getJournal` | — | Request journal state |
| `getNodeTimeline` | `{ node, prop? }` | Request element change history |
| `getDOMSnapshots` | — | Request snapshot list |
| `snapshotDOM` | — | Take a snapshot now |
| `restoreDOM` | `{ snapshotIndex }` | Restore a snapshot |
| `stepOver` | — | Step over function bodies |
| `stepOut` | — | Run to caller level |
| `evaluate` | `{ expression }` | Evaluate expression in scope |
| `setConditionalBreakpoint` | `{ line, condition? }` | Conditional breakpoint |
| `fork` | — | Clone session |
| `serialize` | — | Export session state |
| `setLogpoint` | `{ line, template }` | Set logpoint (log without pausing) |
| `removeLogpoint` | `{ line }` | Remove a logpoint |

**18 events** (engine → driver):

| Event | Data | When |
|-------|------|------|
| `paused` | `{ line, locals }` | Execution paused |
| `stepped` | `{ line, step }` | Completed one step |
| `finished` | `{ value }` | Execution completed |
| `error` | `{ message }` | Runtime error |
| `committed` | `{ ... }` | Journal committed |
| `discarded` | `{}` | Journal discarded |
| `rewound` | `{ stepIndex, line, locals }` | Time travel completed |
| `locals` | `{ line, locals, state }` | Locals response |
| `history` | `{ history, length }` | History response |
| `journal` | `{ entries, externals }` | Journal response |
| `nodeTimeline` | `{ timeline, steps }` | Element history response |
| `domSnapshots` | `{ snapshots, count }` | Snapshot list response |
| `domSnapshot` | `{ stepIndex, index }` | Snapshot taken |
| `domRestored` | `{ snapshotIndex }` | Snapshot restored |
| `evaluated` | `{ expression, result?, error? }` | Expression result |
| `forked` | `{ state, line }` | Session cloned |
| `serialized` | `{ data }` | Session state exported |
| `logpoint` | `{ line, message, step }` | Logpoint fired |

### Watch Expressions

While paused, evaluate any SafeScript expression in the current scope:

```js
session.evaluate('x + y');            // arithmetic
session.evaluate('arr.filter(fn)');   // method calls on locals
session.evaluate('typeof obj');       // type checks
session.evaluate('obj.nested.val');   // property access
```

The expression is compiled through SafeScript (same safety guarantees), evaluated against the current locals and runtime helpers, and the result is returned. The session state is not modified — evaluate is read-only.

### Conditional Breakpoints

Break only when a condition is truthy:

```js
session.setConditionalBreakpoint(10, 'i === 50');
// Line 10 will only pause when i is 50

session.setConditionalBreakpoint(15);
// No condition — always pauses (same as toggleBreakpoint)

session.setConditionalBreakpoint(10, 'arr.length > 100');
// Replace the condition on an existing breakpoint
```

The condition is a SafeScript expression evaluated via `session.evaluate()` each time the breakpoint line is hit. If the condition throws, the breakpoint pauses (fail-open).

### Step Over / Step Out

```js
session.step();      // step into — one statement, enters function bodies
session.stepOver();  // step over — one statement, skips function bodies
session.stepOut();   // step out — runs until returning to the caller's level
```

Step over and step out work by tracking call depth. `pushCall()` / `popCall()` increment/decrement the depth counter at function entry/exit. `stepOver` pauses at the next checkpoint where call depth ≤ the depth when stepOver was issued. `stepOut` pauses where call depth < the depth when stepOut was issued.

### Fork

Clone the debug session into an independent copy:

```js
var child = session.fork();
```

The child gets its own copies of: breakpoints, conditions, history, journal entries, locals, DOM snapshots. It shares (by reference): the compile function, runtime args, and DOM root. This means:

- `child.step()` advances the child, parent stays put
- `child.evaluate('x')` uses the child's locals
- Modifying `child.breakpoints` doesn't affect the parent
- Both sessions refer to the same DOM root (for now — a DOM fork would need `cloneNode`)

Use fork to explore "what if" scenarios: fork, try different code, compare results. SafeStudio can use this for the Bret Victor branching experience.

### Serialize / Deserialize

Persist a debug session to JSON for storage (e.g. in a Qbix Stream):

```js
// Save
var data = session.serialize();
var json = JSON.stringify(data);
// Store json in a Qbix Stream, localStorage, or send over the wire

// Restore
var restored = DebugSession.deserialize(JSON.parse(json), function(objectId) {
  // The journal tracks writes against objects by reference.
  // On deserialize, the resolver maps numeric IDs back to the original objects.
  return originalObjects[objectId];
});
restored.setDOMRoot(document.getElementById('my-widget'));
```

The serialized data includes: state, line, locals, history (with locals snapshots), journal entries (with numeric target IDs), breakpoints, conditions, logpoints, DOM snapshots (HTML strings). Object references in the journal are replaced with numeric IDs — the `objectResolver` callback maps them back on deserialize.

### Logpoints

Logpoints fire a message when execution reaches a line, without pausing. Like `console.log` but controlled from the driver and removable at runtime. Templates support `{expr}` interpolation — each `{expr}` segment is evaluated through SafeScript against the current locals (safe, sandboxed).

```js
// Set logpoints
session.setLogpoint(5, 'x = {x}, y = {y}');      // interpolated
session.setLogpoint(12, 'entering loop');           // plain message

// Receive log output
session.onLog = function(info) {
  // info.line — source line number
  // info.message — interpolated message string
  // info.step — step index when the logpoint fired
  console.log('[line ' + info.line + '] ' + info.message);
};

// Remove
session.removeLogpoint(5);
```

Key properties:
- **Never pauses** — logpoints fire before the breakpoint/step logic, so they don't interfere with debugging flow.
- **Safe evaluation** — `{expr}` segments compile through SafeScript, not raw `eval`. Blocked identifiers stay blocked.
- **Error-tolerant** — if an `{expr}` fails to evaluate, the segment is replaced with an error message; the rest of the template still renders.
- **Preserved across fork/serialize** — `fork()` copies logpoints to the child session; `serialize()` / `deserialize()` round-trip them.

Via the protocol: `setLogpoint` command (data: `{ line, template }`), `removeLogpoint` command (data: `{ line }`), `logpoint` event (data: `{ line, message, step }`).

### Built-in Transports

**InProcessDriver** — same-thread debugging. Simplest setup.

```js
var driver = new SafeScript.InProcessDriver(function(event) {
  // event = { type: 'paused', data: { line: 1, locals: {...} } }
  renderDebugUI(event);
});

var session = SafeScript.debug(source, scope, { driver: driver, onPause: function() {} });

driver.command('step');
driver.command('setBreakpoints', { lines: [5, 10] });
```

**PostMessageDriver** — Web Worker or iframe.

```js
// Main thread
var driver = new SafeScript.PostMessageDriver(worker, 'my-session');
driver.onMessage(function(event) { renderDebugUI(event); });
driver.command('step');

// Worker
var driver = new SafeScript.PostMessageDriver(self, 'my-session');
SafeScript.debug(source, scope, { driver: driver, onPause: function() {} });
```

**PortDriver** — MessagePort (SharedWorker, BroadcastChannel).

```js
var channel = new MessageChannel();
var driver = new SafeScript.PortDriver(channel.port1);
// pass channel.port2 to the other side
```

### Custom Transports

A transport is any object with:

- `send(event)` — called by the protocol to deliver events
- `onMessage(callback)` — registers a handler for incoming commands

```js
// Example: WebSocket transport
var wsTransport = {
  send: function(event) { ws.send(JSON.stringify(event)); },
  onMessage: function(cb) { ws.on('message', function(data) { cb(JSON.parse(data)); }); }
};

var protocol = new SafeScript.DebugProtocol(session, wsTransport);
```

## Reverse Lookup: Element → Code

Given any DOM element in the container, find every operation that changed it and jump to the exact moment:

```js
// Full timeline — oldest first
var timeline = session.getNodeTimeline(element);
// → [
//   { step: 0, line: 5,  prop: 'textContent', was: '',   to: 'Hello' },
//   { step: 3, line: 12, prop: 'attr:class',  was: null, to: 'active' },
//   { step: 7, line: 18, prop: 'style:color', was: '',   to: 'red' }
// ]

// Step indices only — newest first (these are rewindTo targets)
var steps = session.queryNodeSteps(element);
// → [7, 3, 0]

// Filter by property
var styleSteps = session.queryNodeSteps(element, 'style:color');
// → [7]

// Jump to when the class was set
session.rewindTo(3);
```

### Journal Key Conventions

| Mutation | Journal Key | Example |
|----------|------------|---------|
| `textContent = ...` | `textContent` | `textContent` |
| `innerHTML = ...` | `innerHTML` | `innerHTML` |
| `setAttribute(name, ...)` | `attr:<name>` | `attr:class` |
| `style.<prop> = ...` | `style:<prop>` | `style:color` |
| `style.setProperty(...)` | `style:<prop>` | `style:fontSize` |
| `style.cssText = ...` | `style:cssText` | `style:cssText` |

## Web Worker Transport

Run the debug session off the main thread:

```js
// Main thread
var worker = new Worker('debug-worker.js');
var proxy = SafeScript.createWorkerProxy(worker, {
  channel: 'session-1',
  onEvent: function(event) {
    if (event.type === 'paused') {
      renderDebugUI(event.data.line, event.data.locals);
    }
  }
});

proxy.step();
proxy.setBreakpoints([5, 10]);
proxy.editAndContinue(newSource);
proxy.commit();
proxy.getNodeTimeline(element);

// debug-worker.js
importScripts('safescript.min.js');
SafeScript.runInWorker(self, source, scope, { channel: 'session-1' });
```

The `DebugProxy` mirrors the full `DebugSession` API. State (`state`, `currentLine`, `currentLocals`) is updated from incoming events.

## Real-World Example: DOM Container with SafeScript.load()

A complete example of loading a `.safe` file, scoping it to a DOM container, and running it — safely, with no ability to touch anything outside the container.

```html
<div id="my-widget">
  <h2>Widget Title</h2>
  <p class="content">Loading...</p>
</div>

<script src="safescript.min.js"></script>
<script>
// The .safe source (could come from a file, a database, user input, etc.)
var safeSource = [
  '/**',
  ' * @safescript 0.2',
  ' * @needs container: Element',
  ' */',
  'var p = container.querySelector(".content");',
  'p.textContent = "Hello from SafeScript!";',
  'p.style.color = "green";',
  'container.querySelector("h2").setAttribute("data-ready", "true");',
  'return { status: "ok" };'
].join('\n');

// Load and run — the SafeScript can only touch #my-widget and its children
var el = document.getElementById('my-widget');

SafeScript.run(safeSource, {}, {
  dom: {
    root: el,            // container element — scripts can't escape this
    policy: {
      tags: ['div', 'p', 'span', 'h1', 'h2', 'h3', 'a', 'img', 'ul', 'li'],
      attrs: ['class', 'id', 'href', 'src', 'alt', 'data-*'],
      styles: null       // null = all safe CSS properties allowed
    }
  }
}).then(function(result) {
  console.log('Widget initialized:', result);
});
</script>
```

The DOM membrane ensures:

- Scripts can only see and modify elements inside `root`
- `document.querySelector` is scoped to the container
- `createElement` creates elements owned by the container
- `appendChild` only works within the container tree
- Attributes, styles, and text content are all mediated through SafeHandle facades
- In debug mode, all these mutations go through the journal instead of the real DOM

### With Qbix Q.Safebox and Q.Proxy

For production use on a Qbix-powered site, [Q.js](https://github.com/Qbix/Q.js) provides `Q.Safebox` (iframe sandbox) and `Q.Proxy` (postMessage-based cross-context proxy) for additional isolation:

```js
// Q.Safebox creates an iframe sandbox with Q.Proxy bridging
Q.Safebox.run(safeSource, {
  container: document.getElementById('my-widget'),
  capabilities: { db: Q.Proxy.wrap(myDb) },
  debug: true  // enables SafeScript 2.0 debug mode
}).then(function(result) {
  // result.session is the DebugSession if debug: true
  // result.value is the return value
});
```

However, Q.Safebox is optional. SafeScript's security comes from static analysis and compile-time instrumentation, not from a runtime sandbox. The four security barriers (token allowlist, runtime guards, global shadowing, execution guards) plus the constructor whitelist and return sanitization mean that SafeScript code cannot:

- Access any global or prototype chain
- Call `eval`, `Function`, or any blocked identifier
- Construct arbitrary types
- Return functions (capabilities are stripped)
- Read or write DOM outside its container (when using the DOM membrane)
- Run forever (operation limit + timeout)

The only resource a SafeScript can exhaust is memory — by building large data structures within the operation limit. For most use cases this is bounded by the operation counter (you can't allocate much in 100M ops). For untrusted code from the internet, running in a Web Worker via the built-in transport adds memory isolation without any code changes to the `.safe` file.

## Debug Mode + DOM: The Full Picture

When you combine debug mode with DOM facades, you get:

1. **Step through DOM-manipulating code** — see what each line changes without changing the page
2. **Inspect the virtual DOM state** — read the journal overlay to see what the page would look like
3. **Time travel** — rewind to any step, see the page as it was at that point
4. **Edit and continue** — change the code while paused, resume with new logic
5. **Reverse lookup** — click any element, see what changed it, jump to that moment
6. **Fork** — snapshot the state, try different code paths, compare results
7. **Commit or discard** — apply the changes to the real DOM, or throw them away
8. **Collaborate** — the debug protocol works over any transport, so multiple people can watch and control the same session

This is the foundation for visual development environments like SafeStudio, where an AI can modify logic in English while you watch the DOM update in real time.

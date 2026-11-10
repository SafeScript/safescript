# SafeScript

**JSON for code.** A safe computational subset of JavaScript — with built-in debugging, time travel, and edit-and-continue.

JSON gave the world a safe way to exchange data. SafeScript does the same for computation. It's a strict subset of JavaScript — no `eval`, no globals, no prototype access — that compiles to plain JS and PHP. Open a `.safe` file and you see code that's safe to run. The compiler is ~48 KB minified (~12 KB gzipped). Ship it anywhere, verify locally, no trust needed.

**v2.0** adds a transactional runtime: every mutation goes through a journal (write-ahead log with read overlay), so nothing changes until you commit. Debug mode instruments every statement with checkpoints — step through code, inspect locals, rewind to any point, edit the code while paused and continue with new logic. All of this runs inside the host application's own UI, with no browser DevTools required.

## Use Cases

SafeScript starts small, the same way JSON did. Anywhere you need a safe handler for data or events:

- **Webserver handlers** — route logic, request transforms, validation rules submitted by users or tenants
- **onclick and event handlers** — user-authored browser event handlers that can't escape their sandbox
- **Plugin scripts** — extend an app with user-submitted logic without risking the host
- **Formulas and expressions** — spreadsheet-style computed fields, pricing rules, scoring functions
- **Bot and agent tools** — callable tools for AI agents that are safe by construction (see [Safebots](https://github.com/Safebots))
- **Config with logic** — when JSON isn't enough but arbitrary JS is too much

## Quick Start

```js
// Node.js
const SafeScript = require('safescript');

const result = await SafeScript.run('return x + y;', { x: 10, y: 20 });
// → 30

// Safe globals are available by default — no injection needed
await SafeScript.run('return Math.floor(3.7);');     // → 3
await SafeScript.run('return JSON.parse("{}");');     // → {} (null-prototype, __proto__ stripped)
await SafeScript.run('return Object.keys({a:1});');   // → ['a']

// Constructors — safe built-in types are allowed
await SafeScript.run('return new Date(2020, 0, 1);');     // → Date instance
await SafeScript.run('var m = new Map(); m.set("a", 1); return m;');  // → Map

// Math.random is deterministic by default (mulberry32 PRNG, seed 0)
await SafeScript.run('return Math.random();');  // → same value every time
```

```html
<!-- Browser -->
<script src="safescript.min.js"></script>
<script>
  SafeScript.run('return n * 2;', { n: 21 }).then(function(result) {
    // → 42
  });
</script>
```

## The `.safe` File Format

SafeScript files use the `.safe` extension and `application/safescript` MIME type. A `.safe` file is self-contained — it declares what capabilities it needs at the top, and the host provides them.

```js
/**
 * @safescript 0.2
 * @needs request: Request
 * @needs db: Database
 * @uses logger: Logger
 * @env browser, node
 */
var body = request.json();
if (logger) logger.log('received', body);
return db.store(body);
```

The header is an optional `/** */` block comment with five directives:

- `@safescript <version>` — language version
- `@needs <name>: <Type>` — required capability; the host must provide it or refuse to run the file
- `@uses <name>: <Type>` — optional capability; the host provides it if available, the script checks with `if (name)`
- `@type <TypeName> { method1, method2 }` — declares a return type and the methods the script intends to call on it
- `@env <env1>, <env2>` — constrains which environments can run this file (optional, comma-separated)

### Type Declarations

`@type` declarations tell the host which methods on return types the script intends to call. They're purely declarative — they don't change runtime enforcement, but they enable pre-flight validation at `load()` time.

```js
/**
 * @safescript 0.2
 * @needs fetch: function
 * @needs log: function
 * @type Response { json, text, status }
 * @type Stream { get, set, fields }
 */
var resp = fetch('/api/data');
var data = resp.json();
log(data);
```

When `load()` processes this header, it checks:
1. Every `@type` name is registered with the host (via `SafeScript.lib()`)
2. Every declared method is in the host's `allowMethods` whitelist

This catches mismatches early — before the script runs — rather than failing at the first method call. If a script declares `@type Response { json, text, status }` but the host only allows `json` and `text`, `load()` throws immediately.

### The `.safe` File as a Trust Unit

A `.safe` file is a unit of trust — one set of declarations, one sandbox boundary. Everything about its security posture is visible in a single file:

- **What it needs** (`@needs`) — the injected capabilities
- **What it optionally uses** (`@uses`) — degradable capabilities
- **What return types it touches** (`@type`) — methods on host-provided objects
- **What environment it expects** (`@env`) — runtime constraints

If you want two functions with different access patterns, you put them in two `.safe` files. Each file gets its own scope, its own type declarations, and its own sandbox. The file IS the security boundary.

This is by design. SafeScript protects the **host's** environment — it ensures that user-submitted code can only call what the host explicitly allows. User protection (ensuring the host acts in the user's interest) comes from a different layer entirely — attestations about the host, not constraints in SafeScript. See [Safebots layers](https://safebots.ai/layers.html) for how these layers compose.

### Self-Contained by Design

A `.safe` file declares what it needs. It doesn't import, require, or fetch anything. The host reads the declarations and builds the scope — where the host gets the implementations is its business. A Node host might resolve them from `node_modules`. A browser host might use an import map or a CDN. A sandboxed environment might draw from a curated whitelist. The `.safe` file doesn't know or care.

This is a deliberate departure from `require()` and `import`. Package managers are an implementation detail of a particular host, not a top-level concept in the language. A `.safe` file that depends on npm to function is not truly portable. A `.safe` file that declares `@needs fetch: http.Fetch` works everywhere a host can provide an HTTP client.

This also avoids inheriting the supply chain attack surface of package managers. SafeScript's security story starts at the file boundary — you read the header, you see what the code can touch, you decide whether to run it.

### Host Workflow

```js
const SafeScript = require('safescript');

// 1. Parse the header
const caps = SafeScript.capabilities(source);
// → { version: '0.2', env: ['browser', 'node'],
//     needs: [{name: 'request', type: 'Request'}, ...],
//     uses: [{name: 'logger', type: 'Logger'}] }

// 2. Check that you can satisfy the requirements
const check = SafeScript.checkScope(source, myScope);
if (!check.ok) throw new Error('Missing: ' + check.missing.join(', '));

// 3. Run with the scope you built
const result = await SafeScript.run(source, myScope);
```

## How It Works

Four security barriers, defense in depth:

1. **Token/grammar allowlist** — The parser accepts only a subset of JavaScript. No `eval`, `delete`, `class`, `import`, `async`, `await`, template literals, or access to `globalThis`/`window`/`document`. `new` is allowed but restricted to a constructor whitelist. The AST is reconstructed from scratch — the original source text never appears in the output.

2. **Runtime property guards** — Bracket access (`obj[key]`) is rewritten to `__at(obj, key)` / `__set(obj, key, val)`, which block prototype-chain properties (`constructor`, `__proto__`, `prototype`, `caller`, `callee`) at runtime, even when keys are computed dynamically.

3. **Global shadowing + safe globals** — Every native global is declared as `undefined` inside the compiled function, then a curated set of safe globals is injected automatically: frozen facade objects for `Math`, `JSON`, `Object`, `Array`, `String`, `Number`, error constructors, and standalone functions like `parseInt` and `encodeURI`. These facades expose only safe static methods — never raw constructors or mutable prototypes. Additional capabilities are injected via the scope object. Code always runs in `"use strict"`.

4. **Execution guards + hooks** — Compile-time injected `__check()` calls enforce timeout and operation limits (hardcoded ceilings: 60s, 100M ops), preventing infinite loops and infinite recursion. Hooks intercept every call to injected scope functions, letting the host throttle resources at the boundary.

With an empty scope, SafeScript is pure computation with safe globals — deterministic math, JSON handling, type checking — but no I/O, no side effects, no access to anything outside the function. Additional capabilities are injected via the scope object using an object-capability model.

## Execution Model

A `.safe` file is a function body. The compiler wraps it in a function, the host calls that function with a scope, and the code uses `return` to hand a value back. `run()` always returns a Promise.

Return values are sanitized to **POD** (plain old data): primitives, plain objects, arrays, and instances of safe built-in types (`Date`, `Map`, `Set`, `RegExp`, `Error` family) and registered types pass through. Functions are stripped — a SafeScript returns data, not behavior.

```js
// Return a computed value
await SafeScript.run('return price * qty;', { price: 9.99, qty: 3 });  // → 29.97

// Return a data structure
await SafeScript.run('return { name: "test", items: [1, 2, 3] };', {});
// → { name: "test", items: [1, 2, 3] }

// Functions in returned objects are stripped
await SafeScript.run('return { val: 42, fn: function() {} };', {});
// → { val: 42 }  (fn is stripped)

// Return built-in instances
await SafeScript.run('return new Date(2020, 0, 1);', {});  // → Date instance
await SafeScript.run('var m = new Map(); m.set("k", 1); return m;', {});  // → Map instance

// Side-effect only (write to an injected capability, no return needed)
await SafeScript.run('db.store(record);', { db: myDb, record: data });

// Q.Tool.define pattern — behavior is registered as a side effect
await SafeScript.run('Q.Tool.define("my-tool", { init: function() { ... } });', { Q: Q });
```

There is no `export`, no `module.exports`, and no implicit last-expression return. `return` makes intent explicit and keeps `.safe` files readable. Use `opts.rawReturn: true` to disable sanitization for internal/trusted use.

### Auto-Async

SafeScript uses an **auto-async execution model**. The compiler automatically:

- Emits every function (declarations, expressions, arrows, method shorthands) as `async`
- Wraps every function call with `await`

This means `async` and `await` are **not** keywords in SafeScript — they are blocked. The compiler handles them transparently. This has two important consequences:

1. **Promises resolve automatically.** When injected objects return Promises, they're awaited at every call site. No unresolved Promises can leak through.
2. **Sequential execution is guaranteed.** There are no concurrent in-flight operations inside a single SafeScript execution. Throughput comes from running many SafeScript instances in parallel (like PHP-FPM workers), not from concurrency within one.
3. **Transparent cross-context proxying.** Because every external call is awaited, SafeScript code can run in a WebWorker while the scope objects proxy calls to the main thread via `postMessage`. The SafeScript source doesn't change — it was already written as synchronous-looking code, and the compiler already awaits every call. This means a host like Q.Safebox can move untrusted script execution off the main thread with zero code changes to the `.safe` files.

```js
// Same SafeScript source works identically whether scope is local or proxied:
var el = createElement("div")    // <- auto-awaited, works if createElement
setText(el, "Hello")             //    returns a value OR a Promise
appendTo(el, container)          //    (e.g. from a MessageChannel proxy)
return getText(el)
```

### Execution Guards

SafeScript protects against infinite loops, infinite recursion, and runaway computation with compile-time guard injection.

The compiler injects a `__check()` call at the **top of every function body** and the **start of every loop iteration** (all 5 loop types: `for`, `for-in`, `for-of`, `while`, `do-while`). At runtime, `__check()` verifies that the operation count and wall-clock deadline haven't been exceeded. If either limit is hit, execution throws immediately — no waiting for a Promise to time out.

```js
// Abort after 5 seconds
var result = await SafeScript.run(source, scope, { timeout: 5000 });

// Limit total operations (loop iterations + function entries)
var result = await SafeScript.run(source, scope, { maxOps: 10000 });

// Both
var result = await SafeScript.run(source, scope, { timeout: 5000, maxOps: 50000 });
```

**Hardcoded ceilings.** Even if the host omits `timeout` or passes `0`, a ceiling of **60 seconds** (`MAX_TIMEOUT = 60000`) is always enforced. Similarly, `maxOps` is capped at **100 million** (`MAX_OPS = 100000000`). These ceilings cannot be raised — they protect against misconfigured hosts.

`Promise.race` remains as a secondary defense for slow async injected methods, but the primary protection is the `__check()` guards in the compiled code itself.

### Hooks

Hooks let the host intercept every call to injected scope functions. This is how you throttle resource usage — data size limits, call counts, rate limiting, cost caps — at the boundary where SafeScript meets external resources.

```js
var result = await SafeScript.run(source, scope, {
  hooks: {
    beforeCall: function(info) {
      // info = { name, args, callCount, elapsed }
      // name is dotted path: "db.query", "api.users.list"

      // Block specific functions
      if (info.name === 'db.drop') return false;

      // Enforce call count limits
      if (info.callCount > 100) throw new Error('too many calls');

      // Short-circuit with cached/default value
      if (info.name === 'fetch' && rateLimited) return { value: null };

      // Transform arguments
      if (info.name === 'db.query') return { args: [sanitizeSQL(info.args[0])] };

      // Return undefined to proceed normally
    },
    afterCall: function(info) {
      // info = { name, args, result, callCount, elapsed }

      // Check response size
      if (JSON.stringify(info.result).length > 1000000) {
        throw new Error('response too large');
      }

      // Transform result
      return { value: redact(info.result) };
    }
  }
});
```

**`beforeCall(info)`** — called before each scope function invocation. Returns:
- `undefined` — proceed normally
- `false` — suppress the call (returns `undefined` to the script)
- `{ value: x }` — short-circuit, return `x` without calling (including `null` for graceful degradation)
- `{ args: [...] }` — transform arguments, then call
- throw — kill execution

**`afterCall(info)`** — called after each scope function returns. Same return protocol plus access to `info.result`.

Hooks wrap functions **recursively** through nested scope objects. If you inject `{ db: { query: fn, insert: fn } }`, hooks see `"db.query"` and `"db.insert"` as the name.

## Host-Level Composition

SafeScript files don't import each other. Composition happens at the host level — run one SafeScript to produce utilities, then inject the result into another:

```js
// Build a utility library
var utils = await SafeScript.run(utilsSource, { Math });

// Inject it into a handler
var result = await SafeScript.run(handlerSource, { utils, db, request });
```

This keeps each `.safe` file self-contained while allowing the host to compose them freely. The host controls the dependency graph, not the scripts.

## Safe Globals

SafeScript provides a set of frozen facade objects available in every execution — no injection needed. These are safe subsets of their JavaScript counterparts: only static methods, no constructors, no mutable prototypes.

| Global | What's available |
|--------|-----------------|
| `Object` | `keys`, `values`, `entries`, `assign`, `freeze`, `isFrozen`, `getOwnPropertyNames`, `create` (null only) |
| `Array` | `isArray`, `from`, `of` |
| `String` | `fromCharCode`, `fromCodePoint` |
| `Number` | `isInteger`, `isFinite`, `isNaN`, `parseInt`, `parseFloat`, `MAX_SAFE_INTEGER`, `MIN_SAFE_INTEGER`, `EPSILON`, `MAX_VALUE`, `MIN_VALUE`, `POSITIVE_INFINITY`, `NEGATIVE_INFINITY`, `NaN` |
| `Math` | All standard methods. `Math.random` is deterministic by default (see below). |
| `JSON` | `parse` (sanitized — output uses null-prototype objects, `__proto__` keys stripped), `stringify` |
| `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError` | Constructors (usable with `throw`) |
| Standalone | `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`, `decodeURI`, `encodeURIComponent`, `decodeURIComponent` |
| Constants | `NaN`, `Infinity` |

All facade objects are deeply frozen. Attempts to modify them (e.g. `Math.PI = 3`) silently fail in strict mode. `Object.create` is restricted to `Object.create(null)` — passing any other argument throws.

### JSON.parse Sanitization

`JSON.parse` output is deep-walked to convert all objects to null-prototype objects and strip any `__proto__` keys. This prevents prototype pollution attacks through parsed JSON data.

## Deterministic RNG

`Math.random` uses a mulberry32 PRNG seeded per invocation. By default, the seed is `0`, so every call to `run()` produces the same sequence of random numbers. This makes SafeScript executions fully reproducible.

```js
// Deterministic — same result every time
await SafeScript.run('return Math.random();');  // → always 0.2267...

// Custom seed
await SafeScript.run('return Math.random();', {}, { seed: 42 });  // → always 0.0020...

// True randomness (requires host approval)
await SafeScript.run('return Math.random();', {}, {
  seed: null,
  env: { Random: true }
});
```

The `seed` option controls behavior:

| `seed` value | Behavior |
|---|---|
| omitted / `undefined` | Deterministic, seed = 0 |
| any integer | Deterministic, that seed |
| `null` | True `Math.random` — requires `env: { Random: true }` |

Setting `seed: null` without `env: { Random: true }` throws: `SafeScript: seed: null requires env: { Random: true } (nondeterministic RNG needs host approval)`. This ensures nondeterminism is always an explicit host decision.

## Library Registration

Hosts can register named libraries that `load()` auto-resolves for `@needs` and `@uses` declarations. This avoids repeating resolver logic for common capabilities.

```js
// Register libraries once at startup
SafeScript.lib('http', myHttpClient);
SafeScript.lib('db', myDbAdapter);

// Scripts that @needs http or @needs db get them automatically
var bundle = await SafeScript.load(source);  // no resolver needed
await SafeScript.run(bundle);

// Resolver scope takes precedence over registered libs
var bundle = await SafeScript.load(source, function(caps) {
  return { http: customHttpClient };  // overrides registered 'http'
});

// Manage registrations
SafeScript.libs();       // → ['http', 'db']
SafeScript.unlib('db');  // unregister
```

Unregistered `@needs` still throw `Missing capabilities` if no resolver provides them.

## Type Registry

When host functions return objects, those objects carry methods. Without registration, SafeScript blocks all method calls on unknown types — a sandbox violation. The type registry lets the host declare exactly which methods are safe to call.

```js
// Register a type with its allowed methods
SafeScript.lib(Counter, { allowMethods: ['value', 'increment', 'toString'] });

// Now SafeScript code can call those methods — and only those
var result = await SafeScript.run('return c.value()', { c: new Counter(42) });
// → 42

// Blocked methods throw
await SafeScript.run('c.reset()', { c: new Counter(0) });
// → Error: SafeScript: method "reset" not allowed on Counter

// Unregistered types block everything
await SafeScript.run('return x.anything()', { x: new SomeClass() });
// → Error: SafeScript: cannot call method on unregistered type
```

### Named Type Registration (for `@type` headers)

The three-argument form registers both a string name (for `@type` header validation) and a constructor (for runtime enforcement):

```js
// Three-arg: lib(name, Constructor, config)
SafeScript.lib('Response', ResponseClass, { allowMethods: ['json', 'text', 'status'] });
SafeScript.lib('Stream', StreamClass, { allowMethods: ['get', 'set', 'fields'] });

// Now @type Response { json, text } in a .safe header validates at load() time
var bundle = await SafeScript.load(source);  // checks @type declarations
await SafeScript.run(bundle);
```

### How It Works

The runtime checks every method call through a dispatch chain:

1. **Primitives** (string, number, boolean) → allow all native methods
2. **Arrays** → allow all native methods
3. **Functions** → allow all (call, apply, bind)
4. **Plain objects** → allow callable properties only
5. **Error family** → allow all (toString, message, etc.)
6. **Registered types** → check allowMethods whitelist
7. **Unregistered types** → throw (sandbox violation)

Subclass inheritance works automatically — a `SpecialCounter extends Counter` instance uses the `Counter` registration if `SpecialCounter` isn't registered independently.

```js
// Unregister
SafeScript.unlib(Counter);

// Clear all type registrations
// (accessible through runtime internals)
```

## `this` and Facades

SafeScript supports `this` as a keyword. It compiles to an internal `__safeThis` identifier via a mutable cell pattern. By default, `this` is `undefined` everywhere — top level, regular functions, and arrows.

The host controls what `this` resolves to through the `facades` option. Facades let injected callback-accepting functions set `this` for the callbacks they receive.

```js
var result = await SafeScript.run(`
  Q.Tool.define("my-tool", {
    init: function() {
      // 'this' is the facade object created by createToolFacade
      this.state.count = 0;
    },
    methods: {
      increment: function() {
        this.state.count = this.state.count + 1;
      }
    }
  });
`, { Q: myQObject }, {
  facades: {
    'Q.Tool.define': {
      args: [1],        // callback argument indices
      methods: [3],     // method-object argument indices (values are wrapped)
      create: function(name) { return { state: {}, element: null }; }
    }
  }
});
```

Facade config fields:

- `args` — indices of arguments that are callbacks (will have `this` set to the facade)
- `methods` — indices of arguments that are objects whose values are callbacks
- `create` — factory function called with the other arguments to build the facade object

All property access on `this` goes through the same `__at`/`__set` guards as any other object — `constructor`, `__proto__`, and `prototype` are blocked.

## API

### `SafeScript.run(source, scope?, opts?)` or `SafeScript.run(bundle)`

Compile and execute. Returns a Promise that resolves to the value from the top-level `return` statement, or `undefined` if there is none.

```js
await SafeScript.run('return a + b;', { a: 1, b: 2 }); // → 3

// Or pass a bundle from load()
var bundle = await SafeScript.load(source, resolver);
await SafeScript.run(bundle); // same result
```

Options:
- `timeout: N` — execution timeout in milliseconds (capped at 60000). Always enforced even if omitted.
- `maxOps: N` — maximum operations / guard checks (capped at 100000000). Always enforced even if omitted.
- `hooks: { beforeCall, afterCall }` — intercept calls to injected scope functions. See [Hooks](#hooks).
- `seed: N` — PRNG seed. Default `0` (deterministic). Any integer for a custom seed. `null` for true `Math.random` (requires `env: { Random: true }`).
- `env: { Random: true }` — approve environment capabilities. Currently only `Random` is defined.
- `facades: { ... }` — per-method `this` facades. See [`this` and Facades](#this-and-facades).
- `allowNew: [Ctor, ...]` — additional constructors allowed with `new` for this run (beyond built-in safe types and registered types).
- `rawReturn: true` — disable return value sanitization (return functions and arbitrary objects).

### `SafeScript.compile(source)`

Returns `{ code, ast, hash }`. The `code` is safe JavaScript. The `hash` is a SHA-256 of the normalized AST (null in browsers — use `hashASTAsync`).

### `SafeScript.validate(source)`

Returns `{ ok: boolean, errors: Array|null }`. Check without executing.

### `SafeScript.capabilities(source)`

Returns `{ version, env, needs: [{name, type}], uses: [{name, type}], types: [{name, methods}] }`. Parse the `.safe` file header.

### `SafeScript.load(source, resolver?)`

Async one-call integration. Parses the header, calls `resolver(caps)` to build the scope (resolver can be sync or async), validates `@needs`, and returns a Promise that resolves to a `{ source, scope }` bundle you pass to `run()`.

```js
// Load, then run
var bundle = await SafeScript.load(source, function(caps) {
  return {
    request: reqWrapper,
    db: dbHandle,
    logger: caps.uses.find(u => u.name === 'logger') ? myLogger : undefined
  };
});
var result = await SafeScript.run(bundle);

// Prepare once, run many times
var bundle = await SafeScript.load(templateSource, resolver);
for (var req of requests) {
  bundle.scope.request = req;
  results.push(await SafeScript.run(bundle));
}
```

If no resolver is provided, resolves with an empty scope (fine for scripts with no `@needs`). Rejects if the scope doesn't satisfy `@needs`.

### `SafeScript.checkScope(source, scope)`

Returns `{ ok: boolean, missing: string[] }`. Check whether a scope object satisfies the file's `@needs` declarations.

### `SafeScript.parse(source)`

Returns the AST (ESTree-like).

### `SafeScript.sanitize(obj)`

Deep-copies an object to null-prototype objects, blocking prototype-chain escapes.

### `SafeScript.lib(name, value)` / `SafeScript.lib(Constructor, config)` / `SafeScript.lib(name, Constructor, config)`

Three forms:
- `lib(name, value)` — register a named library (auto-resolved by `load()` for `@needs`/`@uses`)
- `lib(Constructor, { allowMethods: [...] })` — register a type whitelist for runtime method enforcement
- `lib(name, Constructor, { allowMethods: [...] })` — register both a named type (for `@type` header validation) and a constructor whitelist (for runtime enforcement)

### `SafeScript.unlib(name)` / `SafeScript.unlib(Constructor)`

Unregister a named library, a type registration, or a named type mapping.

### `SafeScript.libs()`

Returns an array of registered library names.

### `SafeScript.clearTypeRegistry()`

Clear all type registrations (both constructor whitelists and named type mappings).

## What's Allowed

SafeScript supports a broad computational subset of ES2020:

- Variables: `var`, `let`, `const`
- Control flow: `if`/`else`, `for`, `for-in`, `for-of`, `while`, `do-while`, `switch`/`case`, `break`, `continue`, `return`, labeled statements
- Functions: declarations, expressions, arrows, default params, rest params, `this` (via facades)
- Constructors: `new` with built-in types (`Map`, `Set`, `Date`, `RegExp`, `Error` family), registered types, and host-allowed constructors
- Expressions: all arithmetic, comparison, logical, ternary, `typeof`, `void`, `instanceof`, nullish coalescing (`??`), optional chaining (`?.`)
- Destructuring: array and object patterns, rest elements, nested
- Spread: arrays and objects
- Error handling: `try`/`catch`/`finally`, `throw`
- Literals: strings, numbers (decimal, hex, binary, octal, BigInt), regex, arrays, objects

### Constructors (`new`)

`new` is allowed but restricted to a whitelist. This prevents arbitrary constructor calls while letting scripts use built-in data types naturally.

**Always allowed** — `Map`, `Set`, `Date`, `RegExp`, `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`:

```js
var m = new Map();
m.set('key', 'value');

var d = new Date(2024, 0, 1);
var pattern = new RegExp('^test', 'i');
```

**Host-registered types** — anything registered with `SafeScript.lib()`:

```js
SafeScript.lib('Counter', Counter, { allowMethods: ['value', 'increment'] });
// Now SafeScript code can use: new Counter(0)
```

**Per-run allowlist** — pass constructors in `opts.allowNew`:

```js
await SafeScript.run('return new Point(1, 2);', { Point: Point }, {
  allowNew: [Point]
});
```

Unregistered constructors throw at runtime: `SafeScript: constructor "Foo" is not allowed`.

## What's Blocked

- **Identifiers**: `eval`, `Function`, `globalThis`, `window`, `document`, `require`, `process`, `Proxy`, `Reflect`, `Symbol`, `fetch`, `setTimeout`, and more
- **Keywords**: `delete`, `class`, `import`, `export`, `with`, `debugger`, `yield`, `async`, `await`
- **Properties** (bracket access): `constructor`, `__proto__`, `prototype`, `caller`, `callee`
- **Syntax**: template literals, generators (`function*`)

## Debugging (v2.0)

SafeScript 2.0 adds a debugging system built entirely from its own instrumentation — no browser DevTools, no source maps, no `debugger` statements. The compiled output in debug mode inserts checkpoint calls (`__dbg`) after every statement. Each checkpoint can pause execution (via `await`), inspect locals, and hand off to a replacement function for edit-and-continue. See [RELEASE-NOTES.md](RELEASE-NOTES.md) for a summary of all v2.0 features and [Debugging.md](Debugging.md) for the complete debugging guide.

### Quick Start — Debug Mode

```js
var session = SafeScript.debug('var x = 1;\nvar y = x + 1;\nreturn y;', {}, {
  onPause: function(info) {
    console.log('Paused at line', info.line, '— locals:', info.locals);
  },
  onFinish: function(value) {
    console.log('Result:', value);
  }
});

// Execution pauses at the first statement
session.step();        // advance one statement
session.step();        // advance again
session.continue();    // run to completion (or next breakpoint)
```

### DebugSession API

`SafeScript.debug(source, scope, opts)` returns a `DebugSession` with:

- `step()` — advance one statement
- `continue()` — run until next breakpoint or end
- `stop()` — abort execution
- `runToLine(line)` — run to a specific line (one-shot breakpoint)
- `toggleBreakpoint(line)` / `setBreakpoints(lines)` — manage breakpoints
- `getLocals()` — current local variables (when paused)
- `getHistory()` — all step records (line numbers, effects)
- `editAndContinue(newSource)` — recompile and resume with current locals
- `rewindTo(stepIndex)` — time travel to a previous step
- `commit()` — apply all journal writes to real objects (auto-snapshots DOM first)
- `discard()` — clear the journal, real state unchanged
- `stepOver()` — advance to next statement at same or lower call depth (skip function bodies)
- `stepOut()` — run until returning to the caller's level
- `evaluate(expr)` — evaluate a SafeScript expression in the current paused scope
- `setConditionalBreakpoint(line, condition?)` — break only when condition is truthy
- `fork()` — clone the session into an independent copy for parallel exploration
- `serialize()` — export session state as a JSON-safe object
- `DebugSession.deserialize(data, resolver?)` — restore a session from serialized data
- `snapshotDOM()` — capture container innerHTML
- `restoreDOM(index)` — restore a previous snapshot
- `findSnapshotBefore(stepIndex)` — nearest snapshot at or before a step
- `queryNodeHistory(node, prop?)` — journal entries for a DOM node (newest first)
- `queryNodeSteps(node, prop?)` — step indices where a node was modified
- `getNodeTimeline(node)` — change history for an element (oldest first)
- `state` — `'running'`, `'paused'`, `'finished'`, or `'stopped'`
- `currentLine` — line number where execution is paused
- `currentLocals` — snapshot of local variables at the pause point

Callbacks: `onPause(info)`, `onStep(step)`, `onFinish(value)`, `onError(err)`, `onCommit(result)`.

### Journal — Transactional Execution

In debug mode, all side effects go through a **journal** (write-ahead log with read overlay). Property writes on scope objects are recorded in the journal instead of mutating the real objects. Reads check the journal overlay first, then fall through to the real value.

```js
var data = { count: 0 };
var session = SafeScript.debug('count = count + 1; count = count + 1;', { count: data.count }, {
  captureAllLocals: true,
  onPause: function() {}
});

session.step();
session.step();
// data.count is still 0 — nothing mutated yet

session.commit();
// Now data.count reflects the changes

// Or: session.discard() to throw away all changes
```

The journal also tracks DOM mutations when using the DOM membrane in debug mode. Attribute writes, style changes, and text content updates all go through the journal overlay. This means you can step through DOM-manipulating code and see what would change, without actually changing the page — then commit to apply, or discard to leave the DOM untouched.

### Time Travel

Every step is recorded in history with its line number, locals snapshot, and side effects. `rewindTo(stepIndex)` rolls the journal cursor back and restores the locals from that point.

```js
session.step();  // step 0: x = 1
session.step();  // step 1: y = x + 1

// Go back to step 0
session.rewindTo(0);
// Now paused at step 0 with the locals from that point
// Journal writes after step 0 are rolled back
```

Use `captureAllLocals: true` to capture locals at every step (not just pause points) for full time-travel support.

### Edit-and-Continue

While paused, you can edit the source code and resume with the new logic. The system recompiles the entire source in debug mode and creates a replacement function that receives the current locals — new variables in the edited code work naturally.

```js
session.step();  // paused after "var x = 1;"

// Edit the remaining code
session.editAndContinue('var x = 1;\nvar y = x * 10;\nreturn y;');
session.continue();
// Execution continues with the new logic, using current locals
```

### Debug Protocol — Pluggable Transport

The debug protocol is a bidirectional messaging interface between the engine (DebugSession) and a driver (IDE/UI). It's transport-agnostic — works over postMessage, MessagePort, WebSocket, or in-process function calls.

```js
// In-process driver (same thread)
var driver = new SafeScript.InProcessDriver(function(event) {
  console.log('Event:', event.type, event.data);
});

var session = SafeScript.debug(source, scope, {
  driver: driver,
  onPause: function() {},
  onFinish: function() {}
});

// Send commands from the UI
driver.command('step');
driver.command('setBreakpoints', { lines: [5, 10] });
driver.command('editAndContinue', { source: newSource });
driver.command('rewindTo', { stepIndex: 3 });
driver.command('commit');
```

**Built-in transports:**

| Transport | Use case |
|-----------|----------|
| `InProcessDriver` | Same-thread debugging (simplest) |
| `PostMessageDriver` | Web Worker or iframe — debug session runs off the main thread |
| `PortDriver` | MessagePort (SharedWorker, BroadcastChannel) |

**25 commands** (driver → engine): `step`, `continue`, `stop`, `stepOver`, `stepOut`, `setBreakpoints`, `toggleBreakpoint`, `runToLine`, `setConditionalBreakpoint`, `editAndContinue`, `evaluate`, `rewindTo`, `commit`, `discard`, `getLocals`, `getHistory`, `getJournal`, `getNodeTimeline`, `getDOMSnapshots`, `snapshotDOM`, `restoreDOM`, `fork`, `serialize`, `setLogpoint`, `removeLogpoint`.

**18 events** (engine → driver): `paused`, `stepped`, `finished`, `error`, `committed`, `discarded`, `rewound`, `locals`, `history`, `journal`, `nodeTimeline`, `domSnapshots`, `domSnapshot`, `domRestored`, `evaluated`, `forked`, `serialized`, `logpoint`.

Third-party transports (SafeStudio, xdebug-style debuggers) implement the same interface. A driver is any object with a `send(event)` method and an `onMessage(callback)` method.

### Web Worker Transport

Run the debug session in a Web Worker to keep the main thread responsive:

```js
// Main thread
var worker = new Worker('my-worker.js');
var proxy = SafeScript.createWorkerProxy(worker, {
  channel: 'my-session',
  onEvent: function(event) {
    if (event.type === 'paused') {
      console.log('Paused at line', event.data.line);
    }
  }
});

proxy.step();
proxy.setBreakpoints([5, 10]);
proxy.editAndContinue(newSource);
proxy.commit();

// Worker (my-worker.js)
importScripts('safescript.min.js');
SafeScript.runInWorker(self, source, scope, { channel: 'my-session' });
```

The `DebugProxy` mirrors the full `DebugSession` API. State (`state`, `currentLine`, `currentLocals`) is updated from incoming events.

### DOM Facades + Journal

When using SafeScript's DOM membrane (`opts.dom`) in debug mode, DOM mutations automatically route through the journal:

- **Attribute writes** (`setAttribute`, `removeAttribute`) → journal key `attr:<name>`
- **Text content** (`textContent`, `innerHTML`) → journal key by property name
- **Style changes** (property set, `setProperty`, `cssText`) → journal key `style:<prop>`
- **Tree mutations** (`appendChild`, `insertBefore`) → logged as side effects (structural changes apply immediately)

Reads check the journal overlay first, so `getAttribute('class')` returns the journaled value if one was written. On commit, all writes are applied to the real DOM. On discard, the DOM is untouched.

This means you can step through DOM-manipulating SafeScript code and see a virtual view of the page that can be rewound, forked, and replayed — without touching the real DOM until you're ready.

### DOM Snapshots

The debug session captures `innerHTML` snapshots of the container at each commit point. This gives structural undo for free — tree mutations (appendChild, insertBefore) that can't be reversed property-by-property are handled by restoring the snapshot.

```js
// Snapshots are taken automatically before each commit()
session.commit();  // auto-snapshots, then applies journal writes to real DOM

// Manual snapshots at any point
session.snapshotDOM();

// Restore a previous state
session.restoreDOM(0);  // restore to first snapshot

// Find the nearest snapshot before a given step
var idx = session.findSnapshotBefore(stepIndex);
session.restoreDOM(idx);
```

### Reverse Lookup: Element → Operations

Given any DOM element in the container, you can look up every operation that changed it, and jump to the exact moment in the code where each change happened.

```js
// "What happened to this element?" — full timeline, oldest first
var timeline = session.getNodeTimeline(element);
// → [{ step: 0, line: 5, prop: 'textContent', was: '', to: 'Hello' },
//    { step: 3, line: 12, prop: 'attr:class', was: null, to: 'active' },
//    { step: 7, line: 18, prop: 'style:color', was: '', to: 'red' }]

// "Which moments can I jump to for this element?"
var steps = session.queryNodeSteps(element);
// → [7, 3, 0]  (newest first — these are rewindTo targets)

// "Show me only the style changes"
var styleSteps = session.queryNodeSteps(element, 'style:color');
// → [7]

// Jump to the moment the class was set
session.rewindTo(3);
// Now paused at step 3, journal rolled back, locals restored

// All journal entries for this node (newest first)
var entries = session.queryNodeHistory(element);
```

This is bidirectional: you can go from code → visual (step through and watch the DOM change) or from visual → code (click an element, see what changed it, jump to that line). SafeStudio can render a "changes to this element" panel where each entry is a clickable jump point.

### Watch Expressions

Evaluate any SafeScript expression in the current paused scope:

```js
session.evaluate('x + y');           // → 30
session.evaluate('obj.nested.val');  // → 'hello'
session.evaluate('arr.length > 5');  // → true
```

The expression is compiled through SafeScript (same safety guarantees) and evaluated against the current locals. The session state is not modified.

### Conditional Breakpoints

Break only when a condition is truthy:

```js
session.setConditionalBreakpoint(10, 'i === 50');  // pause at line 10 only when i is 50
session.setConditionalBreakpoint(15);               // unconditional (same as toggleBreakpoint)
session.setConditionalBreakpoint(10, 'arr.length > 100');  // replace condition
```

### Step Over / Step Out

```js
session.step();      // step into — advances one statement, enters function bodies
session.stepOver();  // step over — advances one statement, skips function bodies
session.stepOut();   // step out — runs until returning to the caller's level
```

### Fork

Clone the debug session to explore a different code path without losing the current state:

```js
var child = session.fork();
// child is an independent copy — same breakpoints, history, locals, journal
// Modify child without affecting the parent
child.step();  // child advances, parent stays put
```

### Serialize / Deserialize

Persist a debug session (e.g. to a Qbix Stream) and restore it later:

```js
var data = session.serialize();       // JSON-safe object
var json = JSON.stringify(data);      // send over the wire, store in a stream

var restored = DebugSession.deserialize(JSON.parse(json), function(objectId) {
  return originalObjects[objectId];   // resolve journal target references
});
```

### Logpoints

Logpoints fire a message when a line is reached, without pausing execution — like `console.log` but controlled from the driver and removable at runtime. Template strings support `{expr}` interpolation against the current locals:

```js
session.setLogpoint(5, 'x = {x}, y = {y}');   // log at line 5
session.setLogpoint(12, 'entering loop');       // plain message

session.onLog = function(info) {
  console.log('[line ' + info.line + '] ' + info.message);
};

session.removeLogpoint(5);  // stop logging at line 5
```

Via the protocol: `setLogpoint` / `removeLogpoint` commands, `logpoint` event. Logpoints are preserved across `fork()` and `serialize()` / `deserialize()`.

### Real-World Example: DOM Container

A complete example of loading SafeScript, scoping it to a DOM container, and running it — safely, with no ability to touch anything outside the container:

```html
<div id="my-widget">
  <h2>Widget Title</h2>
  <p class="content">Loading...</p>
</div>

<script src="safescript.min.js"></script>
<script>
var safeSource = [
  '/**',
  ' * @safescript 0.2',
  ' * @needs container: Element',
  ' */',
  'var p = container.querySelector(".content");',
  'p.textContent = "Hello from SafeScript!";',
  'p.style.color = "green";',
  'return { status: "ok" };'
].join('\n');

SafeScript.run(safeSource, {}, {
  dom: {
    root: document.getElementById('my-widget'),
    policy: {
      tags: ['div', 'p', 'span', 'h1', 'h2', 'h3', 'a', 'img'],
      attrs: ['class', 'id', 'href', 'src', 'alt', 'data-*'],
      styles: null  // all safe CSS properties allowed
    }
  }
}).then(function(result) {
  console.log('Widget initialized:', result);
});
</script>
```

The DOM membrane ensures scripts can only see and modify elements inside `root`. In debug mode, all mutations go through the journal instead of the real DOM.

For additional isolation on a [Qbix](https://github.com/Qbix/Q.js)-powered site, `Q.Safebox` provides iframe sandboxing with `Q.Proxy` for transparent cross-context proxying. But Q.Safebox is optional — SafeScript's security comes from static analysis and compile-time instrumentation, not from a runtime sandbox.

## Security Without a Sandbox

SafeScript code is safe to run on the main thread without a Web Worker, iframe, or any browser sandbox. The four security barriers (token allowlist, runtime guards, global shadowing, execution guards) plus the constructor whitelist and return sanitization mean SafeScript code cannot:

- Access any global or prototype chain
- Call `eval`, `Function`, or any blocked identifier
- Construct arbitrary types
- Return functions (capabilities are stripped)
- Read or write DOM outside its container
- Run forever (operation limit + timeout)

The only resource a SafeScript can exhaust is memory — by building large data structures within the operation limit. For most use cases this is bounded by the operation counter. For untrusted code from the internet, running in a Web Worker via the built-in transport adds memory isolation without code changes to the `.safe` file.

## Specification

See [Specification.md](Specification.md) for the formal language definition — starts from ES8 and lists what's removed, rewritten, and added.

See [Examples.md](Examples.md) for a kitchen-sink collection: basics, control flow, functions, destructuring, spread, and real-world patterns (request handlers, pricing engines, validators, state machines).

## Size

| Build | Size |
|-------|------|
| `safescript.js` | ~94 KB |
| `safescript.min.js` | ~48 KB |
| gzipped | ~12 KB |

## Ecosystem

Integration packages for common environments:

| Package | What it does |
|---------|-------------|
| [safescript-express](https://github.com/SafeScript/safescript-express) | Express middleware — map `.safe` files to routes with capability resolution |
| [safescript-loader](https://github.com/SafeScript/safescript-loader) | Browser auto-loader for `<script type="safescript">` elements |
| [safescript-cli](https://github.com/SafeScript/safescript-cli) | CLI tool — run, validate, check, compile, and inspect `.safe` files |
| [safescript-quickjs](https://github.com/SafeScript/safescript-quickjs) | Embed SafeScript in C/C++/Rust apps via QuickJS |
| [safescript-php](https://github.com/SafeScript/safescript-php) | Pure PHP port — run SafeScript in PHP with zero Node dependency |

## Tests

```bash
node test.js                # core compiler + runtime (153 tests)
node test-v1.4.js           # v1.4: new keyword, constructors, return sanitization (30 tests)
node test-debug.js          # v2.0: debug instrumentation, stepping, breakpoints (24 tests)
node test-journal.js        # v2.0: journal, time travel, commit/discard (23 tests)
node test-edit-continue.js  # v2.0: edit-and-continue, debug protocol (14 tests)
node test-dom-journal.js    # v2.0: DOM journal integration (15 tests)
node test-dom-snapshots.js  # v2.0: DOM snapshots, reverse lookup, element timeline (21 tests)
node test-advanced-debug.js # v2.0: evaluate, conditional breakpoints, stepOver/Out, fork, serialize (24 tests)
node test-dom.js            # DOM membrane security tests
node test-type-registry.js  # type registry — method whitelisting
node test-type-header.js    # @type header declarations + load() validation
```

## License

MIT — Gregory Magarshak

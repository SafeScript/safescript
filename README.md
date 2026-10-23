# SafeScript

A safe computational subset of JavaScript. **SafeScript is to code, what JSON is to data.**

JSON gave the world a safe way to exchange data. SafeScript does the same for computation. It's a strict subset of JavaScript — no `eval`, no `new`, no globals, no prototype access — that compiles to plain JS. Open a `.safe` file and you see code that's safe to run. The compiler is 41 KB minified (10 KB gzipped). Ship it anywhere, verify locally, no trust needed.

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

// Only what you inject is accessible
await SafeScript.run('return typeof Object;', {});  // → 'undefined'
await SafeScript.run('return Math.sqrt(16);', { Math });  // → 4
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

The header is an optional `/** */` block comment with four directives:

- `@safescript <version>` — language version
- `@needs <name>: <Type>` — required capability; the host must provide it or refuse to run the file
- `@uses <name>: <Type>` — optional capability; the host provides it if available, the script checks with `if (name)`
- `@env <env1>, <env2>` — constrains which environments can run this file (optional, comma-separated)

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

1. **Token/grammar allowlist** — The parser accepts only a subset of JavaScript. No `eval`, `new`, `delete`, `class`, `import`, `async`, `await`, template literals, or access to `globalThis`/`window`/`document`. The AST is reconstructed from scratch — the original source text never appears in the output.

2. **Runtime property guards** — Bracket access (`obj[key]`) is rewritten to `__at(obj, key)` / `__set(obj, key, val)`, which block prototype-chain properties (`constructor`, `__proto__`, `prototype`, `caller`, `callee`) at runtime, even when keys are computed dynamically.

3. **Global shadowing + strict mode** — Every global (`Object`, `Array`, `console`, `fetch`, etc.) is declared as `undefined` inside the compiled function. Only capabilities you inject via the scope object are accessible. Code always runs in `"use strict"`.

4. **Execution guards + hooks** — Compile-time injected `__check()` calls enforce timeout and operation limits (hardcoded ceilings: 60s, 100M ops), preventing infinite loops and infinite recursion. Hooks intercept every call to injected scope functions, letting the host throttle resources at the boundary.

With an empty scope, SafeScript is pure computation — no I/O, no side effects, no access to anything outside the function. Capabilities are injected via the scope object using an object-capability model.

## Execution Model

A `.safe` file is a function body. The compiler wraps it in a function, the host calls that function with a scope, and the code uses `return` to hand a value back. `run()` always returns a Promise.

```js
// Return a computed value
await SafeScript.run('return price * qty;', { price: 9.99, qty: 3 });  // → 29.97

// Return a function (the function itself is async)
var double = await SafeScript.run('return function(n) { return n * 2; };', {});
await double(21);  // → 42

// Return an object — the "module" pattern
var mod = await SafeScript.run(`
  var count = 0;
  return {
    inc: function() { count = count + 1; return count; },
    get: function() { return count; }
  };
`, {});
await mod.inc(); await mod.inc(); await mod.get(); // → 2

// Side-effect only (write to an injected capability, no return needed)
await SafeScript.run('db.store(record);', { db: myDb, record: data });
```

There is no `export`, no `module.exports`, and no implicit last-expression return. `return` makes intent explicit and keeps `.safe` files readable.

### Auto-Async

SafeScript uses an **auto-async execution model**. The compiler automatically:

- Emits every function (declarations, expressions, arrows, method shorthands) as `async`
- Wraps every function call with `await`

This means `async` and `await` are **not** keywords in SafeScript — they are blocked. The compiler handles them transparently. This has two important consequences:

1. **Promises resolve automatically.** When injected objects return Promises, they're awaited at every call site. No unresolved Promises can leak through.
2. **Sequential execution is guaranteed.** There are no concurrent in-flight operations inside a single SafeScript execution. Throughput comes from running many SafeScript instances in parallel (like PHP-FPM workers), not from concurrency within one.

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

### `SafeScript.compile(source)`

Returns `{ code, ast, hash }`. The `code` is safe JavaScript. The `hash` is a SHA-256 of the normalized AST (null in browsers — use `hashASTAsync`).

### `SafeScript.validate(source)`

Returns `{ ok: boolean, errors: Array|null }`. Check without executing.

### `SafeScript.capabilities(source)`

Returns `{ version, env, needs: [{name, type}], uses: [{name, type}] }`. Parse the `.safe` file header.

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

## What's Allowed

SafeScript supports a broad computational subset of ES2020:

- Variables: `var`, `let`, `const`
- Control flow: `if`/`else`, `for`, `for-in`, `for-of`, `while`, `do-while`, `switch`/`case`, `break`, `continue`, `return`, labeled statements
- Functions: declarations, expressions, arrows, default params, rest params
- Expressions: all arithmetic, comparison, logical, ternary, `typeof`, `void`, `instanceof`, nullish coalescing (`??`), optional chaining (`?.`)
- Destructuring: array and object patterns, rest elements, nested
- Spread: arrays and objects
- Error handling: `try`/`catch`/`finally`, `throw`
- Literals: strings, numbers (decimal, hex, binary, octal, BigInt), regex, arrays, objects

## What's Blocked

- **Identifiers**: `eval`, `Function`, `globalThis`, `window`, `document`, `require`, `process`, `Proxy`, `Reflect`, `Symbol`, `fetch`, `setTimeout`, and more
- **Keywords**: `new`, `delete`, `class`, `import`, `export`, `with`, `debugger`, `yield`, `async`, `await`
- **Properties** (bracket access): `constructor`, `__proto__`, `prototype`, `caller`, `callee`
- **Syntax**: template literals, generators (`function*`)

## Specification

See [Specification.md](Specification.md) for the formal language definition — starts from ES8 and lists what's removed, rewritten, and added.

See [Examples.md](Examples.md) for a kitchen-sink collection: basics, control flow, functions, destructuring, spread, and real-world patterns (request handlers, pricing engines, validators, state machines).

## Size

| Build | Size |
|-------|------|
| `safescript.js` | ~77 KB |
| `safescript.min.js` | ~41 KB |
| gzipped | ~10 KB |

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
node test.js               # v0.1 linter/wrapper
node test-compiler.js      # compiler pipeline
node test-battle.js        # adversarial/escape attempts
node test-header.js        # header parser + load() + run(bundle)
node test-guards-hooks.js  # execution guards + hooks system
```

## License

MIT — Gregory Magarshak

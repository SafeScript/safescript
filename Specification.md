# SafeScript Language Specification

**Version 0.4**

SafeScript is a safe computational subset of JavaScript. This specification defines it by starting from ECMAScript 2017 (ES8) and listing what is removed, what is rewritten, and what is added.

Everything not mentioned here works exactly as it does in ES8. If you know JavaScript, you already know SafeScript — minus the dangerous parts.

## Starting Point: ES8

SafeScript accepts standard ECMAScript 2017 syntax with the following post-ES8 additions also supported:

- Nullish coalescing (`??`) — ES2020
- Optional chaining (`?.`) — ES2020
- `BigInt` literals (`123n`) — ES2020
- `for-of` loops — ES2015 (included in the base)
- Arrow functions — ES2015 (included in the base)
- Destructuring and spread — ES2015 (included in the base)

## What Is Removed

### Blocked Keywords

These keywords are parse errors in SafeScript:

| Keyword | Why |
|---------|-----|
| `new` | Constructor calls can produce privileged objects |
| `delete` | Property deletion can alter prototype chains |
| `class` | Implies `new`, `super`, and prototype manipulation |
| `extends` | Class inheritance machinery |
| `super` | Class inheritance machinery |
| `with` | Scope manipulation, already deprecated in strict mode |
| `import` | Module loading — SafeScript is self-contained by design |
| `export` | Module system — SafeScript is self-contained by design |
| `debugger` | Execution control |
| `yield` | Generator machinery (generators are not supported) |
| `async` | Auto-async model — the compiler emits `async` on all functions automatically |
| `await` | Auto-async model — the compiler emits `await` on all calls automatically |

### Blocked Identifiers

These identifiers cannot appear in SafeScript source — not as variable names, not as references:

**Prototype chain access:**
`constructor`, `__proto__`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`

**Self-reference and stack walking:**
`this`, `arguments`, `callee`, `caller`

**Code generation:**
`eval`, `Function`

**Browser globals:**
`globalThis`, `window`, `document`, `navigator`, `self`, `top`, `parent`, `frames`, `location`, `history`

**Metaprogramming:**
`Proxy`, `Reflect`, `Symbol`

**Network:**
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`

**Timers:**
`setTimeout`, `setInterval`, `requestAnimationFrame`

**Node.js:**
`require`, `module`, `exports`, `process`, `global`, `Buffer`, `__filename`, `__dirname`

Any attempt to reference these produces a compile-time error. The host can still *inject* functionality with these names via the scope object — the restriction is on the source code, not on the runtime values. For example, a host can provide `fetch` in the scope and the SafeScript code calls it through that injected binding, but the code can't write `fetch` as a bare reference.

### Blocked Syntax

| Feature | Status |
|---------|--------|
| Template literals (`` `...` ``) | Blocked — can embed expressions that bypass the parser |
| Generator functions (`function*`) | Blocked — `yield` is not available |
| Tagged templates | Blocked |
| `new.target` | Blocked — `new` is blocked |

### Blocked Property Access

These property names are blocked at runtime when accessed via bracket notation (`obj[key]`):

`constructor`, `__proto__`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `caller`, `callee`, `arguments`

Dot access to these names is also blocked at the AST validation stage.

## What Is Rewritten

### Computed Property Access

All bracket-notation property access is rewritten at compile time:

```javascript
// Source (SafeScript)
var val = obj[key];
obj[key] = val;

// Compiled output
var val = __at(obj, key);
__set(obj, key, val);
```

`__at(obj, key)` and `__set(obj, key, val)` are runtime guards injected by the compiler. They check `key` against the blocked property list before performing the access. This catches dynamic prototype-chain attacks like `obj["construct" + "or"]`.

### Auto-Async Rewriting

The compiler automatically transforms all functions and calls for async execution:

- **All functions** (declarations, expressions, arrows, method shorthands) are emitted with the `async` keyword.
- **All call expressions** are wrapped with `await`.

This means SafeScript code is written synchronously, but the compiled output is fully async. The developer never writes `async` or `await` — the compiler handles it.

```javascript
// Source (SafeScript)
function add(a, b) { return a + b; }
var result = add(1, 2);
return db.query("SELECT 1");

// Compiled output (simplified)
async function add(a, b) { return a + b; }
var result = (await add(1, 2));
return (await db.query("SELECT 1"));
```

This design has several benefits:

1. **Promise transparency.** When injected objects return Promises (e.g. from a database driver), they resolve automatically. `await` on a non-Promise is a no-op (`Promise.resolve` wraps it), so synchronous values pass through unchanged.
2. **No unresolved Promises.** Because every call is awaited, Promises can never be passed around in an unresolved state. This eliminates an entire class of concurrency bugs.
3. **Cross-target portability.** The same SafeScript source runs in JavaScript (async) and PHP (synchronous) without changes. The auto-async model is a compile-target concern, invisible to the SafeScript author.

### Global Shadowing

The compiled output wraps all code in a function that shadows every known global:

```javascript
(function(Object, Array, Function, eval, window, document, /* ...100+ names */) {
  "use strict";
  // ... compiled SafeScript code ...
})(scope.Object, scope.Array, /* only injected values, or undefined */)
```

Every name in the shadow list is `undefined` unless the host explicitly provides it in the scope. This is defense in depth — even if an identifier somehow passes the parser's blocked list, it resolves to `undefined` at runtime.

### Strict Mode

All compiled SafeScript code runs in `"use strict"` mode. This is enforced by the compiler, not by the source.

### AST Reconstruction

The compiler does not manipulate the source text. It parses source → AST → validates → transforms → emits new JavaScript from the AST. The original source text never appears in the output. This prevents any hiding of malicious code in whitespace, Unicode tricks, or comment injection.

## What Is Added

### Capability Headers

SafeScript files can begin with a header block declaring their requirements:

```javascript
/**
 * @safescript 0.3
 * @needs request: Request
 * @needs db: Database
 * @uses logger: Logger
 * @env browser, node
 */
```

**Directives:**

- `@safescript <version>` — declares the language version
- `@needs <name>: <Type>` — a required capability; the host must provide it or refuse to run the file
- `@uses <name>: <Type>` — an optional capability; the host provides it if available
- `@env <env1>, <env2>` — restricts which environments may run this file

The header is a standard block comment (`/** */`) and is parsed separately from the code body. The `Type` annotations are informational — they tell the host what kind of value to provide but are not type-checked by the compiler.

### Runtime Guards

`__at(obj, key)` and `__set(obj, key, val)` are injected into every compiled function's scope. They are not accessible to SafeScript source code.

### The `.safe` File Extension

SafeScript files use the `.safe` extension and the `application/safescript` MIME type.

### Execution Model

A `.safe` file is compiled into an async function body. The host calls `SafeScript.run()` with a source string and a scope object. `run()` always returns a **Promise** that resolves to the value from the top-level `return` statement (or `undefined` for side-effect-only scripts).

The return value can be anything: a primitive, an object, a function, or nothing (`undefined`). This is how SafeScript code exposes an API to the host — return an object with methods, each closing over shared private state.

**Sequential execution is guaranteed.** Within a single SafeScript instance, there are no concurrent in-flight operations. Every call is awaited before the next statement executes. This provides deterministic, predictable behavior — no race conditions, no concurrent mutation, no surprises.

**Throughput comes from parallelism at the host level,** not from concurrency within SafeScript. The host spins up many SafeScript instances in parallel — the same way PHP-FPM handles throughput by running many workers, each processing one request at a time.

### Execution Guards

The compiler injects `__check()` calls at two points:

1. **Top of every function body** — catches infinite recursion.
2. **Start of every loop iteration** (all five loop types: `for`, `for-in`, `for-of`, `while`, `do-while`) — catches infinite loops.

`__check()` enforces two limits:

- **Timeout.** The host passes `{ timeout: N }` (milliseconds in JS, seconds in PHP). `__check()` compares the wall clock against a deadline. To reduce overhead, the time check runs every 1000 operations rather than every call. **Hardcoded ceiling:** 60 seconds (60000 ms in JS). Even if the host passes `0` or omits the option, the ceiling is enforced.

- **Operation limit.** The host passes `{ maxOps: N }`. Each `__check()` call decrements a counter. When it reaches zero, execution throws. **Hardcoded ceiling:** 100,000,000 (100 million). Even if the host passes `0` or omits the option, the ceiling is enforced.

These guards are compile-time injected — SafeScript code cannot bypass or disable them. The `__check` identifier is reserved (prefixed with `__`) and is excluded from the free-variables list automatically.

```javascript
// Basic execution — always returns a Promise
var result = await SafeScript.run('return x + y;', { x: 10, y: 20 });
// → 30

// With timeout (5 seconds) and operation limit (1 million)
var result = await SafeScript.run(source, scope, { timeout: 5000, maxOps: 1000000 });

// Infinite loop is caught by __check()
await SafeScript.run('while (true) {}', {});
// → throws "SafeScript: max operations exceeded"

// Infinite recursion is caught by __check()
await SafeScript.run('function f() { return f(); } return f();', {});
// → throws "SafeScript: max operations exceeded"
```

**Implementation detail (JS target):** `__check` is passed as a function parameter to the compiled function via `buildFunction()`. The deadline and ops counter live in the closure created for each invocation.

**Implementation detail (PHP target):** `__check()` reads `$GLOBALS['__safescript_deadline']` and `$GLOBALS['__safescript_ops']`. These are set before execution and cleaned up in a `finally` block.

### Hooks (Resource Throttling)

The host can intercept every call to injected scope functions by passing `hooks` in the options:

```javascript
var result = await SafeScript.run(source, scope, {
  hooks: {
    beforeCall: function(info) { /* ... */ },
    afterCall: function(info) { /* ... */ }
  }
});
```

Hooks work by wrapping every callable in the scope object with a proxy function that calls `beforeCall` before the real function and `afterCall` after.

**`beforeCall(info)`** receives an info object and can:
- Return `false` → block the call entirely (returns `undefined`)
- Return `{ value: x }` → short-circuit, return `x` without calling the real function
- Return `{ args: [...] }` → transform the arguments, then call the real function
- Return anything else (including `undefined`) → proceed normally

**`afterCall(info)`** receives an info object (with `result` added) and can:
- Return `false` → suppress the result (returns `undefined`)
- Return `{ value: x }` → replace the result with `x`
- Return anything else → pass through the original result

**JS info object:** `{ name, args, callCount, elapsed }` (plus `result` in `afterCall`). `name` is the dotted path (e.g. `"db.query"`), `callCount` is the total across all hooked functions, `elapsed` is milliseconds since execution started.

**PHP hook signature:** `beforeCall($name, $args)`, `afterCall($name, $result, $args)`. Return conventions are the same.

Hooks are the primary mechanism for resource throttling — the host intercepts calls to injected methods and enforces limits on data size, call count, memory usage, or any other resource at the boundary:

```javascript
var callCounts = {};
var result = await SafeScript.run(source, scope, {
  hooks: {
    beforeCall: function(info) {
      callCounts[info.name] = (callCounts[info.name] || 0) + 1;
      if (callCounts[info.name] > 100) {
        return false; // block after 100 calls to any single function
      }
    },
    afterCall: function(info) {
      if (info.result && info.result.length > 10000) {
        return { value: info.result.slice(0, 10000) }; // cap result size
      }
    }
  }
});
```

### Error Handling

Uncaught exceptions cause the Promise returned by `SafeScript.run()` to reject. The host catches errors with standard `.catch()` or `try`/`catch` around `await`. SafeScript code cannot install its own `unhandledRejection` listener (no access to `process` or `window`), so the host stays in control of error handling.

```javascript
try {
  var result = await SafeScript.run(source, scope);
} catch (e) {
  // handle error — compile error, runtime error, or timeout
}
```

### Host-Level Composition

SafeScript has no `import` or `export` — composition happens entirely at the host level. A SafeScript file is a self-contained unit. The host composes SafeScript units by running one and injecting its result into another's scope:

```javascript
// Compose SafeScript modules at the host level
var utils = await SafeScript.run(utilsSource, { Math });
var result = await SafeScript.run(handlerSource, { utils, db, request });
```

This pattern supports libraries of pure functions:

```javascript
// utils.safe — returns an object with helper functions
function clamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
return { clamp: clamp, lerp: lerp };
```

```javascript
// handler.safe — uses the utils library via injection
var clamped = utils.clamp(input.value, 0, 100);
var interpolated = utils.lerp(0, clamped, 0.5);
return { result: interpolated };
```

The host controls the dependency graph. This is a deliberate design choice:

1. **Security.** The host decides what each SafeScript unit can access. A utility library gets `Math`; a handler gets `utils` and `db`. No SafeScript unit can reach beyond what the host provides.
2. **Portability.** The composition mechanism is host-native (JavaScript `await`, PHP function calls), not a SafeScript language feature. Different targets compose the same way.
3. **Simplicity.** No module resolution, no import maps, no circular dependency detection. The host runs things in order and passes results forward.

## What Remains: The Allowed Subset

Since SafeScript is defined by a whitelist, here are the constructs that are available. These work exactly as they do in JavaScript — SafeScript doesn't change their semantics.

### Declarations

`var`, `let`, `const` — with destructuring patterns (array and object), default values, rest elements, and nested patterns.

### Control Flow

`if` / `else`, `for`, `for-in`, `for-of`, `while`, `do-while`, `switch` / `case` / `default`, `break`, `continue`, `return`, labeled statements, `try` / `catch` / `finally`, `throw`.

### Functions

Function declarations, function expressions, arrow functions (`=>`), default parameters, rest parameters (`...args`). All functions are automatically compiled as `async` — the source code does not use the `async` keyword.

### Operators

All arithmetic (`+`, `-`, `*`, `/`, `%`, `**`), comparison (`==`, `===`, `!=`, `!==`, `<`, `>`, `<=`, `>=`), logical (`&&`, `||`, `!`), bitwise (`&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`), assignment (`=`, `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&&=`, `||=`, `??=`, `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`), unary (`typeof`, `void`, `+`, `-`, `~`, `!`), ternary (`? :`), comma, `instanceof`, nullish coalescing (`??`), optional chaining (`?.`).

### Expressions

Property access (dot notation), method calls, array literals, object literals (including computed property names, shorthand, and spread), spread in arrays and function calls, sequence expressions, grouping.

### Literals

Strings (single and double quoted, with standard escape sequences), numbers (decimal, hex `0x`, binary `0b`, octal `0o`, BigInt `n` suffix, underscores `1_000`), regular expressions, `true`, `false`, `null`, `undefined`.

### Destructuring

Array patterns (`var [a, b] = arr`), object patterns (`var {x, y} = obj`), rest elements (`var [first, ...rest] = arr`), default values (`var {x = 0} = obj`), nested patterns, and destructuring in function parameters.

### Spread

Array spread (`[...arr1, ...arr2]`), object spread (`{...obj1, ...obj2}`), argument spread (`fn(...args)`).

## Compatibility

SafeScript compiled output always uses `async`/`await` (the auto-async model), which requires an **ES2017+ (ES8)** runtime environment at minimum. The compiled output uses:

- `"use strict"` — ES5+
- Arrow functions in source → emitted as async arrows (ES2017+)
- `async`/`await` — always emitted by the compiler (ES2017+)
- `??` and `?.` in source → emitted as-is (ES2020+)

For the JavaScript target, any modern browser or Node.js 8+ supports async/await. For the PHP target, the compiled output is synchronous PHP and has no version requirement beyond PHP 7.0.

The compiler does not transpile post-ES2017 syntax. A host targeting environments that lack `??` or `?.` should validate that submitted `.safe` files only use the features its runtime supports.

## Security Model

SafeScript's security is defense in depth, with four independent barriers:

1. **Static analysis (compile time):** The tokenizer and parser reject blocked keywords and identifiers. The AST validator rejects blocked property access patterns, generators, and other disallowed constructs. This is the first barrier — most attacks never get past it.

2. **Runtime property guards:** Computed property access goes through `__at`/`__set`, which block prototype-chain properties even when the key is computed dynamically. This catches attacks that construct blocked property names at runtime (`"construct" + "or"`).

3. **Global shadowing:** Every known global is declared as `undefined` in the compiled wrapper. Only values the host injects are accessible. Even if an attacker somehow references a global that wasn't caught by barriers 1 and 2, it resolves to `undefined`.

4. **Execution guards and hooks:** Compile-time injected `__check()` calls enforce timeout and operation limits, preventing infinite loops and infinite recursion. Hooks intercept every call to injected scope functions, letting the host throttle resource consumption at the boundary. Hardcoded ceilings (60s timeout, 100M ops) apply even when the host doesn't set limits.

The object-capability model means SafeScript code has exactly the power the host gives it, and no more. With an empty scope, SafeScript is pure computation.

## Examples

See [Examples.md](Examples.md) for a comprehensive collection of SafeScript code demonstrating every major feature.

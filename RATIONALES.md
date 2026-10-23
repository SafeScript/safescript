# SafeScript Design Rationales

## Why auto-async?

**Problem**: When a host injects async methods (e.g. `db.get()` returning a Promise), SafeScript users had to know which methods were async and manually `await` them. Forgetting an `await` produced a Promise object instead of the expected value — a common, silent bug.

**Solution**: The compiler emits every function as `async` and wraps every call expression with `await`. This means:
- SafeScript source never contains `async` or `await` — they're blocked keywords
- Every injected Promise resolves automatically at every call site
- Code reads naturally: `var user = db.get(1);` works whether `db.get` is sync or async
- Sequential execution is guaranteed — no concurrent in-flight operations

**Trade-off**: Every call is awaited, even synchronous ones. In practice this is negligible — `await syncValue` resolves in the same microtick. The simplicity gain (no async/await leaking into user-authored code) vastly outweighs the micro-overhead.

**PHP parity**: PHP is naturally synchronous. The auto-async model means the same SafeScript source runs identically in both JS (where calls are auto-awaited) and PHP (where calls are synchronous by default). No source changes needed.

## Why block async/await keywords?

If SafeScript allowed `async`/`await` as keywords, users could write:
- `async function f() {}` — redundant, since all functions are already async
- `await someCall()` — redundant, since all calls are already awaited

Allowing them would create two ways to do the same thing, with confusing interactions. Blocking them keeps the language clean and the auto-async model invisible to the author.

## Why `{ timeout: N }` instead of `{ async: true }`?

The old API had `{ async: true }` to opt into returning a Promise. With auto-async, `run()` always returns a Promise, making the flag meaningless. The replacement is `{ timeout: N }` — a useful runtime control that uses `Promise.race` to abort long-running scripts.

## Why host-level composition instead of import?

**Problem**: `import`/`require` creates a dependency graph that SafeScript can't verify. A `.safe` file that `require`s arbitrary npm packages inherits their attack surface.

**Solution**: Composition happens at the host level:
```js
var utils = await SafeScript.run(utilsSource, { Math });
var result = await SafeScript.run(handlerSource, { utils, db });
```

Each `.safe` file declares what it needs in its header, and the host provides it. The host controls the dependency graph. This preserves SafeScript's security guarantee: every `.safe` file is self-contained and verifiable by reading the header.

## Why `.safe` files declare capabilities instead of importing them?

A `.safe` file with `@needs fetch: http.Fetch` works everywhere a host can provide an HTTP client — Node.js, browsers, edge workers, embedded systems. The host resolves the implementation; the script declares the interface.

This avoids:
- Supply chain attacks (no npm packages, no `node_modules`)
- Platform lock-in (no `require('fs')` that only works in Node)
- Implicit globals (no `window.fetch` that only works in browsers)

## Why no `new`, `class`, `delete`?

- `new` + `class` enable prototype chain manipulation, which is a key attack vector
- `delete` can remove properties from injected objects, mutating the host's state in unexpected ways
- SafeScript favors factory functions and object literals, which are safer and sufficient for computation

## Why shadow all globals?

Even after blocking dangerous identifiers (`eval`, `Function`, `window`), there are hundreds of global names in JavaScript. Rather than maintaining an ever-growing blocklist, SafeScript shadows every known global as `undefined` inside the compiled function. Only names explicitly injected via the scope are accessible.

This turns the security model inside out: instead of "block the dangerous things" (which is fragile), it's "allow only what's explicitly provided" (which is robust).

## Why bracket access rewriting?

`obj["constructor"]` bypasses dot-access checks. Rather than blocking all computed property access (which would break arrays), SafeScript rewrites `obj[key]` to `__at(obj, key)`, which blocks dangerous property names at runtime. This works even when the key is computed dynamically.

## Why `return` instead of implicit last-expression?

`return` makes intent explicit. A `.safe` file that returns a value does so clearly. A file with no `return` has no return value. This is important for readability — when reading a `.safe` file, you know exactly what it produces.

## Why a custom parser instead of using Acorn/Babel?

1. **Size**: The SafeScript parser is ~31 KB. Acorn is ~60 KB. Babel is 500+ KB.
2. **Control**: The parser rejects blocked tokens at the tokenization stage, before any AST is built. This is the first security barrier and it needs to be correct.
3. **No dependency risk**: The parser is part of SafeScript itself, not a third-party package.
4. **Output control**: The AST is reconstructed from scratch — the original source text never appears in the output, preventing injection attacks.

# Changelog

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

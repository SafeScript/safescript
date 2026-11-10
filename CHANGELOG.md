# Changelog

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

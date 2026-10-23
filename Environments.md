# SafeScript — Environments & Use Cases

Where SafeScript runs, what it replaces, and why it's better.

## The Core Proposition

SafeScript is a safe computational subset of JavaScript — "JSON for code." Any developer who knows JavaScript already knows SafeScript. The compiler is 9 KB gzipped, runs anywhere JavaScript runs, and the compiled output is plain JavaScript. There's nothing to install on the client, no VM to spin up, no container to manage.

The safety model is simple: the grammar is the allowlist. If a construct isn't in the SafeScript spec, the compiler rejects it. Four independent barriers protect the host: (1) token/grammar allowlist, (2) global shadowing + strict mode, (3) runtime property guards, (4) execution guards + hooks. The host injects capabilities via scope — the script can only do what you give it access to do.

---

## Environments

### 1. Multi-Tenant SaaS Platforms

**The scenario.** You run a platform where tenants (customers, organizations, teams) need custom business logic — route handlers, webhook processors, form validators, access-control rules, pricing formulas, approval workflows. Each tenant's logic is different and changes frequently.

**What people do today.** `eval()` (unsafe). `vm2` or `isolated-vm` (Node.js only, heavyweight, `vm2` has known escapes). Custom DSLs (expensive to build, limited, nobody knows the syntax). Hardcoded per-tenant branches (doesn't scale). Ship it to a Lambda per tenant (cold starts, deployment complexity, cost).

**SafeScript instead.** Each tenant writes SafeScript. The platform injects a scoped API per tenant — `{ db, email, billing, currentUser }` — and runs it in-process. The script literally cannot access anything not in its scope. Hooks let you throttle per-tenant: cap database queries, limit response sizes, enforce rate limits. No separate process, no container, no cold start. The same script runs server-side (Node.js or PHP) and client-side (browser) for preview/validation.

**Concrete examples:**
- Shopify-style platforms: custom shipping rules, discount logic, checkout validators per merchant
- Zapier/n8n-style automation: user-defined transform steps between triggers and actions
- Salesforce-style CRM: custom field calculations, validation rules, workflow triggers
- Stripe-style billing: custom pricing formulas, usage metering logic, dunning rules

### 2. AI Agent Tool Execution

**The scenario.** An LLM generates code to accomplish a task — calling APIs, processing data, making decisions. You need to execute that code safely without giving the model access to your filesystem, network, or process.

**What people do today.** Docker containers per execution (slow, expensive). Restricted Python interpreters (incomplete sandboxing). Trust the model not to do anything bad (naive). Don't let the model write code at all (limiting).

**SafeScript instead.** The LLM generates SafeScript. You inject exactly the capabilities the agent needs — `{ fetchUrl, readDocument, sendEmail }` — and nothing else. The agent can compose these capabilities however it wants, but it physically cannot access the filesystem, spawn processes, or reach the network directly. Hooks let you audit every API call the agent makes, enforce budgets, and kill execution if the agent goes off-rails. The 60-second ceiling means a confused agent can't run forever.

**Why this matters.** The agent gets Turing-complete expressiveness with zero trust. You don't need to parse or understand the agent's code — the sandbox makes the code safe by construction. The hooks give you an audit trail of every external action.

### 3. Browser Plugin / Extension Systems

**The scenario.** Your web application supports user-authored plugins, extensions, or custom behaviors. Users want to add logic — event handlers, UI customizations, data transforms — without you having to review and deploy each one.

**What people do today.** iframes with postMessage (latency, no shared state, complex). Web Workers (no DOM access, async-only communication). `eval()` with CSP exceptions (unsafe). No extensibility at all (limiting).

**SafeScript instead.** User scripts run in the main thread with injected scope. You expose `{ dom, events, store, api }` — a controlled surface of your application. The script can't access `window`, `document`, `fetch`, or any global directly. And critically, it can't hang the main thread — `__check()` guards are injected into every loop and function body at compile time, so an infinite loop or runaway recursion in user code is caught and terminated within milliseconds, not when the browser's "page unresponsive" dialog finally appears. The compiler is 9 KB — ship it with your app, compile and verify on the client. If the server compiled it, the client can re-verify (the compiler is deterministic) or just trust the hash.

**Concrete examples:**
- Notion-style tools: user-defined formulas, computed properties, database views
- Figma-style plugins: custom generators, layout algorithms, data importers
- Airtable-style apps: scripting blocks, automations, custom field types
- Discourse/forum platforms: user-authored content transforms, moderation rules

### 4. CMS and Website Builders

**The scenario.** A content management system or website builder needs to support dynamic content — computed fields, conditional rendering, form validation, content transforms — written by site authors who aren't developers.

**What people do today.** Handlebars/Mustache (logic-less, extremely limited). Liquid (Shopify's DSL — yet another language to learn). Twig (PHP only). Custom expression parsers (fragile, limited). Full JavaScript with sanitization attempts (unsafe).

**SafeScript instead.** Authors write familiar JavaScript syntax for their logic. The platform injects content helpers — `{ page, user, site, format }` — and the script produces computed values, validation results, or content transforms. Works identically on the server (Node.js or PHP) and in the browser for live preview. No new syntax to learn, no expression parser to maintain.

### 5. Workflow and Integration Engines

**The scenario.** An integration platform connects services — CRMs, databases, APIs, file systems. Between the trigger and the action, users need to transform data: rename fields, filter records, compute values, format outputs.

**What people do today.** JSONata or JMESPath (limited to data querying). Custom node-based UIs (expensive to build, limited expressiveness). Python/JavaScript in containers (heavyweight). No-code mapping UIs (break on complex transforms).

**SafeScript instead.** The transform step is SafeScript. The platform injects the trigger payload and target schema — `{ input, output, lookup, format }` — and the user writes the mapping logic in plain JavaScript syntax. Loops, conditionals, string manipulation, array methods — all available. Hooks enforce payload size limits and API call budgets. The same transform runs in the browser for testing and on the server for execution.

### 6. Game Engines — Modding and Scripting

**The scenario.** A game engine needs a scripting layer for NPC behavior, quest logic, mod support, or user-generated content. Scripts run in the game loop and must not be able to crash the engine, access the filesystem, or hang the process.

**What people do today.** Lua (ubiquitous but a different language — bridging is complex). Custom DSLs (expensive, limited, documentation burden). GDScript (Godot-specific). Full JavaScript via embedded V8 (heavyweight, security concerns).

**SafeScript instead.** If your engine runs JavaScript (browser games, Electron, Node.js game servers, or QuickJS-embedded), SafeScript is the scripting layer. Modders write familiar JS syntax. You inject game APIs — `{ entity, world, inventory, dialog }` — and the script can only interact through those APIs. The `__check()` guards prevent scripts from hanging the game loop. The `safescript-quickjs` bundle lets you embed SafeScript anywhere you'd embed Lua, with the advantage that every web developer already knows the syntax.

### 7. IoT and Embedded Devices

**The scenario.** A device (sensor, gateway, controller, appliance) needs scriptable behavior — rules, schedules, transforms, decision logic — that end users or integrators can customize without reflashing firmware.

**What people do today.** Lua (traditional choice). MicroPython (Python on microcontrollers). Custom rule engines (limited). Fixed firmware with configuration files (inflexible).

**SafeScript instead.** Via the `safescript-quickjs` bundle, SafeScript compiles to a standalone C-embeddable package. The runtime is tiny. You inject device capabilities — `{ sensor, actuator, timer, config }` — and the user script controls behavior within those bounds. The timeout ceiling prevents scripts from blocking the device's main loop. The same script syntax works on the device, in the cloud gateway, and in the browser configuration UI.

### 8. Education Platforms

**The scenario.** Students write code as part of assignments, exercises, or interactive tutorials. The platform needs to execute student code safely — no filesystem access, no network, no process spawning, no infinite loops.

**What people do today.** Docker containers per submission (slow, expensive at scale). Judge0 or similar code execution services (external dependency, latency). iframe sandboxes (limited feedback). Pyodide/Skulpt for Python (different language, heavyweight runtime).

**SafeScript instead.** Student code runs in-process in the browser or on the server. You inject assignment-specific APIs — `{ test, assert, draw, animate }` — and the student's code runs against them. The `__check()` guards catch infinite loops instantly (no waiting for a container timeout). The hooks let you count operations for grading or complexity analysis. The compiler's error messages point at the student's source, not at generated code.

### 9. PHP Applications

**The scenario.** A PHP application — WordPress plugin, Laravel app, Symfony service, legacy system — needs safe user-authored logic. PHP's `eval()` is unrestricted. There's no `vm2` equivalent for PHP.

**What people do today.** `eval()` (terrifying). Twig (templating, not computation). Symfony ExpressionLanguage (limited). Shell out to a sandboxed process (complex, slow). Don't allow user logic at all (limiting).

**SafeScript instead.** The `safescript-php` package compiles SafeScript to PHP and executes it in-process. Same grammar, same safety model, same four barriers. The PHP emitter generates PHP code that uses PHP's own constructs — no FFI, no external process, no extension required. Hooks let you intercept database calls, API requests, file operations — whatever you injected into scope. The timeout uses `microtime(true)` for millisecond precision.

**Why this is significant.** PHP has no good sandboxing story. SafeScript fills that gap completely. The same `.safe` file runs on both your Node.js frontend tooling and your PHP backend.

### 10. API Gateways and Middleware

**The scenario.** An API gateway needs programmable request/response transforms — header manipulation, body rewriting, authentication logic, rate limiting decisions, routing rules. Different APIs or tenants need different logic.

**What people do today.** Nginx Lua modules (operational complexity). Envoy WASM filters (complex toolchain). Kong plugins in Lua (another language). Express middleware in full Node.js (no isolation between tenants).

**SafeScript instead.** The `safescript-express` middleware runs `.safe` files as Express route handlers. Each handler gets a scoped API — `{ req, res, db, cache }` — and can't access the Express app, other routes, or the process. Different tenants get different scope objects with different capabilities. Hooks enforce per-tenant rate limits and payload size caps. A buggy or malicious handler can't hang the request pipeline — `__check()` guards terminate runaway logic before it blocks other requests. The handler is a file on disk — deploy by copying a `.safe` file, no restart needed (with the loader).

### 11. Spreadsheet and Low-Code Formulas

**The scenario.** A spreadsheet, database, or low-code platform needs user-defined formulas and computed columns. Excel-style formula languages are limited. Users want conditionals, loops, string operations, data lookups.

**What people do today.** Custom formula parsers (Excel-like syntax, limited, expensive to maintain). Python cells (Jupyter-style, no sandboxing). No-code expression builders (drag-and-drop, break on complexity).

**SafeScript instead.** Each formula is a SafeScript expression or function. You inject row context and lookup functions — `{ row, column, lookup, sum, count }` — and the formula computes the value. Familiar syntax means users write `if (row.status === "active") { return row.revenue * 0.1; }` instead of learning a proprietary formula language. A bad formula can't freeze the UI — `__check()` guards catch infinite loops and runaway recursion at the source level, so the recalculation engine stays responsive even when a user writes `while (true) {}`.

### 12. Email and Notification Templates

**The scenario.** A platform sends emails, push notifications, or SMS with dynamic content — personalized greetings, conditional sections, computed values, formatted dates. The templates are authored by marketing teams or tenant admins.

**What people do today.** Handlebars/Mustache (no real logic). Liquid (Shopify's choice, another syntax). MJML with limited expressions. Custom template DSLs (yet another language).

**SafeScript instead.** Template logic sections are SafeScript blocks. You inject the data context — `{ user, order, format, translate }` — and the script produces the dynamic content. Full conditionals, loops over collections, string formatting, date math — all in familiar syntax. The host controls what the template can access through scope, and hooks can audit what data the template actually reads.

### 13. Browser-Side Form Validation

**The scenario.** Complex form validation logic — cross-field rules, async lookups, conditional requirements — needs to run both client-side (for instant feedback) and server-side (for security). Maintaining two implementations is expensive and error-prone.

**What people do today.** Duplicate logic in JavaScript and the server language. JSON Schema (limited to structural validation). Server-only validation (bad UX). Client-only validation (insecure).

**SafeScript instead.** Validation rules are `.safe` files. They run in the browser via the `safescript-loader` (for instant feedback) and on the server via Node.js or PHP (for authoritative validation). Same code, same result, zero duplication. You inject field values and lookup functions — `{ fields, lookup, validate }` — and the script returns validation errors. The compiler runs client-side too, so tampered scripts are caught before they execute.

### 14. Configuration as Code

**The scenario.** A system's behavior is driven by configuration that's more complex than key-value pairs — conditional feature flags, computed settings, environment-specific overrides, dynamic routing rules. YAML and JSON are too static. Full code is too dangerous.

**What people do today.** YAML with templating (Helm, Jsonnet — complex, error-prone). HCL (HashiCorp-specific). Rego/OPA (policy-specific DSL). Full scripting with manual review (doesn't scale).

**SafeScript instead.** Configuration logic is SafeScript. You inject the context — `{ env, request, user, features }` — and the script returns the computed configuration. Version-controlled `.safe` files. Deterministic, testable, auditable. The host can't be compromised by a bad config because the script can only read what you injected.

### 15. Data Pipeline Transforms

**The scenario.** An ETL or data pipeline needs user-defined transforms — cleaning, normalization, enrichment, aggregation. Different data sources need different logic. Data engineers want to write transforms quickly without a deployment cycle.

**What people do today.** SQL UDFs (limited). PySpark (heavyweight). dbt macros (Jinja templating, fragile). Custom operator frameworks (high overhead per transform).

**SafeScript instead.** Each transform step is a `.safe` file. You inject the record and pipeline utilities — `{ record, emit, lookup, format, aggregate }` — and the script transforms the data. Hooks enforce row-count limits, output size caps, and processing budgets. The same transform can run in a browser-based preview, in a Node.js pipeline, or in a PHP batch processor.

---

## Benefits vs Current Approaches

| Approach | Problem | SafeScript Advantage |
|---|---|---|
| `eval()` | Unrestricted access to everything | Grammar allowlist — can't even express dangerous constructs |
| `vm2` / `isolated-vm` | Node.js only, known escapes, heavyweight | In-process, cross-platform (browser + Node + PHP), no known escapes by design |
| Docker / containers | Cold start latency, per-execution cost, operational complexity | Zero overhead, in-process, millisecond startup |
| Web Workers | Async-only communication, no shared scope, no DOM access | Synchronous scope injection, runs in main thread, can't hang it |
| iframes | postMessage overhead, complex state management | Direct function calls via scope, no serialization |
| Lua | Different language, bridging complexity, learning curve | Every web developer already knows the syntax |
| Custom DSLs | Expensive to build, limited, documentation burden, learning curve | Turing complete, familiar syntax, zero learning curve for JS developers |
| WASM sandboxes | Complex toolchain, language compilation step | Source is text, compiler is 9 KB, runs anywhere JS runs |
| JSON Schema / JSONata | Limited to data validation / querying, no general computation | Full computation — loops, functions, closures, composition |
| Template languages (Handlebars, Liquid, Twig) | No real logic, or limited/proprietary logic syntax | Full JavaScript computation within the safety boundary |

---

## The Host-Level Composition Pattern

SafeScript has no imports, no require, no module system. This is deliberate. The host composes capabilities:

```javascript
// Build a utility library from SafeScript
var utils = await SafeScript.run(utilsSource, {});

// Give the handler access to utils + platform APIs
var result = await SafeScript.run(handlerSource, {
  utils: utils,
  db: db,
  cache: cache,
  http: http
}, {
  timeout: 5000,
  hooks: {
    beforeCall: function(info) {
      // Enforce per-tenant rate limits
      if (tenantQuota.exceeded(info.name)) {
        throw new Error('Rate limit exceeded for ' + info.name);
      }
    },
    afterCall: function(info) {
      // Cap response sizes
      if (info.result && JSON.stringify(info.result).length > 1048576) {
        return { value: null }; // Replace oversized result with null
      }
    }
  }
});
```

The host decides what each script can do. Different scripts get different scopes. The same script can get different scopes in different contexts (admin vs user, production vs staging, tenant A vs tenant B). No code changes needed — just different scope objects.

---

## Cross-Platform Story

A single `.safe` file runs on:

- **Node.js** — via `safescript` (npm), full async support, Promise-based
- **PHP** — via `safescript-php` (Composer), synchronous execution, same safety model
- **Browser** — via `safescript-loader` (script tag) or the browser bundle, same compiler, client-side verification
- **QuickJS / Duktape** — via `safescript-quickjs`, C-embeddable, replaces Lua in any native application
- **Express** — via `safescript-express`, directory-based routing with `.safe` files as handlers
- **CLI** — via `safescript-cli`, run/validate/compile/inspect from the command line

Same source, same safety guarantees, six deployment targets.

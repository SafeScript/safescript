# SafeScript Examples

A kitchen-sink collection of SafeScript code, from basics to real-world patterns. Every example here is valid SafeScript and runs through `SafeScript.run()`.

## Basics

### Variables and Arithmetic

```javascript
var x = 10;
var y = 20;
var sum = x + y;
var product = x * y;
var power = 2 ** 10;  // 1024
sum + product + power;
```

### Strings

```javascript
var greeting = "Hello";
var name = "world";
var message = greeting + ", " + name + "!";
var upper = message.toUpperCase();
var len = message.length;
var first = message[0];   // "H" — bracket access on primitives works fine
var sub = message.slice(0, 5);
message;
```

### Multiple Return Values via Objects

```javascript
var a = 3, b = 4;
var result = {
  sum: a + b,
  product: a * b,
  hypotenuse: Math.sqrt(a * a + b * b)
};
result;
```

Scope: `{ Math: Math }`

## Control Flow

### If / Else

```javascript
var score = 85;
var grade;
if (score >= 90) {
  grade = "A";
} else if (score >= 80) {
  grade = "B";
} else if (score >= 70) {
  grade = "C";
} else {
  grade = "F";
}
grade;
```

### Switch

```javascript
var day = "Tuesday";
var type;
switch (day) {
  case "Saturday":
  case "Sunday":
    type = "weekend";
    break;
  case "Monday":
  case "Friday":
    type = "bookend";
    break;
  default:
    type = "midweek";
}
type;
```

### Ternary and Nullish Coalescing

```javascript
var input = null;
var value = input ?? "default";        // "default"
var label = value === "default" ? "using fallback" : "using input";
label;
```

### Optional Chaining

```javascript
var user = { profile: { name: "Alice" } };
var name = user?.profile?.name;        // "Alice"
var missing = user?.settings?.theme;   // undefined
name;
```

## Loops

### For Loop

```javascript
var nums = [3, 1, 4, 1, 5, 9, 2, 6];
var max = nums[0];
for (var i = 1; i < nums.length; i = i + 1) {
  if (nums[i] > max) max = nums[i];
}
max;  // 9
```

### While Loop

```javascript
var n = 1;
var count = 0;
while (n < 1000) {
  n = n * 2;
  count = count + 1;
}
count;  // 10 — it takes 10 doublings to pass 1000
```

### Do-While

```javascript
var digits = [];
var num = 12345;
do {
  digits[digits.length] = num % 10;
  num = Math.floor(num / 10);
} while (num > 0);
digits.reverse();
digits;  // [1, 2, 3, 4, 5]
```

Scope: `{ Math: Math }`

### For-In (Object Keys)

```javascript
var prices = { apple: 1.20, banana: 0.50, cherry: 2.00 };
var total = 0;
for (var fruit in prices) {
  total = total + prices[fruit];
}
total;  // 3.70
```

### For-Of (Array Values)

```javascript
var words = ["safe", "script", "is", "javascript"];
var lengths = [];
for (var word of words) {
  lengths[lengths.length] = word.length;
}
lengths;  // [4, 6, 2, 10]
```

### Labeled Break

```javascript
var matrix = [[1, 2], [3, 4], [5, 6]];
var found = false;
outer:
for (var i = 0; i < matrix.length; i = i + 1) {
  for (var j = 0; j < matrix[i].length; j = j + 1) {
    if (matrix[i][j] === 4) {
      found = true;
      break outer;
    }
  }
}
found;  // true
```

## Functions

### Function Declaration

```javascript
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(10);  // 3628800
```

### Function Expression

```javascript
var fib = function(n) {
  if (n <= 1) return n;
  var a = 0, b = 1;
  for (var i = 2; i <= n; i = i + 1) {
    var temp = b;
    b = a + b;
    a = temp;
  }
  return b;
};
fib(20);  // 6765
```

### Arrow Functions

```javascript
var double = (x) => x * 2;
var add = (a, b) => a + b;
var greet = (name) => {
  var msg = "Hello, " + name;
  return msg + "!";
};

var result = {
  doubled: double(21),
  sum: add(10, 20),
  greeting: greet("SafeScript")
};
result;
```

### Default Parameters

```javascript
function pad(str, width = 10, char = " ") {
  while (str.length < width) {
    str = char + str;
  }
  return str;
}
pad("42", 6, "0");  // "000042"
```

### Rest Parameters

```javascript
function sum(...nums) {
  var total = 0;
  for (var n of nums) {
    total = total + n;
  }
  return total;
}
sum(1, 2, 3, 4, 5);  // 15
```

### Closures

```javascript
// Closures capture variables from enclosing scope.
// Here `count` is private — no way to access it except through the returned functions.
function makeCounter(start) {
  var count = start;
  return {
    next: function() { count = count + 1; return count; },
    value: function() { return count; }
  };
}
var a = makeCounter(0);
var b = makeCounter(10);
a.next();  // 1
a.next();  // 2
b.next();  // 11
a.value(); // 2  — each closure has its own `count`
b.value(); // 11

// Closures over loop variables — classic gotcha
function makeAdders(n) {
  var adders = [];
  for (var i = 0; i < n; i = i + 1) {
    // Use an IIFE to capture `i` by value, since `var` is function-scoped
    adders[adders.length] = (function(captured) {
      return function(x) { return x + captured; };
    })(i);
  }
  return adders;
}
var add = makeAdders(3);
add[0](100);  // 100
add[1](100);  // 101
add[2](100);  // 102

// Or use `let` — block-scoped, so each iteration gets its own binding
function makeMultipliers(n) {
  var fns = [];
  for (let i = 1; i <= n; i = i + 1) {
    fns[fns.length] = function(x) { return x * i; };
  }
  return fns;
}
var mul = makeMultipliers(3);
mul[0](10);  // 10
mul[1](10);  // 20
mul[2](10);  // 30
```

### Higher-Order Functions

```javascript
function map(arr, fn) {
  var result = [];
  for (var i = 0; i < arr.length; i = i + 1) {
    result[result.length] = fn(arr[i], i);
  }
  return result;
}

function filter(arr, fn) {
  var result = [];
  for (var i = 0; i < arr.length; i = i + 1) {
    if (fn(arr[i], i)) result[result.length] = arr[i];
  }
  return result;
}

function reduce(arr, fn, init) {
  var acc = init;
  for (var i = 0; i < arr.length; i = i + 1) {
    acc = fn(acc, arr[i], i);
  }
  return acc;
}

var nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
var evens = filter(nums, (n) => n % 2 === 0);
var doubled = map(evens, (n) => n * 2);
var total = reduce(doubled, (a, b) => a + b, 0);
total;  // 60
```

## Destructuring

### Array Destructuring

```javascript
var coords = [10, 20, 30];
var [x, y, z] = coords;
x + y + z;  // 60
```

### Object Destructuring

```javascript
var point = { x: 5, y: 10, label: "origin" };
var { x, y, label } = point;
label + ": " + x + "," + y;
```

### Rest in Destructuring

```javascript
var [first, second, ...rest] = [1, 2, 3, 4, 5];
rest;  // [3, 4, 5]
```

### Nested Destructuring

```javascript
var data = {
  user: { name: "Alice", scores: [90, 85, 92] }
};
var { user: { name, scores: [first, ...others] } } = data;
var result = { name: name, first: first, others: others };
result;
```

### Default Values in Destructuring

```javascript
var { host, port = 8080, protocol = "https" } = { host: "example.com" };
var url = protocol + "://" + host + ":" + port;
url;  // "https://example.com:8080"
```

### Destructuring in Parameters

```javascript
function formatUser({ name, role = "user" }) {
  return name + " (" + role + ")";
}
formatUser({ name: "Alice", role: "admin" });  // "Alice (admin)"
```

## Spread

### Array Spread

```javascript
var a = [1, 2, 3];
var b = [4, 5, 6];
var combined = [...a, ...b];
combined;  // [1, 2, 3, 4, 5, 6]
```

### Object Spread

```javascript
var defaults = { color: "blue", size: "medium", visible: true };
var overrides = { color: "red", size: "large" };
var merged = { ...defaults, ...overrides };
merged;  // { color: "red", size: "large", visible: true }
```

### Argument Spread

```javascript
function max3(a, b, c) {
  var m = a;
  if (b > m) m = b;
  if (c > m) m = c;
  return m;
}
var values = [7, 2, 9];
max3(...values);  // 9
```

## Error Handling

### Try / Catch / Finally

```javascript
function safeDivide(a, b) {
  try {
    if (b === 0) throw "division by zero";
    return { ok: true, value: a / b };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    // cleanup would go here
  }
}
var r1 = safeDivide(10, 3);
var r2 = safeDivide(10, 0);
var result = { r1: r1, r2: r2 };
result;
```

### Error Objects

```javascript
function validate(input) {
  var errors = [];
  if (!input.name) errors[errors.length] = "name required";
  if (!input.email) errors[errors.length] = "email required";
  if (input.age !== undefined && input.age < 0) {
    errors[errors.length] = "age must be non-negative";
  }
  if (errors.length > 0) {
    throw { type: "ValidationError", errors: errors };
  }
  return { valid: true };
}

try {
  validate({ name: "", age: -1 });
} catch (e) {
  e;
}
```

## Calling Injected Methods

SafeScript automatically awaits every function call in the compiled output, so calling methods on injected objects that return Promises works transparently — no `async`/`await` keywords needed.

```javascript
// @safescript 0.2
// @needs fetchData: Function

function loadAndProcess() {
  var raw = fetchData("/api/users");
  var active = [];
  for (var user of raw) {
    if (user.active) active[active.length] = user;
  }
  return active;
}

return loadAndProcess();
```

The host runs it with: `var result = await SafeScript.run(source, { fetchData: myFetch });`

Whether `fetchData` returns a Promise or a plain value, SafeScript handles it the same way. The `await` on a non-Promise is a no-op (`Promise.resolve` wraps it), so synchronous and asynchronous injected methods are interchangeable.

## Host-Level Composition

SafeScript has no `import` or `require` — composition happens at the host level. Run one SafeScript to build a utility object, then inject it into the next:

```javascript
// Host code (Node.js / browser — NOT SafeScript):
const SafeScript = require('safescript');

// 1. Build a utils module from SafeScript source
var utils = await SafeScript.run(utilsSource, { Math });
// utilsSource might return { clamp, lerp, formatCurrency }

// 2. Inject utils into a handler alongside other capabilities
var result = await SafeScript.run(handlerSource, { utils, db, request });
```

This keeps each `.safe` file self-contained and independently auditable. The host controls what each script can see — a handler can't reach the database unless the host injects it.

## Regular Expressions

```javascript
var text = "Call 555-1234 or 555-5678 for info";
var pattern = /\d{3}-\d{4}/;
var match = text.match(pattern);
var hasPhone = pattern.test(text);
var cleaned = text.replace(/\d{3}-\d{4}/g, "XXX-XXXX");
var result = { match: match[0], hasPhone: hasPhone, cleaned: cleaned };
result;
```

## Typeof and Instanceof

```javascript
var values = [42, "hello", true, null, undefined, [1, 2], { a: 1 }];
var types = [];
for (var v of values) {
  types[types.length] = typeof v;
}
types;  // ["number", "string", "boolean", "object", "undefined", "object", "object"]
```

## BigInt

```javascript
var big = 9007199254740993n;
var bigger = big * 1000n;
var result = { value: bigger, isHuge: bigger > 10n ** 18n };
result;
```

## Real-World Patterns

### Request Handler

```javascript
// @safescript 0.2
// @needs request: Request
// @needs db: Database
// @uses logger: Logger

var body = request.json();

if (!body.email || body.email.indexOf("@") === -1) {
  return response.status(400).json({ error: "invalid email" });
}

if (logger) logger.log("signup", body.email);

var user = db.create("users", {
  email: body.email,
  name: body.name || "Anonymous",
  created: Date.now()
});

return response.json({ id: user.id, email: user.email });
```

### Pricing Engine

```javascript
// @safescript 0.2
// @needs items: Array
// @needs rules: Object

var subtotal = 0;
for (var item of items) {
  subtotal = subtotal + (item.price * item.quantity);
}

var discount = 0;
if (rules.bulkThreshold && subtotal > rules.bulkThreshold) {
  discount = subtotal * (rules.bulkPercent || 0.1);
}
if (rules.promoCode === "LAUNCH") {
  discount = discount + subtotal * 0.05;
}

var tax = (subtotal - discount) * (rules.taxRate || 0);
var total = subtotal - discount + tax;

var result = {
  subtotal: subtotal,
  discount: discount,
  tax: tax,
  total: total,
  itemCount: items.length
};
result;
```

### Data Transformer

```javascript
// @safescript 0.2
// @needs records: Array
// @uses schema: Object

function transformRecord(rec) {
  var out = {};
  for (var key in rec) {
    var val = rec[key];
    if (schema && schema[key]) {
      var rule = schema[key];
      if (rule === "upper" && typeof val === "string") {
        val = val.toUpperCase();
      } else if (rule === "round" && typeof val === "number") {
        val = Math.round(val);
      }
    }
    out[key] = val;
  }
  return out;
}

var output = [];
for (var rec of records) {
  output[output.length] = transformRecord(rec);
}
output;
```

Scope: `{ records: [...], schema: { name: "upper", score: "round" }, Math: Math }`

### Form Validator

```javascript
// @safescript 0.2
// @needs fields: Object
// @needs rules: Array

var errors = [];

for (var rule of rules) {
  var value = fields[rule.field];

  if (rule.required && (value === undefined || value === null || value === "")) {
    errors[errors.length] = { field: rule.field, message: rule.field + " is required" };
    continue;
  }

  if (value === undefined || value === null) continue;

  if (rule.minLength && typeof value === "string" && value.length < rule.minLength) {
    errors[errors.length] = {
      field: rule.field,
      message: rule.field + " must be at least " + rule.minLength + " characters"
    };
  }

  if (rule.pattern && typeof value === "string" && !rule.pattern.test(value)) {
    errors[errors.length] = {
      field: rule.field,
      message: rule.field + " format is invalid"
    };
  }

  if (rule.min !== undefined && typeof value === "number" && value < rule.min) {
    errors[errors.length] = {
      field: rule.field,
      message: rule.field + " must be at least " + rule.min
    };
  }
}

var result = { valid: errors.length === 0, errors: errors };
result;
```

### Recursive Tree Processing

```javascript
function flatten(node, depth = 0) {
  var result = [{ id: node.id, name: node.name, depth: depth }];
  if (node.children) {
    for (var child of node.children) {
      var sub = flatten(child, depth + 1);
      for (var item of sub) {
        result[result.length] = item;
      }
    }
  }
  return result;
}

var tree = {
  id: 1, name: "root", children: [
    { id: 2, name: "a", children: [
      { id: 4, name: "a.1" },
      { id: 5, name: "a.2" }
    ]},
    { id: 3, name: "b", children: [
      { id: 6, name: "b.1" }
    ]}
  ]
};

flatten(tree);
```

### State Machine

```javascript
function createMachine(config) {
  var state = config.initial;

  return {
    state: function() { return state; },
    send: function(event) {
      var transitions = config.states[state];
      if (transitions && transitions[event]) {
        state = transitions[event];
        return true;
      }
      return false;
    }
  };
}

var machine = createMachine({
  initial: "idle",
  states: {
    idle: { START: "running" },
    running: { PAUSE: "paused", STOP: "idle" },
    paused: { RESUME: "running", STOP: "idle" }
  }
});

machine.send("START");    // true, now "running"
machine.send("PAUSE");    // true, now "paused"
machine.send("RESUME");   // true, now "running"
machine.send("STOP");     // true, now "idle"
machine.send("PAUSE");    // false, can't pause from idle
machine.state();          // "idle"
```

### Sorting (No Array.prototype Methods Needed)

```javascript
function sort(arr) {
  var result = [];
  for (var item of arr) result[result.length] = item;

  for (var i = 0; i < result.length; i = i + 1) {
    for (var j = i + 1; j < result.length; j = j + 1) {
      if (result[j] < result[i]) {
        var temp = result[i];
        result[i] = result[j];
        result[j] = temp;
      }
    }
  }
  return result;
}

sort([5, 3, 8, 1, 9, 2, 7]);  // [1, 2, 3, 5, 7, 8, 9]
```

## Execution Guards

SafeScript injects `__check()` calls at compile time. The host doesn't need to do anything — guards are always active.

### Timeout

```javascript
// This will throw "SafeScript: execution timed out" — the __check() 
// call inside the while loop catches it
await SafeScript.run('while (true) {}', {}, { timeout: 200 });
```

### Operation Limit

```javascript
// Limit total loop iterations + function entries
await SafeScript.run(
  'var i = 0; while (true) { i = i + 1; } return i;',
  {},
  { maxOps: 1000 }
);
// → throws "SafeScript: max operations exceeded"
```

### Infinite Recursion

```javascript
// Recursive calls are caught by __check() at function entry
await SafeScript.run(
  'function f(n) { return f(n + 1); } return f(0);',
  {},
  { timeout: 500 }
);
// → throws (timeout or stack overflow — both are caught)
```

### Hardcoded Ceilings

```javascript
// Even without any options, MAX_TIMEOUT (60s) and MAX_OPS (100M) apply
// This always terminates — no host configuration needed
await SafeScript.run('while (true) {}', {});
// → throws after 60 seconds at most
```

## Hooks (Resource Throttling)

Hooks intercept calls to injected scope functions. They're set by the host, invisible to the SafeScript code.

### Rate Limiting

```javascript
// Host code — limit calls per function
var result = await SafeScript.run(
  'for (var i = 0; i < 1000; i = i + 1) { db.insert({id: i}); } return "done";',
  { db: realDb },
  {
    hooks: {
      beforeCall: function(info) {
        if (info.callCount > 50) {
          throw new Error('rate limit: max 50 DB calls per execution');
        }
      }
    }
  }
);
// → throws "rate limit: max 50 DB calls per execution"
```

### Response Size Capping

```javascript
// Truncate oversized results to prevent memory exhaustion
var result = await SafeScript.run(
  'return db.query("SELECT * FROM huge_table");',
  { db: realDb },
  {
    hooks: {
      afterCall: function(info) {
        if (Array.isArray(info.result) && info.result.length > 100) {
          return { value: info.result.slice(0, 100) };
        }
      }
    }
  }
);
// result is capped at 100 rows
```

### Selective Blocking

```javascript
// Block dangerous operations, allow safe ones
var result = await SafeScript.run(
  'db.query("SELECT 1"); db.drop("users"); return "done";',
  { db: { query: queryFn, drop: dropFn } },
  {
    hooks: {
      beforeCall: function(info) {
        if (info.name === 'db.drop') return false; // silently suppress
        // db.query proceeds normally
      }
    }
  }
);
```

### Graceful Degradation with null

```javascript
// Return null instead of calling — script gets null and can handle it
var result = await SafeScript.run(
  'var data = fetchData(); if (data === null) { return "fallback"; } return data;',
  { fetchData: realFetchFn },
  {
    hooks: {
      beforeCall: function(info) {
        if (info.name === 'fetchData') return { value: null };
      }
    }
  }
);
// → "fallback"
```

### Combined Guards + Hooks

```javascript
// Guards prevent runaway computation, hooks prevent resource abuse
var result = await SafeScript.run(source, {
  db: realDb,
  http: httpClient
}, {
  timeout: 5000,
  maxOps: 50000,
  hooks: {
    beforeCall: function(info) {
      if (info.callCount > 100) throw new Error('too many external calls');
      if (info.name === 'http.request') {
        // Only allow GET requests
        if (info.args[0].method !== 'GET') return false;
      }
    },
    afterCall: function(info) {
      // Log all external calls
      console.log(info.name + ' → ' + typeof info.result);
    }
  }
});
```

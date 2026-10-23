(function(root) {
"use strict";

// ── defs ────────────────────────────────────────────────────────
var defs = (function() {
  var exports = {};
/**
 * SafeScript — shared definitions.
 * Blocked/allowed identifiers, keywords, properties.
 */

// Blocked identifiers — rejected as identifier tokens in source.
var BLOCKED = Object.create(null);
[
  // Prototype chain
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
  // Self-reference, stack walking
  'this', 'arguments', 'callee', 'caller',
  // Code generation
  'eval', 'Function',
  // Browser globals
  'globalThis', 'window', 'document', 'navigator',
  'self', 'top', 'parent', 'frames',
  'location', 'history',
  // Metaprogramming
  'Proxy', 'Reflect', 'Symbol',
  // Network
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  // Timers
  'setTimeout', 'setInterval', 'requestAnimationFrame',
  // Node.js
  'require', 'module', 'exports', 'process',
  'global', 'Buffer', '__filename', '__dirname',
].forEach(function(k) { BLOCKED[k] = 1; });

// Blocked keywords
var BLOCKED_KW = Object.create(null);
[
  'new', 'delete', 'class', 'extends', 'super',
  'with', 'import', 'export', 'debugger', 'yield',
  'async', 'await',
].forEach(function(k) { BLOCKED_KW[k] = 1; });

// Allowed keywords
var ALLOWED_KW = Object.create(null);
[
  'var', 'let', 'const',
  'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'return', 'function',
  'try', 'catch', 'finally', 'throw',
  'switch', 'case', 'default',
  'typeof', 'void', 'in', 'of',
  'true', 'false', 'null', 'undefined',
  'instanceof',
].forEach(function(k) { ALLOWED_KW[k] = 1; });

// Blocked property names for __at / __set runtime checks
var BLOCKED_PROPS = Object.create(null);
[
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
  'caller', 'callee', 'arguments',
].forEach(function(k) { BLOCKED_PROPS[k] = 1; });

// Globals to shadow in the wrapper function
var SHADOW_STATIC = [
  'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt',
  'Function', 'Symbol', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'AggregateError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'Date', 'RegExp', 'Promise', 'JSON', 'Math', 'Intl',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'Proxy', 'Reflect',
  'eval', 'Function',
  'globalThis', 'window', 'self', 'top', 'parent', 'frames', 'global',
  'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'indexedDB',
  'alert', 'confirm', 'prompt', 'print', 'open', 'close',
  'focus', 'blur',
  'postMessage', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'CustomEvent', 'Event',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'Element', 'HTMLElement', 'Node', 'NodeList', 'DocumentFragment',
  'DOMParser', 'XMLSerializer', 'getComputedStyle', 'matchMedia',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'Request', 'Response', 'Headers', 'URL', 'URLSearchParams',
  'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'structuredClone',
  'Worker', 'SharedWorker',
  'Blob', 'File', 'FileReader', 'FileList', 'FormData',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'escape', 'unescape',
  'crypto', 'performance', 'Notification',
  'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'AbortController', 'AbortSignal',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'NaN', 'Infinity',
  'require', 'module', 'exports', '__filename', '__dirname',
  'process', 'Buffer',
  'console', 'constructor', '__proto__', 'prototype',
];

exports.BLOCKED = BLOCKED;
exports.BLOCKED_KW = BLOCKED_KW;
exports.ALLOWED_KW = ALLOWED_KW;
exports.BLOCKED_PROPS = BLOCKED_PROPS;
exports.SHADOW_STATIC = SHADOW_STATIC;

  return exports;
})();

// ── parser ──────────────────────────────────────────────────────
var parser = (function() {
  var exports = {};
/**
 * SafeScript parser — tokenizer + recursive descent → AST.
 *
 * The grammar is a subset of JavaScript/ES2020. Constructs not in the
 * grammar (new, delete, class, this, import, etc.) are parse errors.
 * The parser produces an AST loosely following the ESTree spec.
 */

// (uses outer defs)

// ── Token types ──────────────────────────────────────────────────────
var TT = {
  Ident: 'Ident',
  Number: 'Number',
  String: 'String',
  Regex: 'Regex',
  Template: 'Template',
  Keyword: 'Keyword',
  Punct: 'Punct',
  EOF: 'EOF',
};

// ── String unescape (no eval) ───────────────────────────────────────

var SIMPLE_ESCAPES = {
  'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t',
  'v': '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\'
};

/**
 * Unescape a quoted string token (including its surrounding quotes).
 * Handles standard JS escapes: \n \t \r \b \f \v \0 \' \" \\
 * Unicode: \uXXXX, \u{XXXXX}
 * Hex: \xHH
 * Line continuations: backslash + newline → empty
 * Unknown escapes: kept as-is (e.g. \w → w)
 */
function unescapeString(raw) {
  // Strip surrounding quotes
  var quote = raw[0];
  var inner = raw.slice(1, -1);
  var out = '';
  var i = 0;
  while (i < inner.length) {
    if (inner[i] !== '\\') {
      out += inner[i++];
      continue;
    }
    // Backslash escape
    i++; // skip backslash
    if (i >= inner.length) { out += '\\'; break; }
    var ch = inner[i];

    // Simple single-char escapes
    if (ch in SIMPLE_ESCAPES) {
      out += SIMPLE_ESCAPES[ch];
      i++;
      continue;
    }

    // \xHH
    if (ch === 'x') {
      var hex = inner.slice(i + 1, i + 3);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 3;
      continue;
    }

    // \uXXXX or \u{XXXXX}
    if (ch === 'u') {
      if (inner[i + 1] === '{') {
        var close = inner.indexOf('}', i + 2);
        var cp = parseInt(inner.slice(i + 2, close), 16);
        out += String.fromCodePoint(cp);
        i = close + 1;
      } else {
        var u4 = inner.slice(i + 1, i + 5);
        out += String.fromCharCode(parseInt(u4, 16));
        i += 5;
      }
      continue;
    }

    // Line continuation: \ followed by newline → skip
    if (ch === '\n') { i++; continue; }
    if (ch === '\r') {
      i++;
      if (i < inner.length && inner[i] === '\n') i++;
      continue;
    }

    // Unknown escape → just the character (e.g. \w → w)
    out += ch;
    i++;
  }
  return out;
}

// ── Tokenizer ────────────────────────────────────────────────────────

function Tokenizer(source) {
  this.source = source;
  this.pos = 0;
  this.line = 1;
  this.lineStart = 0;
  this.tokens = [];
  this.index = 0;
  this._tokenize();
}

Tokenizer.prototype._col = function() {
  return this.pos - this.lineStart + 1;
};

Tokenizer.prototype._error = function(msg, line, col) {
  var e = new SyntaxError('SafeScript: ' + msg + ' at line ' + line + ':' + col);
  e.line = line;
  e.col = col;
  throw e;
};

Tokenizer.prototype._push = function(type, value, line, col) {
  this.tokens.push({ type: type, value: value, line: line, col: col });
};

Tokenizer.prototype._tokenize = function() {
  var src = this.source, len = src.length;

  while (this.pos < len) {
    var start = this.pos;
    var line = this.line, col = this._col();
    var ch = src[this.pos];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' ||
        ch === '\v' || ch === '\f') {
      while (this.pos < len) {
        var c = src[this.pos];
        if (c === '\n') { this.line++; this.lineStart = this.pos + 1; }
        else if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\v' && c !== '\f') break;
        this.pos++;
      }
      continue;
    }

    // Single-line comment
    if (ch === '/' && this.pos + 1 < len && src[this.pos + 1] === '/') {
      while (this.pos < len && src[this.pos] !== '\n') this.pos++;
      continue;
    }

    // Multi-line comment
    if (ch === '/' && this.pos + 1 < len && src[this.pos + 1] === '*') {
      this.pos += 2;
      while (this.pos < len) {
        if (src[this.pos] === '\n') { this.line++; this.lineStart = this.pos + 1; }
        if (src[this.pos] === '*' && this.pos + 1 < len && src[this.pos + 1] === '/') {
          this.pos += 2; break;
        }
        this.pos++;
      }
      continue;
    }

    // String
    if (ch === '"' || ch === "'") {
      this._readString(ch, line, col);
      continue;
    }

    // Template literal — parse error
    if (ch === '`') {
      this._error('Template literals are not allowed in SafeScript (use string concatenation)', line, col);
    }

    // Number
    if ((ch >= '0' && ch <= '9') ||
        (ch === '.' && this.pos + 1 < len && src[this.pos + 1] >= '0' && src[this.pos + 1] <= '9')) {
      this._readNumber(line, col);
      continue;
    }

    // Identifier or keyword
    if (this._isIdentStart(ch)) {
      this._readIdent(line, col);
      continue;
    }

    // Regex (after non-expression token)
    if (ch === '/' && !this._lastIsExprEnd()) {
      this._readRegex(line, col);
      continue;
    }

    // Punctuation (multi-char first)
    if (this._readPunct(line, col)) continue;

    this._error('Unexpected character: ' + ch, line, col);
  }

  this._push(TT.EOF, '', this.line, this._col());
};

Tokenizer.prototype._isIdentStart = function(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
         ch === '_' || ch === '$';
};

Tokenizer.prototype._isIdentPart = function(ch) {
  return this._isIdentStart(ch) || (ch >= '0' && ch <= '9');
};

Tokenizer.prototype._readString = function(quote, line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  this.pos++; // opening quote
  while (this.pos < len && src[this.pos] !== quote) {
    if (src[this.pos] === '\\') {
      this.pos++;
      if (this.pos < len && src[this.pos] === '\n') { this.line++; this.lineStart = this.pos + 1; }
    }
    this.pos++;
  }
  if (this.pos >= len) this._error('Unterminated string literal', line, col);
  this.pos++; // closing quote
  this._push(TT.String, src.slice(start, this.pos), line, col);
};

Tokenizer.prototype._readNumber = function(line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  var ch = src[this.pos];

  if (ch === '0' && this.pos + 1 < len) {
    var next = src[this.pos + 1];
    if (next === 'x' || next === 'X') {
      this.pos += 2;
      while (this.pos < len && /[0-9a-fA-F_]/.test(src[this.pos])) this.pos++;
    } else if (next === 'b' || next === 'B') {
      this.pos += 2;
      while (this.pos < len && (src[this.pos] === '0' || src[this.pos] === '1' || src[this.pos] === '_')) this.pos++;
    } else if (next === 'o' || next === 'O') {
      this.pos += 2;
      while (this.pos < len && src[this.pos] >= '0' && src[this.pos] <= '7') this.pos++;
    } else {
      this._readDecimal();
    }
  } else {
    this._readDecimal();
  }

  if (this.pos < len && src[this.pos] === 'n') this.pos++; // BigInt
  this._push(TT.Number, src.slice(start, this.pos), line, col);
};

Tokenizer.prototype._readDecimal = function() {
  var src = this.source, len = src.length;
  while (this.pos < len && ((src[this.pos] >= '0' && src[this.pos] <= '9') || src[this.pos] === '_')) this.pos++;
  if (this.pos < len && src[this.pos] === '.') {
    this.pos++;
    while (this.pos < len && ((src[this.pos] >= '0' && src[this.pos] <= '9') || src[this.pos] === '_')) this.pos++;
  }
  if (this.pos < len && (src[this.pos] === 'e' || src[this.pos] === 'E')) {
    this.pos++;
    if (this.pos < len && (src[this.pos] === '+' || src[this.pos] === '-')) this.pos++;
    while (this.pos < len && ((src[this.pos] >= '0' && src[this.pos] <= '9') || src[this.pos] === '_')) this.pos++;
  }
};

Tokenizer.prototype._readIdent = function(line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  while (this.pos < len && this._isIdentPart(src[this.pos])) this.pos++;
  var word = src.slice(start, this.pos);

  // Check blocked identifiers
  if (defs.BLOCKED[word]) {
    this._error('Blocked identifier: ' + word, line, col);
  }
  // Check blocked keywords
  if (defs.BLOCKED_KW[word]) {
    this._error('Blocked keyword: ' + word, line, col);
  }

  if (defs.ALLOWED_KW[word]) {
    this._push(TT.Keyword, word, line, col);
  } else {
    this._push(TT.Ident, word, line, col);
  }
};

Tokenizer.prototype._readRegex = function(line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  this.pos++; // opening /
  while (this.pos < len && src[this.pos] !== '/') {
    if (src[this.pos] === '\\') this.pos++;
    if (this.pos < len && src[this.pos] === '[') {
      this.pos++;
      while (this.pos < len && src[this.pos] !== ']') {
        if (src[this.pos] === '\\') this.pos++;
        this.pos++;
      }
    }
    this.pos++;
  }
  if (this.pos >= len) this._error('Unterminated regex', line, col);
  this.pos++; // closing /
  while (this.pos < len && /[gimsuy]/.test(src[this.pos])) this.pos++;
  this._push(TT.Regex, src.slice(start, this.pos), line, col);
};

var PUNCT3 = { '===': 1, '!==': 1, '>>>': 1, '**=': 1, '<<=': 1, '>>=': 1,
               '&&=': 1, '||=': 1, '??=': 1, '...': 1 };
var PUNCT2 = { '==': 1, '!=': 1, '>=': 1, '<=': 1, '&&': 1, '||': 1, '??': 1,
               '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1, '**': 1,
               '++': 1, '--': 1, '=>': 1, '?.': 1, '<<': 1, '>>': 1,
               '&=': 1, '|=': 1, '^=': 1 };
var PUNCT1 = { '+': 1, '-': 1, '*': 1, '/': 1, '%': 1, '=': 1,
               '<': 1, '>': 1, '!': 1, '&': 1, '|': 1, '^': 1, '~': 1,
               '?': 1, ':': 1, ';': 1, ',': 1, '.': 1,
               '(': 1, ')': 1, '{': 1, '}': 1, '[': 1, ']': 1 };

Tokenizer.prototype._readPunct = function(line, col) {
  var src = this.source;
  if (this.pos + 2 < src.length && PUNCT3[src.slice(this.pos, this.pos + 3)]) {
    this._push(TT.Punct, src.slice(this.pos, this.pos + 3), line, col);
    this.pos += 3; return true;
  }
  if (this.pos + 1 < src.length && PUNCT2[src.slice(this.pos, this.pos + 2)]) {
    this._push(TT.Punct, src.slice(this.pos, this.pos + 2), line, col);
    this.pos += 2; return true;
  }
  if (PUNCT1[src[this.pos]]) {
    this._push(TT.Punct, src[this.pos], line, col);
    this.pos += 1; return true;
  }
  return false;
};

Tokenizer.prototype._lastIsExprEnd = function() {
  if (!this.tokens.length) return false;
  var last = this.tokens[this.tokens.length - 1];
  if (last.type === TT.Ident || last.type === TT.Number ||
      last.type === TT.String || last.type === TT.Regex) return true;
  if (last.type === TT.Keyword && (last.value === 'true' || last.value === 'false' ||
      last.value === 'null' || last.value === 'undefined')) return true;
  if (last.type === TT.Punct && (last.value === ')' || last.value === ']')) return true;
  return false;
};

// ── Parser ───────────────────────────────────────────────────────────

function Parser(source) {
  var tokenizer = new Tokenizer(source);
  this.tokens = tokenizer.tokens;
  this.pos = 0;
}

// ── Token helpers ────────────────────────────────────────────────────

Parser.prototype._cur = function() { return this.tokens[this.pos]; };

Parser.prototype._peek = function(offset) {
  return this.tokens[this.pos + (offset || 0)];
};

Parser.prototype._at = function(type, value) {
  var t = this._cur();
  if (t.type !== type) return false;
  if (value !== undefined && t.value !== value) return false;
  return true;
};

Parser.prototype._eat = function(type, value) {
  var t = this._cur();
  if (t.type !== type || (value !== undefined && t.value !== value)) {
    var expected = value ? type + ' "' + value + '"' : type;
    this._error('Expected ' + expected + ', got ' + t.type + ' "' + t.value + '"');
  }
  this.pos++;
  return t;
};

Parser.prototype._maybe = function(type, value) {
  if (this._at(type, value)) { return this.tokens[this.pos++]; }
  return null;
};

Parser.prototype._error = function(msg) {
  var t = this._cur();
  var e = new SyntaxError('SafeScript: ' + msg + ' at line ' + t.line + ':' + t.col);
  e.line = t.line;
  e.col = t.col;
  throw e;
};

Parser.prototype._loc = function() {
  var t = this._cur();
  return { line: t.line, col: t.col };
};

// ── Program ──────────────────────────────────────────────────────────

Parser.prototype.parseProgram = function() {
  var body = [];
  while (!this._at(TT.EOF)) {
    body.push(this._parseStatement());
  }
  return { type: 'Program', body: body };
};

// ── Statements ───────────────────────────────────────────────────────

Parser.prototype._parseStatement = function() {
  var t = this._cur();

  if (t.type === TT.Keyword) {
    switch (t.value) {
      case 'var': case 'let': case 'const': return this._parseVarDecl();
      case 'if': return this._parseIf();
      case 'for': return this._parseFor();
      case 'while': return this._parseWhile();
      case 'do': return this._parseDoWhile();
      case 'return': return this._parseReturn();
      case 'throw': return this._parseThrow();
      case 'try': return this._parseTry();
      case 'switch': return this._parseSwitch();
      case 'break': return this._parseBreak();
      case 'continue': return this._parseContinue();
      case 'function': return this._parseFunctionDecl();
      case 'async':
        if (this._peek(1) && this._peek(1).type === TT.Keyword &&
            this._peek(1).value === 'function') {
          return this._parseFunctionDecl();
        }
        break;
    }
  }

  if (t.type === TT.Punct && t.value === '{') return this._parseBlock();
  if (t.type === TT.Punct && t.value === ';') { this.pos++; return { type: 'EmptyStatement' }; }

  // Label or expression statement
  var expr = this._parseExpression();
  // Check for label: if expr is Identifier followed by ':'
  if (expr.type === 'Identifier' && this._maybe(TT.Punct, ':')) {
    var labelBody = this._parseStatement();
    return { type: 'LabeledStatement', label: expr, body: labelBody };
  }
  this._maybe(TT.Punct, ';');
  return { type: 'ExpressionStatement', expression: expr };
};

Parser.prototype._parseBlock = function() {
  this._eat(TT.Punct, '{');
  var body = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    body.push(this._parseStatement());
  }
  this._eat(TT.Punct, '}');
  return { type: 'BlockStatement', body: body };
};

Parser.prototype._parseVarDecl = function() {
  var kind = this._eat(TT.Keyword).value; // var, let, const
  var decls = [];
  do {
    var loc = this._loc();
    var target = this._parseBindingTarget();
    var init = null;
    if (this._maybe(TT.Punct, '=')) {
      init = this._parseAssignment();
    }
    decls.push({ type: 'VariableDeclarator', id: target, init: init, loc: loc });
  } while (this._maybe(TT.Punct, ','));
  this._maybe(TT.Punct, ';');
  return { type: 'VariableDeclaration', kind: kind, declarations: decls };
};

Parser.prototype._parseBindingTarget = function() {
  // Supports: identifier, array destructuring, object destructuring
  if (this._at(TT.Punct, '[')) return this._parseArrayPattern();
  if (this._at(TT.Punct, '{')) return this._parseObjectPattern();
  return this._parseIdentifier();
};

Parser.prototype._parseArrayPattern = function() {
  this._eat(TT.Punct, '[');
  var elements = [];
  while (!this._at(TT.Punct, ']') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, ',')) {
      elements.push(null); // elision
      this.pos++;
      continue;
    }
    // Check for rest element
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      elements.push({ type: 'RestElement', argument: this._parseBindingTarget() });
      break;
    }
    var el = this._parseBindingTarget();
    if (this._maybe(TT.Punct, '=')) {
      el = { type: 'AssignmentPattern', left: el, right: this._parseAssignment() };
    }
    elements.push(el);
    if (!this._at(TT.Punct, ']')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ']');
  return { type: 'ArrayPattern', elements: elements };
};

Parser.prototype._parseObjectPattern = function() {
  this._eat(TT.Punct, '{');
  var properties = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      properties.push({ type: 'RestElement', argument: this._parseIdentifier() });
      break;
    }
    var key, computed = false;
    if (this._at(TT.String) || this._at(TT.Number)) {
      key = this._parsePrimary();
    } else {
      key = this._parseIdentifier();
    }
    var value;
    if (this._maybe(TT.Punct, ':')) {
      value = this._parseBindingTarget();
    } else {
      value = key; // shorthand
    }
    if (this._maybe(TT.Punct, '=')) {
      value = { type: 'AssignmentPattern', left: value, right: this._parseAssignment() };
    }
    properties.push({ type: 'Property', key: key, value: value, shorthand: key === value, computed: false });
    if (!this._at(TT.Punct, '}')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, '}');
  return { type: 'ObjectPattern', properties: properties };
};

Parser.prototype._parseIdentifier = function() {
  var t = this._eat(TT.Ident);
  return { type: 'Identifier', name: t.value, loc: { line: t.line, col: t.col } };
};

Parser.prototype._parseIf = function() {
  this._eat(TT.Keyword, 'if');
  this._eat(TT.Punct, '(');
  var test = this._parseExpression();
  this._eat(TT.Punct, ')');
  var consequent = this._parseStatement();
  var alternate = null;
  if (this._maybe(TT.Keyword, 'else')) {
    alternate = this._parseStatement();
  }
  return { type: 'IfStatement', test: test, consequent: consequent, alternate: alternate };
};

Parser.prototype._parseFor = function() {
  this._eat(TT.Keyword, 'for');
  this._eat(TT.Punct, '(');

  // for-in / for-of detection
  // Try to parse init, then check for 'in' or 'of'
  if (this._at(TT.Keyword, 'var') || this._at(TT.Keyword, 'let') || this._at(TT.Keyword, 'const')) {
    var kind = this._eat(TT.Keyword).value;
    var target = this._parseBindingTarget();
    if (this._at(TT.Keyword, 'in')) {
      this.pos++;
      var right = this._parseExpression();
      this._eat(TT.Punct, ')');
      var body = this._parseStatement();
      return { type: 'ForInStatement',
        left: { type: 'VariableDeclaration', kind: kind,
                declarations: [{ type: 'VariableDeclarator', id: target, init: null }] },
        right: right, body: body };
    }
    if (this._at(TT.Keyword, 'of')) {
      this.pos++;
      var right = this._parseExpression();
      this._eat(TT.Punct, ')');
      var body = this._parseStatement();
      return { type: 'ForOfStatement',
        left: { type: 'VariableDeclaration', kind: kind,
                declarations: [{ type: 'VariableDeclarator', id: target, init: null }] },
        right: right, body: body };
    }
    // Regular for — continue parsing init as var declaration
    var init = { type: 'VariableDeclaration', kind: kind,
                 declarations: [{ type: 'VariableDeclarator', id: target, init: null }] };
    if (this._maybe(TT.Punct, '=')) {
      init.declarations[0].init = this._parseAssignment();
    }
    while (this._maybe(TT.Punct, ',')) {
      var t2 = this._parseBindingTarget();
      var i2 = null;
      if (this._maybe(TT.Punct, '=')) i2 = this._parseAssignment();
      init.declarations.push({ type: 'VariableDeclarator', id: t2, init: i2 });
    }
    this._eat(TT.Punct, ';');
    var test = this._at(TT.Punct, ';') ? null : this._parseExpression();
    this._eat(TT.Punct, ';');
    var update = this._at(TT.Punct, ')') ? null : this._parseExpression();
    this._eat(TT.Punct, ')');
    var body = this._parseStatement();
    return { type: 'ForStatement', init: init, test: test, update: update, body: body };
  }

  // No var/let/const — could be for-in/of with existing variable, or regular for
  if (this._at(TT.Punct, ';')) {
    // for (;...;...)
    this.pos++;
    var test = this._at(TT.Punct, ';') ? null : this._parseExpression();
    this._eat(TT.Punct, ';');
    var update = this._at(TT.Punct, ')') ? null : this._parseExpression();
    this._eat(TT.Punct, ')');
    return { type: 'ForStatement', init: null, test: test, update: update, body: this._parseStatement() };
  }

  var initExpr = this._parseExpression();
  if (this._at(TT.Keyword, 'in')) {
    this.pos++;
    var right = this._parseExpression();
    this._eat(TT.Punct, ')');
    return { type: 'ForInStatement', left: initExpr, right: right, body: this._parseStatement() };
  }
  if (this._at(TT.Keyword, 'of')) {
    this.pos++;
    var right = this._parseExpression();
    this._eat(TT.Punct, ')');
    return { type: 'ForOfStatement', left: initExpr, right: right, body: this._parseStatement() };
  }
  this._eat(TT.Punct, ';');
  var test = this._at(TT.Punct, ';') ? null : this._parseExpression();
  this._eat(TT.Punct, ';');
  var update = this._at(TT.Punct, ')') ? null : this._parseExpression();
  this._eat(TT.Punct, ')');
  return { type: 'ForStatement', init: initExpr, test: test, update: update, body: this._parseStatement() };
};

Parser.prototype._parseWhile = function() {
  this._eat(TT.Keyword, 'while');
  this._eat(TT.Punct, '(');
  var test = this._parseExpression();
  this._eat(TT.Punct, ')');
  return { type: 'WhileStatement', test: test, body: this._parseStatement() };
};

Parser.prototype._parseDoWhile = function() {
  this._eat(TT.Keyword, 'do');
  var body = this._parseStatement();
  this._eat(TT.Keyword, 'while');
  this._eat(TT.Punct, '(');
  var test = this._parseExpression();
  this._eat(TT.Punct, ')');
  this._maybe(TT.Punct, ';');
  return { type: 'DoWhileStatement', test: test, body: body };
};

Parser.prototype._parseReturn = function() {
  this._eat(TT.Keyword, 'return');
  var argument = null;
  if (!this._at(TT.Punct, ';') && !this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    argument = this._parseExpression();
  }
  this._maybe(TT.Punct, ';');
  return { type: 'ReturnStatement', argument: argument };
};

Parser.prototype._parseThrow = function() {
  this._eat(TT.Keyword, 'throw');
  var argument = this._parseExpression();
  this._maybe(TT.Punct, ';');
  return { type: 'ThrowStatement', argument: argument };
};

Parser.prototype._parseTry = function() {
  this._eat(TT.Keyword, 'try');
  var block = this._parseBlock();
  var handler = null;
  if (this._maybe(TT.Keyword, 'catch')) {
    var param = null;
    if (this._maybe(TT.Punct, '(')) {
      param = this._parseBindingTarget();
      this._eat(TT.Punct, ')');
    }
    handler = { type: 'CatchClause', param: param, body: this._parseBlock() };
  }
  var finalizer = null;
  if (this._maybe(TT.Keyword, 'finally')) {
    finalizer = this._parseBlock();
  }
  return { type: 'TryStatement', block: block, handler: handler, finalizer: finalizer };
};

Parser.prototype._parseSwitch = function() {
  this._eat(TT.Keyword, 'switch');
  this._eat(TT.Punct, '(');
  var disc = this._parseExpression();
  this._eat(TT.Punct, ')');
  this._eat(TT.Punct, '{');
  var cases = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    var test = null;
    if (this._maybe(TT.Keyword, 'case')) {
      test = this._parseExpression();
    } else {
      this._eat(TT.Keyword, 'default');
    }
    this._eat(TT.Punct, ':');
    var consequent = [];
    while (!this._at(TT.Keyword, 'case') && !this._at(TT.Keyword, 'default') &&
           !this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
      consequent.push(this._parseStatement());
    }
    cases.push({ type: 'SwitchCase', test: test, consequent: consequent });
  }
  this._eat(TT.Punct, '}');
  return { type: 'SwitchStatement', discriminant: disc, cases: cases };
};

Parser.prototype._parseBreak = function() {
  this._eat(TT.Keyword, 'break');
  var label = null;
  if (this._at(TT.Ident)) {
    label = this._parseIdentifier();
  }
  this._maybe(TT.Punct, ';');
  return { type: 'BreakStatement', label: label };
};

Parser.prototype._parseContinue = function() {
  this._eat(TT.Keyword, 'continue');
  var label = null;
  if (this._at(TT.Ident)) {
    label = this._parseIdentifier();
  }
  this._maybe(TT.Punct, ';');
  return { type: 'ContinueStatement', label: label };
};

Parser.prototype._parseFunctionDecl = function() {
  var isAsync = false;
  if (this._maybe(TT.Keyword, 'async')) isAsync = true;
  this._eat(TT.Keyword, 'function');
  var id = null;
  if (this._at(TT.Ident)) id = this._parseIdentifier();
  var params = this._parseParams();
  var body = this._parseBlock();
  return { type: 'FunctionDeclaration', id: id, params: params, body: body, async: isAsync };
};

Parser.prototype._parseParams = function() {
  this._eat(TT.Punct, '(');
  var params = [];
  while (!this._at(TT.Punct, ')') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      params.push({ type: 'RestElement', argument: this._parseBindingTarget() });
      break;
    }
    var param = this._parseBindingTarget();
    if (this._maybe(TT.Punct, '=')) {
      param = { type: 'AssignmentPattern', left: param, right: this._parseAssignment() };
    }
    params.push(param);
    if (!this._at(TT.Punct, ')')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ')');
  return params;
};

// ── Expressions (precedence climbing) ────────────────────────────────

Parser.prototype._parseExpression = function() {
  var expr = this._parseAssignment();
  while (this._at(TT.Punct, ',')) {
    this.pos++;
    var right = this._parseAssignment();
    expr = { type: 'SequenceExpression', expressions: expr.type === 'SequenceExpression' ?
             expr.expressions.concat(right) : [expr, right] };
  }
  return expr;
};

Parser.prototype._parseAssignment = function() {
  var left = this._parseConditional();
  var t = this._cur();
  if (t.type === TT.Punct && this._isAssignOp(t.value)) {
    this.pos++;
    var right = this._parseAssignment();
    return { type: 'AssignmentExpression', operator: t.value, left: left, right: right };
  }
  return left;
};

Parser.prototype._isAssignOp = function(op) {
  return op === '=' || op === '+=' || op === '-=' || op === '*=' ||
         op === '/=' || op === '%=' || op === '**=' || op === '<<=' ||
         op === '>>=' || op === '>>>=' || op === '&=' || op === '|=' ||
         op === '^=' || op === '&&=' || op === '||=' || op === '??=';
};

Parser.prototype._parseConditional = function() {
  var expr = this._parseNullishCoalescing();
  if (this._maybe(TT.Punct, '?')) {
    var consequent = this._parseAssignment();
    this._eat(TT.Punct, ':');
    var alternate = this._parseAssignment();
    return { type: 'ConditionalExpression', test: expr, consequent: consequent, alternate: alternate };
  }
  return expr;
};

Parser.prototype._parseNullishCoalescing = function() {
  var left = this._parseLogicalOr();
  while (this._at(TT.Punct, '??')) {
    this.pos++;
    left = { type: 'LogicalExpression', operator: '??', left: left, right: this._parseLogicalOr() };
  }
  return left;
};

Parser.prototype._parseLogicalOr = function() {
  var left = this._parseLogicalAnd();
  while (this._at(TT.Punct, '||')) {
    this.pos++;
    left = { type: 'LogicalExpression', operator: '||', left: left, right: this._parseLogicalAnd() };
  }
  return left;
};

Parser.prototype._parseLogicalAnd = function() {
  var left = this._parseBitwiseOr();
  while (this._at(TT.Punct, '&&')) {
    this.pos++;
    left = { type: 'LogicalExpression', operator: '&&', left: left, right: this._parseBitwiseOr() };
  }
  return left;
};

Parser.prototype._parseBitwiseOr = function() {
  var left = this._parseBitwiseXor();
  while (this._at(TT.Punct, '|') && !this._at(TT.Punct, '||')) {
    this.pos++;
    left = { type: 'BinaryExpression', operator: '|', left: left, right: this._parseBitwiseXor() };
  }
  return left;
};

Parser.prototype._parseBitwiseXor = function() {
  var left = this._parseBitwiseAnd();
  while (this._at(TT.Punct, '^')) {
    this.pos++;
    left = { type: 'BinaryExpression', operator: '^', left: left, right: this._parseBitwiseAnd() };
  }
  return left;
};

Parser.prototype._parseBitwiseAnd = function() {
  var left = this._parseEquality();
  while (this._at(TT.Punct, '&') && !this._at(TT.Punct, '&&')) {
    this.pos++;
    left = { type: 'BinaryExpression', operator: '&', left: left, right: this._parseEquality() };
  }
  return left;
};

Parser.prototype._parseEquality = function() {
  var left = this._parseRelational();
  while (this._at(TT.Punct, '===') || this._at(TT.Punct, '!==') ||
         this._at(TT.Punct, '==') || this._at(TT.Punct, '!=')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseRelational() };
  }
  return left;
};

Parser.prototype._parseRelational = function() {
  var left = this._parseShift();
  while (this._at(TT.Punct, '<') || this._at(TT.Punct, '>') ||
         this._at(TT.Punct, '<=') || this._at(TT.Punct, '>=') ||
         this._at(TT.Keyword, 'instanceof') || this._at(TT.Keyword, 'in')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseShift() };
  }
  return left;
};

Parser.prototype._parseShift = function() {
  var left = this._parseAdditive();
  while (this._at(TT.Punct, '<<') || this._at(TT.Punct, '>>') || this._at(TT.Punct, '>>>')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseAdditive() };
  }
  return left;
};

Parser.prototype._parseAdditive = function() {
  var left = this._parseMultiplicative();
  while (this._at(TT.Punct, '+') || this._at(TT.Punct, '-')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseMultiplicative() };
  }
  return left;
};

Parser.prototype._parseMultiplicative = function() {
  var left = this._parseExponential();
  while (this._at(TT.Punct, '*') || this._at(TT.Punct, '/') || this._at(TT.Punct, '%')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseExponential() };
  }
  return left;
};

Parser.prototype._parseExponential = function() {
  var left = this._parseUnary();
  if (this._at(TT.Punct, '**')) {
    this.pos++;
    return { type: 'BinaryExpression', operator: '**', left: left, right: this._parseExponential() };
  }
  return left;
};

Parser.prototype._parseUnary = function() {
  var t = this._cur();
  // Prefix operators
  if (t.type === TT.Punct && (t.value === '-' || t.value === '+' ||
      t.value === '!' || t.value === '~')) {
    this.pos++;
    return { type: 'UnaryExpression', operator: t.value, prefix: true, argument: this._parseUnary() };
  }
  if (t.type === TT.Keyword && (t.value === 'typeof' || t.value === 'void')) {
    this.pos++;
    return { type: 'UnaryExpression', operator: t.value, prefix: true, argument: this._parseUnary() };
  }
  if (t.type === TT.Keyword && t.value === 'await') {
    this.pos++;
    return { type: 'AwaitExpression', argument: this._parseUnary() };
  }
  // Prefix ++/--
  if (t.type === TT.Punct && (t.value === '++' || t.value === '--')) {
    this.pos++;
    return { type: 'UpdateExpression', operator: t.value, prefix: true, argument: this._parseUnary() };
  }
  return this._parsePostfix();
};

Parser.prototype._parsePostfix = function() {
  var expr = this._parseCallMember();
  var t = this._cur();
  if (t.type === TT.Punct && (t.value === '++' || t.value === '--')) {
    this.pos++;
    return { type: 'UpdateExpression', operator: t.value, prefix: false, argument: expr };
  }
  return expr;
};

Parser.prototype._parseCallMember = function() {
  var expr = this._parsePrimary();

  while (true) {
    if (this._at(TT.Punct, '.') || this._at(TT.Punct, '?.')) {
      var optional = this._cur().value === '?.';
      this.pos++;
      var prop = this._eat(TT.Ident);
      expr = { type: 'MemberExpression', object: expr,
               property: { type: 'Identifier', name: prop.value },
               computed: false, optional: optional };
    } else if (this._at(TT.Punct, '[')) {
      // Bracket access → will be transformed to __at/__set
      this.pos++;
      var prop = this._parseExpression();
      this._eat(TT.Punct, ']');
      expr = { type: 'MemberExpression', object: expr, property: prop,
               computed: true, optional: false };
    } else if (this._at(TT.Punct, '(')) {
      expr = this._parseCallExpr(expr);
    } else {
      break;
    }
  }
  return expr;
};

Parser.prototype._parseCallExpr = function(callee) {
  this._eat(TT.Punct, '(');
  var args = [];
  while (!this._at(TT.Punct, ')') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      args.push({ type: 'SpreadElement', argument: this._parseAssignment() });
    } else {
      args.push(this._parseAssignment());
    }
    if (!this._at(TT.Punct, ')')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ')');
  return { type: 'CallExpression', callee: callee, arguments: args };
};

Parser.prototype._parsePrimary = function() {
  var t = this._cur();

  // Parenthesized expression or arrow function
  if (t.type === TT.Punct && t.value === '(') {
    return this._parseParenOrArrow();
  }

  // Array literal
  if (t.type === TT.Punct && t.value === '[') {
    return this._parseArrayLiteral();
  }

  // Object literal
  if (t.type === TT.Punct && t.value === '{') {
    return this._parseObjectLiteral();
  }

  // Function expression
  if (t.type === TT.Keyword && t.value === 'function') {
    return this._parseFunctionExpr(false);
  }
  if (t.type === TT.Keyword && t.value === 'async' &&
      this._peek(1) && this._peek(1).type === TT.Keyword && this._peek(1).value === 'function') {
    return this._parseFunctionExpr(true);
  }

  // Identifier (might be start of arrow: x => ...)
  if (t.type === TT.Ident) {
    var id = this._parseIdentifier();
    // Arrow function: ident => body
    if (this._at(TT.Punct, '=>')) {
      return this._parseArrowBody([id], false);
    }
    return id;
  }

  // Literals
  if (t.type === TT.Number) {
    this.pos++;
    return { type: 'Literal', value: Number(t.value), raw: t.value };
  }
  if (t.type === TT.String) {
    this.pos++;
    var val = unescapeString(t.value);
    return { type: 'Literal', value: val, raw: t.value };
  }
  if (t.type === TT.Regex) {
    this.pos++;
    return { type: 'Literal', raw: t.value, regex: true };
  }
  if (t.type === TT.Keyword) {
    if (t.value === 'true') { this.pos++; return { type: 'Literal', value: true, raw: 'true' }; }
    if (t.value === 'false') { this.pos++; return { type: 'Literal', value: false, raw: 'false' }; }
    if (t.value === 'null') { this.pos++; return { type: 'Literal', value: null, raw: 'null' }; }
    if (t.value === 'undefined') { this.pos++; return { type: 'Identifier', name: 'undefined' }; }
  }

  this._error('Unexpected token: ' + t.type + ' "' + t.value + '"');
};

Parser.prototype._parseParenOrArrow = function() {
  // Save position for backtracking
  var save = this.pos;
  this._eat(TT.Punct, '(');

  // Empty parens → must be arrow params
  if (this._at(TT.Punct, ')')) {
    this._eat(TT.Punct, ')');
    if (this._at(TT.Punct, '=>')) {
      return this._parseArrowBody([], false);
    }
    this._error('Unexpected ()');
  }

  // Try to parse as expression first
  // If we see '=>' after ')', it was arrow params
  var items = [];
  var isArrow = false;

  // Simple heuristic: parse comma-separated list
  // If after closing ) we see =>, treat as arrow params
  try {
    var firstExpr = this._parseAssignment();
    items.push(firstExpr);
    while (this._maybe(TT.Punct, ',')) {
      items.push(this._parseAssignment());
    }
    this._eat(TT.Punct, ')');

    if (this._at(TT.Punct, '=>')) {
      // Arrow function — convert expressions to params
      var params = items.map(function(item) {
        if (item.type === 'Identifier') return item;
        if (item.type === 'AssignmentExpression' && item.operator === '=' &&
            item.left.type === 'Identifier') {
          return { type: 'AssignmentPattern', left: item.left, right: item.right };
        }
        if (item.type === 'SpreadElement' || item.type === 'RestElement') {
          return { type: 'RestElement', argument: item.argument };
        }
        return item; // ObjectPattern, ArrayPattern already work
      });
      return this._parseArrowBody(params, false);
    }

    // Regular parenthesized expression
    if (items.length === 1) return items[0];
    return { type: 'SequenceExpression', expressions: items };
  } catch(e) {
    throw e; // propagate parse error
  }
};

Parser.prototype._parseArrowBody = function(params, isAsync) {
  this._eat(TT.Punct, '=>');
  var body;
  if (this._at(TT.Punct, '{')) {
    body = this._parseBlock();
  } else {
    body = this._parseAssignment();
  }
  return { type: 'ArrowFunctionExpression', params: params, body: body, async: isAsync };
};

Parser.prototype._parseArrayLiteral = function() {
  this._eat(TT.Punct, '[');
  var elements = [];
  while (!this._at(TT.Punct, ']') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, ',')) {
      elements.push(null); // elision
      this.pos++;
      continue;
    }
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      elements.push({ type: 'SpreadElement', argument: this._parseAssignment() });
    } else {
      elements.push(this._parseAssignment());
    }
    if (!this._at(TT.Punct, ']')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ']');
  return { type: 'ArrayExpression', elements: elements };
};

Parser.prototype._parseObjectLiteral = function() {
  this._eat(TT.Punct, '{');
  var properties = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      properties.push({ type: 'SpreadElement', argument: this._parseAssignment() });
      if (!this._at(TT.Punct, '}')) this._eat(TT.Punct, ',');
      continue;
    }
    var computed = false;
    var key;
    if (this._at(TT.Punct, '[')) {
      // Computed property key — allowed in object literals
      this._eat(TT.Punct, '[');
      key = this._parseAssignment();
      this._eat(TT.Punct, ']');
      computed = true;
    } else if (this._at(TT.String) || this._at(TT.Number)) {
      key = this._parsePrimary();
    } else if (this._at(TT.Ident)) {
      key = this._parseIdentifier();
    } else if (this._at(TT.Keyword)) {
      // Keywords can be property names
      var kw = this._cur();
      this.pos++;
      key = { type: 'Identifier', name: kw.value };
    } else {
      this._error('Expected property name');
    }

    var value, shorthand = false, method = false;
    if (this._at(TT.Punct, '(')) {
      // Method shorthand
      var params = this._parseParams();
      var body = this._parseBlock();
      value = { type: 'FunctionExpression', id: null, params: params, body: body, async: false };
      method = true;
    } else if (this._maybe(TT.Punct, ':')) {
      value = this._parseAssignment();
    } else {
      // Shorthand property
      value = key;
      shorthand = true;
    }

    properties.push({ type: 'Property', key: key, value: value,
                       computed: computed, shorthand: shorthand, method: method });
    if (!this._at(TT.Punct, '}')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, '}');
  return { type: 'ObjectExpression', properties: properties };
};

Parser.prototype._parseFunctionExpr = function(isAsync) {
  if (isAsync) this._eat(TT.Keyword, 'async');
  this._eat(TT.Keyword, 'function');
  var id = null;
  if (this._at(TT.Ident)) id = this._parseIdentifier();
  var params = this._parseParams();
  var body = this._parseBlock();
  return { type: 'FunctionExpression', id: id, params: params, body: body, async: isAsync };
};

// ── Public API ───────────────────────────────────────────────────────

function parse(source) {
  var parser = new Parser(source);
  return parser.parseProgram();
}

exports.parse = parse;
exports.TT = TT;

  return exports;
})();

// ── validator ───────────────────────────────────────────────────
var validator = (function() {
  var exports = {};
/**
 * SafeScript AST validator — walks the AST and enforces restrictions.
 *
 * The parser already rejects blocked identifiers/keywords at tokenization,
 * so the validator focuses on structural rules:
 *   - No computed member access without __at/__set (caught at transform)
 *   - No blocked property names in dot access
 *   - No generator functions
 *   - No tagged templates
 *   - Identifier references checked against blocked list (belt-and-suspenders)
 */

// (uses outer defs)

function ValidationError(message, node) {
  this.message = message;
  this.node = node;
  this.line = node && node.loc ? node.loc.line : undefined;
  this.col = node && node.loc ? node.loc.col : undefined;
}

function validate(ast) {
  var errors = [];

  function error(msg, node) {
    errors.push(new ValidationError(msg, node));
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'Program':
        node.body.forEach(walk);
        break;

      case 'ExpressionStatement':
        walk(node.expression);
        break;

      case 'BlockStatement':
        node.body.forEach(walk);
        break;

      case 'VariableDeclaration':
        node.declarations.forEach(function(d) {
          walkPattern(d.id);
          if (d.init) walk(d.init);
        });
        break;

      case 'IfStatement':
        walk(node.test);
        walk(node.consequent);
        if (node.alternate) walk(node.alternate);
        break;

      case 'ForStatement':
        if (node.init) walk(node.init);
        if (node.test) walk(node.test);
        if (node.update) walk(node.update);
        walk(node.body);
        break;

      case 'ForInStatement':
      case 'ForOfStatement':
        walk(node.left);
        walk(node.right);
        walk(node.body);
        break;

      case 'WhileStatement':
        walk(node.test);
        walk(node.body);
        break;

      case 'DoWhileStatement':
        walk(node.body);
        walk(node.test);
        break;

      case 'ReturnStatement':
      case 'ThrowStatement':
        if (node.argument) walk(node.argument);
        break;

      case 'BreakStatement':
      case 'ContinueStatement':
      case 'EmptyStatement':
        break;

      case 'LabeledStatement':
        walk(node.body);
        break;

      case 'TryStatement':
        walk(node.block);
        if (node.handler) {
          if (node.handler.param) walkPattern(node.handler.param);
          walk(node.handler.body);
        }
        if (node.finalizer) walk(node.finalizer);
        break;

      case 'SwitchStatement':
        walk(node.discriminant);
        node.cases.forEach(function(c) {
          if (c.test) walk(c.test);
          c.consequent.forEach(walk);
        });
        break;

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) walkPattern(node.id);
        node.params.forEach(walkPattern);
        walk(node.body);
        break;

      case 'Identifier':
        if (defs.BLOCKED[node.name]) {
          error('Blocked identifier: ' + node.name, node);
        }
        break;

      case 'MemberExpression':
        walk(node.object);
        if (node.computed) {
          // Computed member access — allowed in AST, transform will rewrite
          walk(node.property);
        } else if (node.property && node.property.type === 'Identifier') {
          // Dot access — check blocked property names
          if (defs.BLOCKED_PROPS[node.property.name]) {
            error('Blocked property access: ' + node.property.name, node.property);
          }
        }
        break;

      case 'CallExpression':
        walk(node.callee);
        node.arguments.forEach(walk);
        break;

      case 'BinaryExpression':
      case 'LogicalExpression':
        walk(node.left);
        walk(node.right);
        break;

      case 'AssignmentExpression':
        walk(node.left);
        walk(node.right);
        break;

      case 'UnaryExpression':
      case 'UpdateExpression':
        walk(node.argument);
        break;

      case 'ConditionalExpression':
        walk(node.test);
        walk(node.consequent);
        walk(node.alternate);
        break;

      case 'SequenceExpression':
        node.expressions.forEach(walk);
        break;

      case 'ArrayExpression':
        node.elements.forEach(function(el) { if (el) walk(el); });
        break;

      case 'ObjectExpression':
        node.properties.forEach(function(prop) {
          if (prop.type === 'SpreadElement') {
            walk(prop.argument);
          } else {
            if (prop.computed) walk(prop.key);
            walk(prop.value);
          }
        });
        break;

      case 'SpreadElement':
        walk(node.argument);
        break;

      case 'Literal':
        break;

      default:
        // Unknown node type — permissive for forward compat
        break;
    }
  }

  function walkPattern(node) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        // Binding identifiers are fine (you're declaring, not referencing)
        // But still check for truly dangerous names
        if (node.name === 'eval' || node.name === 'arguments') {
          error('Cannot use "' + node.name + '" as binding name in strict mode', node);
        }
        break;
      case 'ArrayPattern':
        node.elements.forEach(function(el) { if (el) walkPattern(el); });
        break;
      case 'ObjectPattern':
        node.properties.forEach(function(prop) {
          if (prop.type === 'RestElement') walkPattern(prop.argument);
          else walkPattern(prop.value);
        });
        break;
      case 'AssignmentPattern':
        walkPattern(node.left);
        walk(node.right);
        break;
      case 'RestElement':
        walkPattern(node.argument);
        break;
    }
  }

  walk(ast);

  return {
    ok: errors.length === 0,
    errors: errors.length > 0 ? errors : null
  };
}

exports.validate = validate;

  return exports;
})();

// ── transformer ─────────────────────────────────────────────────
var transformer = (function() {
  var exports = {};
/**
 * SafeScript AST transformer.
 *
 * Rewrites:
 *   obj[key]       → __at(obj, key)
 *   obj[key] = val → __set(obj, key, val)
 *
 * The transform walks the AST and replaces computed MemberExpression
 * nodes with CallExpression nodes that call the runtime guards.
 *
 * Important: assignment/update checks happen BEFORE recursing into
 * children, so the left-hand MemberExpression is still intact.
 */

function transform(ast) {
  return walkNode(ast);
}

function walkNode(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(walkNode);

  // ── Check compound patterns BEFORE recursing ──

  // Assignment to computed member: obj[key] = val → __set(obj, key, val)
  if (node.type === 'AssignmentExpression' && node.operator === '=' &&
      node.left && node.left.type === 'MemberExpression' && node.left.computed) {
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__set' },
      arguments: [
        walkNode(node.left.object),
        walkNode(node.left.property),
        walkNode(node.right)
      ]
    };
  }

  // Compound assignment to computed member: obj[key] += val
  // → __set(obj, key, __at(obj, key) OP val)
  if (node.type === 'AssignmentExpression' && node.operator !== '=' &&
      node.left && node.left.type === 'MemberExpression' && node.left.computed) {
    var baseOp = node.operator.slice(0, -1); // '+=' → '+'
    var obj = walkNode(node.left.object);
    var prop = walkNode(node.left.property);
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__set' },
      arguments: [
        obj,
        prop,
        {
          type: 'BinaryExpression',
          operator: baseOp,
          left: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: '__at' },
            arguments: [obj, prop]
          },
          right: walkNode(node.right)
        }
      ]
    };
  }

  // Update on computed member: obj[key]++ → __set(obj, key, __at(obj, key) + 1)
  if (node.type === 'UpdateExpression' &&
      node.argument && node.argument.type === 'MemberExpression' && node.argument.computed) {
    var delta = node.operator === '++' ? 1 : -1;
    var obj = walkNode(node.argument.object);
    var prop = walkNode(node.argument.property);
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__set' },
      arguments: [
        obj,
        prop,
        {
          type: 'BinaryExpression',
          operator: '+',
          left: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: '__at' },
            arguments: [obj, prop]
          },
          right: { type: 'Literal', value: delta, raw: String(delta) }
        }
      ]
    };
  }

  // ── Now deep-clone + recurse for everything else ──

  var out = {};
  var keys = Object.keys(node);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = node[k];
    if (k === 'loc') { out[k] = v; continue; }
    if (Array.isArray(v)) {
      out[k] = v.map(function(item) {
        return (item && typeof item === 'object' && item.type) ? walkNode(item) : item;
      });
    } else if (v && typeof v === 'object' && v.type) {
      out[k] = walkNode(v);
    } else {
      out[k] = v;
    }
  }

  // Read from computed member: obj[key] → __at(obj, key)
  if (out.type === 'MemberExpression' && out.computed) {
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__at' },
      arguments: [out.object, out.property]
    };
  }

  return out;
}

exports.transform = transform;

  return exports;
})();

// ── emitter ─────────────────────────────────────────────────────
var emitter = (function() {
  var exports = {};
/**
 * SafeScript emitter — AST → JavaScript source.
 *
 * Only produces constructs the emitter explicitly knows about.
 * The grammar IS the allowlist: if a node type isn't handled here,
 * it silently produces nothing (fail-safe).
 */

function emit(node) {
  if (!node) return '';

  switch (node.type) {
    case 'Program':
      return node.body.map(emit).join('\n');

    case 'ExpressionStatement':
      return emit(node.expression) + ';';

    case 'BlockStatement':
      return '{\n' + node.body.map(emit).join('\n') + '\n}';

    case 'EmptyStatement':
      return ';';

    case 'VariableDeclaration':
      return node.kind + ' ' + node.declarations.map(function(d) {
        if (d.init) return emitPattern(d.id) + ' = ' + emit(d.init);
        return emitPattern(d.id);
      }).join(', ') + ';';

    case 'FunctionDeclaration':
      return 'async function ' +
        (node.id ? emit(node.id) : '') +
        '(' + node.params.map(emitParam).join(', ') + ') ' +
        emit(node.body);

    case 'FunctionExpression':
      return 'async function' +
        (node.id ? ' ' + emit(node.id) : '') +
        '(' + node.params.map(emitParam).join(', ') + ') ' +
        emit(node.body);

    case 'ArrowFunctionExpression':
      var paramsStr;
      if (node.params.length === 1 && node.params[0].type === 'Identifier') {
        paramsStr = emit(node.params[0]);
      } else {
        paramsStr = '(' + node.params.map(emitParam).join(', ') + ')';
      }
      var bodyStr;
      if (node.body.type === 'BlockStatement') {
        bodyStr = emit(node.body);
      } else if (node.body.type === 'ObjectExpression') {
        bodyStr = '(' + emit(node.body) + ')';
      } else {
        bodyStr = emit(node.body);
      }
      return 'async ' + paramsStr + ' => ' + bodyStr;

    case 'ReturnStatement':
      return node.argument ? 'return ' + emit(node.argument) + ';' : 'return;';

    case 'ThrowStatement':
      return 'throw ' + emit(node.argument) + ';';

    case 'BreakStatement':
      return node.label ? 'break ' + emit(node.label) + ';' : 'break;';

    case 'ContinueStatement':
      return node.label ? 'continue ' + emit(node.label) + ';' : 'continue;';

    case 'LabeledStatement':
      return emit(node.label) + ': ' + emit(node.body);

    case 'IfStatement':
      var s = 'if (' + emit(node.test) + ') ' + emit(node.consequent);
      if (node.alternate) {
        s += ' else ' + emit(node.alternate);
      }
      return s;

    case 'ForStatement':
      return 'for (' +
        (node.init ? (node.init.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.init) : emit(node.init)) : '') + '; ' +
        (node.test ? emit(node.test) : '') + '; ' +
        (node.update ? emit(node.update) : '') + ') ' +
        emit(node.body);

    case 'ForInStatement':
      return 'for (' +
        (node.left.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.left) : emit(node.left)) +
        ' in ' + emit(node.right) + ') ' + emit(node.body);

    case 'ForOfStatement':
      return 'for (' +
        (node.left.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.left) : emit(node.left)) +
        ' of ' + emit(node.right) + ') ' + emit(node.body);

    case 'WhileStatement':
      return 'while (' + emit(node.test) + ') ' + emit(node.body);

    case 'DoWhileStatement':
      return 'do ' + emit(node.body) + ' while (' + emit(node.test) + ');';

    case 'TryStatement':
      var s = 'try ' + emit(node.block);
      if (node.handler) {
        s += ' catch' + (node.handler.param ? ' (' + emitPattern(node.handler.param) + ')' : '') +
          ' ' + emit(node.handler.body);
      }
      if (node.finalizer) {
        s += ' finally ' + emit(node.finalizer);
      }
      return s;

    case 'SwitchStatement':
      return 'switch (' + emit(node.discriminant) + ') {\n' +
        node.cases.map(function(c) {
          var label = c.test ? 'case ' + emit(c.test) + ':\n' : 'default:\n';
          return label + c.consequent.map(emit).join('\n');
        }).join('\n') + '\n}';

    // ── Expressions ──────────────────────────────────────────────

    case 'Identifier':
      return node.name;

    case 'Literal':
      return node.raw;

    case 'BinaryExpression':
    case 'LogicalExpression':
      var leftStr = emit(node.left);
      // Wrap unary in parens before ** to avoid JS ambiguity error
      if (node.operator === '**' && node.left.type === 'UnaryExpression') {
        leftStr = '(' + leftStr + ')';
      }
      return '(' + leftStr + ' ' + node.operator + ' ' + emit(node.right) + ')';

    case 'AssignmentExpression':
      return emit(node.left) + ' ' + node.operator + ' ' + emit(node.right);

    case 'UnaryExpression':
      if (node.operator === 'typeof' || node.operator === 'void') {
        return node.operator + ' ' + emit(node.argument);
      }
      if (node.prefix) {
        var argStr = emit(node.argument);
        // Wrap in parens to avoid --x or ++x when nesting same unary operators
        if (node.argument.type === 'UnaryExpression' &&
            (node.operator === '-' && node.argument.operator === '-' ||
             node.operator === '+' && node.argument.operator === '+')) {
          argStr = '(' + argStr + ')';
        }
        return node.operator + argStr;
      }
      return emit(node.argument) + node.operator;

    case 'UpdateExpression':
      return node.prefix ? node.operator + emit(node.argument) :
        emit(node.argument) + node.operator;

    case 'ConditionalExpression':
      return '(' + emit(node.test) + ' ? ' + emit(node.consequent) +
        ' : ' + emit(node.alternate) + ')';

    case 'SequenceExpression':
      return '(' + node.expressions.map(emit).join(', ') + ')';

    case 'CallExpression':
      var calleeStr = emit(node.callee);
      // Wrap arrow/function expression callees in parens for IIFE
      if (node.callee.type === 'ArrowFunctionExpression' ||
          node.callee.type === 'FunctionExpression') {
        calleeStr = '(' + calleeStr + ')';
      }
      return '(await ' + calleeStr + '(' + node.arguments.map(function(a) {
        if (a.type === 'SpreadElement') return '...' + emit(a.argument);
        return emit(a);
      }).join(', ') + '))';

    case 'MemberExpression':
      if (node.computed) {
        return emit(node.object) + '[' + emit(node.property) + ']';
      }
      var op = node.optional ? '?.' : '.';
      return emit(node.object) + op + emit(node.property);

    case 'ArrayExpression':
      return '[' + node.elements.map(function(el) {
        if (!el) return '';
        if (el.type === 'SpreadElement') return '...' + emit(el.argument);
        return emit(el);
      }).join(', ') + ']';

    case 'ObjectExpression':
      if (node.properties.length === 0) return '{}';
      return '{\n' + node.properties.map(function(prop) {
        if (prop.type === 'SpreadElement') return '...' + emit(prop.argument);
        if (prop.shorthand) return emit(prop.key);
        if (prop.method) {
          var fn = prop.value;
          return 'async ' + (prop.computed ? '[' + emit(prop.key) + ']' : emit(prop.key)) +
            '(' + fn.params.map(emitParam).join(', ') + ') ' + emit(fn.body);
        }
        var keyStr = prop.computed ? '[' + emit(prop.key) + ']' : emit(prop.key);
        return keyStr + ': ' + emit(prop.value);
      }).join(',\n') + '\n}';

    case 'SpreadElement':
      return '...' + emit(node.argument);

    default:
      // Unknown node → produce nothing (fail-safe)
      return '';
  }
}

function emitPattern(node) {
  if (!node) return '';
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'ArrayPattern':
      return '[' + node.elements.map(function(el) {
        if (!el) return '';
        return emitParam(el);
      }).join(', ') + ']';
    case 'ObjectPattern':
      return '{' + node.properties.map(function(prop) {
        if (prop.type === 'RestElement') return '...' + emitPattern(prop.argument);
        if (prop.shorthand) return emitPattern(prop.value);
        return emit(prop.key) + ': ' + emitPattern(prop.value);
      }).join(', ') + '}';
    case 'AssignmentPattern':
      return emitPattern(node.left) + ' = ' + emit(node.right);
    case 'RestElement':
      return '...' + emitPattern(node.argument);
    default:
      return emit(node);
  }
}

function emitParam(node) {
  return emitPattern(node);
}

function emitVarDeclNoSemi(node) {
  return node.kind + ' ' + node.declarations.map(function(d) {
    if (d.init) return emitPattern(d.id) + ' = ' + emit(d.init);
    return emitPattern(d.id);
  }).join(', ');
}

exports.emit = emit;

  return exports;
})();

// ── runtime ─────────────────────────────────────────────────────
var runtime = (function() {
  var exports = {};
/**
 * SafeScript runtime — __at, __set, sanitize, scope builder.
 *
 * These are injected into compiled SafeScript code and provide
 * the last line of defense: runtime property access guards and
 * scope sanitization (null-prototype deep copy).
 */

// (uses outer defs)

/**
 * Safe bracket read: obj[key] → __at(obj, key)
 * Returns undefined for blocked property names.
 * Throws on null/undefined receiver.
 */
function __at(obj, key) {
  if (obj == null) {
    throw new TypeError('Cannot read property "' + key + '" of ' + String(obj));
  }
  var k = String(key);
  if (defs.BLOCKED_PROPS[k]) return undefined;
  return obj[k];
}

/**
 * Safe bracket write: obj[key] = val → __set(obj, key, val)
 * Throws for blocked property names.
 * Throws on null/undefined receiver.
 */
function __set(obj, key, val) {
  if (obj == null) {
    throw new TypeError('Cannot set property "' + key + '" of ' + String(obj));
  }
  var k = String(key);
  if (defs.BLOCKED_PROPS[k]) {
    throw new TypeError('SafeScript: cannot set blocked property "' + k + '"');
  }
  obj[k] = val;
  return val;
}

/**
 * Deep-copy an object to null-prototype objects.
 * Functions pass through (they're trusted API).
 * Handles cycles via a seen-set.
 */
function sanitize(obj, _seen) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'function') return obj;
  if (typeof obj !== 'object') return obj;

  if (!_seen) _seen = new Map();
  if (_seen.has(obj)) return _seen.get(obj);

  if (Array.isArray(obj)) {
    var arr = [];
    _seen.set(obj, arr);
    for (var i = 0; i < obj.length; i++) {
      arr[i] = sanitize(obj[i], _seen);
    }
    return arr;
  }

  // Non-plain objects (built-ins like JSON, Math, class instances)
  // pass through — they're trusted API with non-enumerable methods.
  // Only plain objects ({} literals) get null-prototype treatment.
  var proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  var out = Object.create(null);
  _seen.set(obj, out);
  // Use getOwnPropertyNames to capture non-enumerable properties too
  // (e.g. JSON.stringify, Math.floor are non-enumerable)
  var keys = Object.getOwnPropertyNames(obj);
  for (var j = 0; j < keys.length; j++) {
    out[keys[j]] = sanitize(obj[keys[j]], _seen);
  }
  return out;
}

/**
 * Build the global shadow list — all globals set to undefined
 * so compiled code can't reach them.
 */
function buildShadowList() {
  var all = Object.create(null);
  defs.SHADOW_STATIC.forEach(function(k) { all[k] = 1; });
  // eval and arguments are illegal in strict mode var declarations
  delete all['eval'];
  delete all['arguments'];
  return Object.keys(all);
}

/**
 * Build a compiled function from emitted source with scope injection.
 *
 * @param {string} source - The emitted JS source
 * @param {Object} scope  - The scope object (capabilities)
 * @param {Object} opts   - Options { timeout: 0 }
 * @returns {Function} A function that executes the SafeScript code (always returns a Promise)
 */
function buildFunction(source, scope, opts) {
  opts = opts || {};
  var scopeObj = scope ? sanitize(scope) : Object.create(null);
  var scopeKeys = scope ? Object.keys(scope) : [];

  // Shadow all globals
  var shadowList = buildShadowList();
  var shadowDecl = shadowList.length > 0 ?
    'var ' + shadowList.join(', ') + ';\n' : '';

  // Build function body: shadow globals, then user code
  var body = '"use strict";\n' + shadowDecl + source;

  // Function params: __scope, __at, __set, then scope keys
  var paramNames = ['__scope', '__at', '__set'].concat(scopeKeys);

  // Always use AsyncFunction constructor (auto-async model)
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  var fn = new AsyncFunction(paramNames.join(', '), body);

  // Bind the arguments
  var args = [scopeObj, __at, __set];
  for (var i = 0; i < scopeKeys.length; i++) {
    args.push(scopeObj[scopeKeys[i]]);
  }

  var timeout = opts.timeout || 0;

  return function() {
    var promise = fn.apply(undefined, args);
    if (timeout > 0) {
      var timer;
      return Promise.race([
        promise.then(function(v) { clearTimeout(timer); return v; },
                     function(e) { clearTimeout(timer); throw e; }),
        new Promise(function(_, reject) {
          timer = setTimeout(function() {
            reject(new Error('SafeScript: execution timed out after ' + timeout + 'ms'));
          }, timeout);
        })
      ]);
    }
    return promise;
  };
}

exports.__at = __at;
exports.__set = __set;
exports.sanitize = sanitize;
exports.buildShadowList = buildShadowList;
exports.buildFunction = buildFunction;

  return exports;
})();

// ── compiler ────────────────────────────────────────────────────
var compiler = (function() {
  var exports = {};
/**
 * SafeScript compiler — orchestrates the pipeline.
 *
 * parse → validate → transform → emit
 *
 * Also provides AST hashing for deduplication/caching.
 */

// (uses outer parser)
// (uses outer validator)
// (uses outer transformer)
// (uses outer emitter)
var crypto;


/**
 * Compile SafeScript source to JavaScript.
 *
 * @param {string} source - SafeScript source code
 * @param {Object} [opts] - Options
 * @param {boolean} [opts.sourceMap] - Include source positions (future)
 * @returns {{ code: string, ast: Object, hash: string|null }}
 */
function compile(source) {
  // 1. Parse → AST
  var ast = parser.parse(source);

  // 2. Validate
  var result = validator.validate(ast);
  if (!result.ok) {
    var err = new SyntaxError('SafeScript validation failed: ' +
      result.errors.map(function(e) { return e.message; }).join('; '));
    err.errors = result.errors;
    throw err;
  }

  // 3. Transform (rewrite bracket access → __at/__set)
  var transformed = transformer.transform(ast);

  // 4. Emit JS
  var code = emitter.emit(transformed);

  // 5. Hash the normalized AST (strips positions/whitespace)
  var hash = hashAST(transformed);

  return {
    code: code,
    ast: transformed,
    hash: hash
  };
}

/**
 * Hash the AST for caching/deduplication.
 * Strips position info so whitespace/comment changes
 * don't produce a different hash.
 */
function hashAST(ast) {
  if (!crypto) return null; // no crypto in browser (could polyfill)
  var normalized = JSON.stringify(ast, function(key, value) {
    // Strip location info
    if (key === 'loc' || key === 'line' || key === 'col') return undefined;
    return value;
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

exports.compile = compile;
exports.hashAST = hashAST;

  return exports;
})();

// ── headerParser ────────────────────────────────────────────────
var headerParser = (function() {
  var exports = {};
/**
 * SafeScript .safe file header parser.
 *
 * Parses the leading /** ... * / block for:
 *   @safescript <version>
 *   @env <env1>, <env2>, ...
 *   @needs <name>: <Type>
 *   @uses <name>: <Type>
 */

/**
 * Extract the first /** ... * / block from source.
 * Returns the inner text (without the comment delimiters), or null.
 */
function extractHeader(source) {
  var s = source.trimStart();
  if (s.indexOf('/**') !== 0) return null;
  var end = s.indexOf('*/');
  if (end < 0) return null;
  return s.slice(3, end);
}

/**
 * Parse a header block into structured data.
 *
 * Returns {
 *   version: string|null,
 *   env: string[]|null,         // null if no @env declared
 *   needs: [{name, type}],
 *   uses: [{name, type}]
 * }
 */
function parseHeader(source) {
  var result = {
    version: null,
    env: null,
    needs: [],
    uses: []
  };

  var text = extractHeader(source);
  if (!text) return result;

  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    // Strip leading whitespace and * prefix
    var line = lines[i].replace(/^\s*\*?\s?/, '').trim();
    if (!line) continue;

    // @safescript <version>
    var m = line.match(/^@safescript\s+(.+)$/);
    if (m) {
      result.version = m[1].trim();
      continue;
    }

    // @env <env1>, <env2>, ...
    m = line.match(/^@env\s+(.+)$/);
    if (m) {
      result.env = m[1].split(',').map(function(e) { return e.trim(); }).filter(Boolean);
      continue;
    }

    // @needs <name>: <Type>
    m = line.match(/^@needs\s+(\w+)\s*:\s*(.+)$/);
    if (m) {
      result.needs.push({ name: m[1], type: m[2].trim() });
      continue;
    }

    // @needs <name> (no type)
    m = line.match(/^@needs\s+(\w+)\s*$/);
    if (m) {
      result.needs.push({ name: m[1], type: null });
      continue;
    }

    // @uses <name>: <Type>
    m = line.match(/^@uses\s+(\w+)\s*:\s*(.+)$/);
    if (m) {
      result.uses.push({ name: m[1], type: m[2].trim() });
      continue;
    }

    // @uses <name> (no type)
    m = line.match(/^@uses\s+(\w+)\s*$/);
    if (m) {
      result.uses.push({ name: m[1], type: null });
      continue;
    }
  }

  return result;
}

/**
 * Validate that a scope object satisfies the header's @needs.
 * Returns { ok: boolean, missing: string[] }
 */
function checkScope(header, scope) {
  var missing = [];
  if (!header || !header.needs) return { ok: true, missing: missing };

  var keys = scope ? Object.keys(scope) : [];
  var available = Object.create(null);
  for (var i = 0; i < keys.length; i++) {
    available[keys[i]] = 1;
  }

  for (var j = 0; j < header.needs.length; j++) {
    var name = header.needs[j].name;
    if (!available[name]) {
      missing.push(name);
    }
  }

  return { ok: missing.length === 0, missing: missing };
}

exports.parseHeader = parseHeader;
exports.checkScope = checkScope;

  return exports;
})();


// ── Public API ──────────────────────────────────────────────────────
var SafeScript = {
  compile: function(source) {
    return compiler.compile(source);
  },
  run: function(source, scope, opts) {
    if (typeof source === 'object' && source !== null && typeof source.source === 'string') {
      opts = scope;
      scope = source.scope;
      source = source.source;
    }
    var compiled = compiler.compile(source);
    var timeout = (opts && opts.timeout) || 0;
    var fn = runtime.buildFunction(compiled.code, scope, { timeout: timeout });
    return fn();
  },
  validate: function(source) {
    try {
      var ast = parser.parse(source);
      return validator.validate(ast);
    } catch(e) {
      return { ok: false, errors: [{ message: e.message, line: e.line, col: e.col }] };
    }
  },
  parse: function(source) {
    return parser.parse(source);
  },
  sanitize: function(obj) {
    return runtime.sanitize(obj);
  },
  capabilities: function(source) {
    return headerParser.parseHeader(source);
  },
  checkScope: function(source, scope) {
    var caps = headerParser.parseHeader(source);
    return headerParser.checkScope(caps, scope);
  },
  load: function(source, resolver) {
    var caps = headerParser.parseHeader(source);
    var resolved = resolver ? resolver(caps) : {};
    return Promise.resolve(resolved).then(function(scope) {
      var check = headerParser.checkScope(caps, scope);
      if (!check.ok) {
        throw new Error('Missing capabilities: ' + check.missing.join(', '));
      }
      return { source: source, scope: scope };
    });
  },
  /**
   * Async AST hash using SubtleCrypto (browser).
   * In Node.js, compile().hash is synchronous via crypto module.
   * In browsers, compile().hash is null — use this for async SHA-256.
   */
  hashASTAsync: function(ast) {
    var normalized = JSON.stringify(ast, function(key, value) {
      if (key === 'loc' || key === 'line' || key === 'col') return undefined;
      return value;
    });
    var data = new TextEncoder().encode(normalized);
    return crypto.subtle.digest('SHA-256', data).then(function(buf) {
      var bytes = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        hex += ('0' + bytes[i].toString(16)).slice(-2);
      }
      return hex;
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SafeScript;
} else {
  root.SafeScript = SafeScript;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);

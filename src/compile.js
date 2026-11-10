/**
 * SafeScript compiler — orchestrates the pipeline.
 *
 * parse → validate → transform → emit
 *
 * Also provides AST hashing for deduplication/caching.
 */
'use strict';

var parser = require('./parse');
var validator = require('./validate');
var transformer = require('./transform');
var emitter = require('./emit');
var crypto;
try { crypto = require('crypto'); } catch(e) { /* browser */ }

/**
 * Compile SafeScript source to JavaScript.
 *
 * @param {string} source - SafeScript source code
 * @param {Object} [opts] - Options
 * @param {boolean} [opts.sourceMap] - Include source positions (future)
 * @returns {{ code: string, ast: Object, hash: string|null }}
 */
function compile(source, opts) {
  opts = opts || {};

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

  // 4. Emit JS (debug mode inserts __dbg checkpoints)
  var code;
  if (opts.debug) {
    code = emitter.emitDebug(transformed);
  } else {
    code = emitter.emit(transformed);
  }

  // 5. Hash the normalized AST (strips positions/whitespace)
  var hash = hashAST(transformed);

  return {
    code: code,
    ast: transformed,
    hash: hash,
    debug: !!opts.debug
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

/**
 * Compile the tail of a SafeScript source from a given line.
 *
 * Used for edit-and-continue: the user edits code while paused, and we
 * recompile everything from the current line forward. The resulting function
 * takes the current locals as a destructured parameter.
 *
 * The approach: compile the FULL edited source in debug mode, then wrap it
 * in a function that takes locals as a parameter. When the replacement runs,
 * it re-executes from the top but the __dbg checkpoints fast-forward past
 * already-executed lines (skipping side effects), then resumes normally.
 *
 * Simpler alternative to AST slicing. Handles all control flow cases.
 *
 * @param {string} source - Full SafeScript source (the edited version)
 * @param {number} fromLine - Line number to resume from (1-indexed)
 * @param {Object} opts
 * @param {string[]} opts.locals - Names of local variables at the resume point
 * @returns {Function} An async function that takes (locals, __scope, __at, __set, __call, __call_opt, __new, __check, __thisCell, __safeGlobals, __dbg)
 */
function compileTail(source, fromLine, opts) {
  opts = opts || {};
  var localNames = opts.locals || [];

  // Compile the full source in debug mode
  var compiled = compile(source, { debug: true });
  var code = compiled.code;

  // Build the tail function:
  // 1. Accept locals as a destructured parameter
  // 2. Initialize local variables from the parameter
  // 3. Run the compiled code (with __dbg checkpoints)
  //
  // The __dbg checkpoints will be wired to a new session or
  // the existing session — the caller decides.

  // Build variable initialization from locals
  var initLines = [];
  for (var i = 0; i < localNames.length; i++) {
    var n = localNames[i];
    // Use bracket access to handle weird names safely
    initLines.push('var ' + n + ' = __locals["' + n + '"];');
  }
  var initCode = initLines.join('\n');

  // The tail function body: init locals, then run the compiled code
  // The compiled code already has `var __r;` at the top in debug mode
  var tailBody = '"use strict";\n' + initCode + '\n' + code;

  // Build the async function
  // It receives the same runtime parameters as the main function,
  // plus __locals as the first parameter
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  var tailFn = new AsyncFunction(
    '__locals', '__scope', '__at', '__set', '__call', '__call_opt', '__new', '__check', '__thisCell', '__safeGlobals', '__dbg',
    tailBody
  );

  return tailFn;
}

exports.compile = compile;
exports.compileTail = compileTail;
exports.hashAST = hashAST;

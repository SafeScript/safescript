/**
 * SafeScript emitter — AST → JavaScript source.
 *
 * Only produces constructs the emitter explicitly knows about.
 * The grammar IS the allowlist: if a node type isn't handled here,
 * it silently produces nothing (fail-safe).
 */
'use strict';

// Debug mode state — set by emitDebug(), read by emit helpers
var _debugMode = false;
var _debugLocals = null; // stack of variable-name sets per scope level

/**
 * Collect variable names declared in an AST node (non-recursive into functions).
 * Used to build the locals closure for __dbg checkpoints.
 */
function collectDeclaredNames(node, names) {
  if (!node) return;
  switch (node.type) {
    case 'VariableDeclaration':
      for (var i = 0; i < node.declarations.length; i++) {
        collectPatternNames(node.declarations[i].id, names);
      }
      break;
    case 'FunctionDeclaration':
      if (node.id) names[node.id.name] = true;
      // Don't recurse into function body — different scope
      break;
    case 'BlockStatement':
    case 'Program':
      for (var j = 0; j < node.body.length; j++) {
        collectDeclaredNames(node.body[j], names);
      }
      break;
    case 'ForStatement':
      collectDeclaredNames(node.init, names);
      collectDeclaredNames(node.body, names);
      break;
    case 'ForInStatement':
    case 'ForOfStatement':
      collectDeclaredNames(node.left, names);
      collectDeclaredNames(node.body, names);
      break;
    case 'WhileStatement':
    case 'DoWhileStatement':
      collectDeclaredNames(node.body, names);
      break;
    case 'IfStatement':
      collectDeclaredNames(node.consequent, names);
      if (node.alternate) collectDeclaredNames(node.alternate, names);
      break;
    case 'TryStatement':
      collectDeclaredNames(node.block, names);
      if (node.handler) {
        // Don't collect the catch parameter — it's block-scoped to the catch body
        collectDeclaredNames(node.handler.body, names);
      }
      if (node.finalizer) collectDeclaredNames(node.finalizer, names);
      break;
    case 'SwitchStatement':
      for (var k = 0; k < node.cases.length; k++) {
        var c = node.cases[k];
        for (var l = 0; l < c.consequent.length; l++) {
          collectDeclaredNames(c.consequent[l], names);
        }
      }
      break;
    case 'LabeledStatement':
      collectDeclaredNames(node.body, names);
      break;
  }
}

function collectPatternNames(pat, names) {
  if (!pat) return;
  switch (pat.type) {
    case 'Identifier': names[pat.name] = true; break;
    case 'ArrayPattern':
      for (var i = 0; i < pat.elements.length; i++) {
        if (pat.elements[i]) collectPatternNames(pat.elements[i], names);
      }
      break;
    case 'ObjectPattern':
      for (var j = 0; j < pat.properties.length; j++) {
        var p = pat.properties[j];
        if (p.type === 'RestElement') collectPatternNames(p.argument, names);
        else collectPatternNames(p.value, names);
      }
      break;
    case 'AssignmentPattern': collectPatternNames(pat.left, names); break;
    case 'RestElement': collectPatternNames(pat.argument, names); break;
  }
}

/**
 * Build the __dbg checkpoint call for after a statement.
 * @param {number} line - 1-indexed source line
 * @returns {string} The checkpoint code
 */
function emitDbgCheckpoint(line) {
  if (!_debugMode || !_debugLocals) return '';
  var names = Object.keys(_debugLocals);
  var localsObj = names.length > 0
    ? '{ ' + names.map(function(n) { return n + ': ' + n; }).join(', ') + ' }'
    : '{}';
  return '\n__r = await __dbg(' + line + ', function(){ return ' + localsObj + '; });\nif (__r) return __r.value;';
}

/**
 * Get the source line from a node (if available).
 * Walks into child nodes to find the first loc.
 */
function nodeLine(node) {
  if (!node) return 0;
  if (node.line) return node.line;
  if (node.loc) return node.loc.line || 0;
  // Walk into common child structures to find position
  if (node.declarations && node.declarations[0]) {
    var d = node.declarations[0];
    if (d.id && d.id.loc) return d.id.loc.line;
  }
  if (node.expression) return nodeLine(node.expression);
  if (node.argument) return nodeLine(node.argument);
  if (node.test) return nodeLine(node.test);
  if (node.callee) return nodeLine(node.callee);
  if (node.id) return nodeLine(node.id);
  if (node.left) return nodeLine(node.left);
  if (node.object) return nodeLine(node.object);
  return 0;
}

function emit(node) {
  if (!node) return '';

  switch (node.type) {
    case 'Program':
      if (_debugMode) {
        return emitStatementsWithDbg(node.body);
      }
      return node.body.map(emit).join('\n');

    case 'ExpressionStatement':
      var exprCode = emit(node.expression) + ';';
      if (_debugMode) {
        exprCode += emitDbgCheckpoint(nodeLine(node));
      }
      return exprCode;

    case 'BlockStatement':
      if (_debugMode) {
        return '{\n' + emitStatementsWithDbg(node.body) + '\n}';
      }
      return '{\n' + node.body.map(emit).join('\n') + '\n}';

    case 'EmptyStatement':
      return ';';

    case 'VariableDeclaration':
      // In debug mode, register new variable names into _debugLocals
      if (_debugMode && _debugLocals) {
        for (var vi = 0; vi < node.declarations.length; vi++) {
          collectPatternNames(node.declarations[vi].id, _debugLocals);
        }
      }
      var varCode = node.kind + ' ' + node.declarations.map(function(d) {
        if (d.init) return emitPattern(d.id) + ' = ' + emit(d.init);
        return emitPattern(d.id);
      }).join(', ') + ';';
      if (_debugMode) {
        varCode += emitDbgCheckpoint(nodeLine(node));
      }
      return varCode;

    case 'FunctionDeclaration':
      return 'async function ' +
        (node.id ? emit(node.id) : '') +
        '(' + node.params.map(emitParam).join(', ') + ') ' +
        emitFuncBodyWithCheck(node.body);

    case 'FunctionExpression':
      return 'async function' +
        (node.id ? ' ' + emit(node.id) : '') +
        '(' + node.params.map(emitParam).join(', ') + ') ' +
        emitFuncBodyWithCheck(node.body);

    case 'ArrowFunctionExpression':
      var paramsStr;
      if (node.params.length === 1 && node.params[0].type === 'Identifier') {
        paramsStr = emit(node.params[0]);
      } else {
        paramsStr = '(' + node.params.map(emitParam).join(', ') + ')';
      }
      // Arrow with concise body → wrap in block with __check()
      if (node.body.type !== 'BlockStatement') {
        return 'async ' + paramsStr + ' => {\n__check();\nreturn ' + emit(node.body) + ';\n}';
      }
      return 'async ' + paramsStr + ' => ' + emitBodyWithCheck(node.body);

    case 'ReturnStatement':
      if (_debugMode && node.argument) {
        // Emit: var __retVal = <expr>; __dbg checkpoint; return __retVal;
        return 'var __retVal = ' + emit(node.argument) + ';' +
          emitDbgCheckpoint(nodeLine(node)) + '\nreturn __retVal;';
      }
      return node.argument ? 'return ' + emit(node.argument) + ';' : 'return;';

    case 'ThrowStatement':
      if (_debugMode) {
        // Emit checkpoint before throw
        return '{ var __throwVal = ' + emit(node.argument) + ';' +
          emitDbgCheckpoint(nodeLine(node)) + '\nthrow __throwVal; }';
      }
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
        emitLoopBody(node.body);

    case 'ForInStatement':
      return 'for (' +
        (node.left.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.left) : emit(node.left)) +
        ' in ' + emit(node.right) + ') ' + emitLoopBody(node.body);

    case 'ForOfStatement':
      return 'for (' +
        (node.left.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.left) : emit(node.left)) +
        ' of ' + emit(node.right) + ') ' + emitLoopBody(node.body);

    case 'WhileStatement':
      return 'while (' + emit(node.test) + ') ' + emitLoopBody(node.body);

    case 'DoWhileStatement':
      return 'do ' + emitLoopBody(node.body) + ' while (' + emit(node.test) + ');';

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

    case 'ThisExpression':
      return '__safeThis';

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

    case 'NewExpression':
      // new Constructor(args) → (await __new(Constructor, [args]))
      var newCalleeStr = emit(node.callee);
      var newArgs = node.arguments.map(function(a) {
        if (a.type === 'SpreadElement') return '...' + emit(a.argument);
        return emit(a);
      }).join(', ');
      return '(await __new(' + newCalleeStr + ', [' + newArgs + ']))';

    case 'CallExpression':
      // Method call on non-computed member: obj.method(args) → __call(obj, "method", args)
      if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
        var objStr = emit(node.callee.object);
        var methodName = node.callee.property.name || node.callee.property.value;
        var callFn = node.callee.optional ? '__call_opt' : '__call';
        var callArgs = [objStr, '"' + methodName + '"'];
        node.arguments.forEach(function(a) {
          if (a.type === 'SpreadElement') callArgs.push('...' + emit(a.argument));
          else callArgs.push(emit(a));
        });
        return '(await ' + callFn + '(' + callArgs.join(', ') + '))';
      }
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
            '(' + fn.params.map(emitParam).join(', ') + ') ' + emitFuncBodyWithCheck(fn.body);
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

/**
 * Emit a function body block with __check() at the top.
 * Used for ArrowFunctionExpression (no __safeThis preamble — inherits from enclosing scope).
 */
function emitBodyWithCheck(blockNode) {
  if (_debugMode) {
    return '{\n' + emitStatementsWithDbg(blockNode.body) + '\n}';
  }
  return '{\n__check();\n' + blockNode.body.map(emit).join('\n') + '\n}';
}

/**
 * Emit a regular function body with __safeThis capture preamble.
 * Used for FunctionDeclaration, FunctionExpression, object methods.
 * Captures __safeThis from __thisCell, then resets the cell.
 * Arrow functions do NOT get this — they inherit __safeThis lexically.
 */
function emitFuncBodyWithCheck(blockNode) {
  if (_debugMode) {
    return '{\nvar __safeThis = __thisCell.value; __thisCell.value = undefined;\n' +
      emitStatementsWithDbg(blockNode.body) + '\n}';
  }
  return '{\nvar __safeThis = __thisCell.value; __thisCell.value = undefined;\n__check();\n' +
    blockNode.body.map(emit).join('\n') + '\n}';
}

/**
 * Emit a loop body with __check() at the start of each iteration.
 * In debug mode, uses __dbg checkpoint instead.
 * Handles both block and single-statement bodies.
 */
function emitLoopBody(bodyNode) {
  if (_debugMode) {
    if (bodyNode.type === 'BlockStatement') {
      return '{\n' + emitStatementsWithDbg(bodyNode.body) + '\n}';
    }
    return '{\n' + emit(bodyNode) + '\n}';
  }
  if (bodyNode.type === 'BlockStatement') {
    return '{\n__check();\n' + bodyNode.body.map(emit).join('\n') + '\n}';
  }
  return '{\n__check();\n' + emit(bodyNode) + '\n}';
}

/**
 * Emit a list of statements, each followed by a __dbg checkpoint.
 * (Debug mode only.)
 */
function emitStatementsWithDbg(stmts) {
  var parts = [];
  for (var i = 0; i < stmts.length; i++) {
    parts.push(emit(stmts[i]));
    // The individual emit() cases for ExpressionStatement, VariableDeclaration,
    // ReturnStatement, ThrowStatement already add checkpoints.
    // Other statement types (if, for, while, etc.) have checkpoints in their bodies.
  }
  return parts.join('\n');
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

/**
 * Emit in debug mode: inserts __dbg checkpoints after every statement.
 * Adds `var __r;` preamble for the checkpoint return-signal variable.
 * Collects all declared variable names for the locals closure.
 */
function emitDebug(node) {
  // Collect all variable names declared in the program
  var names = Object.create(null);
  if (node.type === 'Program') {
    collectDeclaredNames(node, names);
  }

  _debugMode = true;
  _debugLocals = names;

  var code;
  try {
    code = 'var __r;\n' + emit(node);
  } finally {
    _debugMode = false;
    _debugLocals = null;
  }
  return code;
}

exports.emit = emit;
exports.emitDebug = emitDebug;

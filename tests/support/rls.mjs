// Evaluates the SELECT policies in supabase/schema.sql. A correct fix is any
// policy that does not let an anonymous client read lesson source ids.
// Matching one source string would stay green for a rename that leaves
// `using (true)` in place, and would go red for a purchase check written a
// different way.

const cache = new Map();

export function selectAllowed(schemaSql, table, row, ctx) {
  const model = modelFor(schemaSql);
  const name = table.toLowerCase();
  const info = model.get(name);
  if (!info || !info.rls) return true;
  const role = ctx.role || (ctx.uid ? "authenticated" : "anon");
  const policies = info.policies.filter((policy) => applies(policy, "select", role));
  const permissive = policies.filter((policy) => !policy.restrictive);
  const restrictive = policies.filter((policy) => policy.restrictive);
  if (permissive.length === 0) return false;
  const scope = { table: name, alias: name, row, parent: null };
  const allowed = permissive.some((policy) => evalExpr(policy.using, scope, ctx) === true);
  if (!allowed) return false;
  return restrictive.every((policy) => evalExpr(policy.using, scope, ctx) === true);
}

function modelFor(sql) {
  let model = cache.get(sql);
  if (!model) {
    model = parseSchema(sql);
    cache.set(sql, model);
  }
  return model;
}

function parseSchema(sql) {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const tables = new Map();
  const ensure = (name) => {
    const key = name.toLowerCase();
    if (!tables.has(key)) tables.set(key, { rls: false, policies: [] });
    return tables.get(key);
  };

  const rls = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][\w]*)\s+enable\s+row\s+level\s+security\s*;/gi;
  for (const match of text.matchAll(rls)) ensure(match[1]).rls = true;

  const start = /create\s+policy\s+(?:"(?:[^"]|"")*"|[a-z_][\w]*)\s+on\s+(?:public\.)?([a-z_][\w]*)\b/gi;
  for (const match of text.matchAll(start)) {
    const bodyStart = match.index + match[0].length;
    const body = readUntilSemicolon(text, bodyStart);
    ensure(match[1]).policies.push(parsePolicy(body));
  }
  return tables;
}

function readUntilSemicolon(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) return text.slice(from, i);
  }
  throw new Error("policy statement did not end");
}

function parsePolicy(body) {
  const commandMatch = body.match(/\bfor\s+(select|insert|update|delete|all)\b/i);
  const command = commandMatch ? commandMatch[1].toLowerCase() : "all";
  const toMatch = body.match(/\bto\s+([a-z_][\w]*(?:\s*,\s*[a-z_][\w]*)*)/i);
  const roles = toMatch
    ? toMatch[1].split(",").map((role) => role.trim().toLowerCase())
    : ["public"];
  return {
    command,
    roles,
    restrictive: /\bas\s+restrictive\b/i.test(body),
    using: parseClause(body, /\busing\b/i),
  };
}

function parseClause(body, keyword) {
  const found = keyword.exec(body);
  if (!found) return null;
  const open = body.indexOf("(", found.index + found[0].length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") {
      depth--;
      if (depth === 0) return parseExpression(body.slice(open + 1, i));
    }
  }
  throw new Error(`unbalanced parentheses in ${body}`);
}

function applies(policy, command, role) {
  if (policy.command !== "all" && policy.command !== command) return false;
  if (!policy.roles.includes("public") && !policy.roles.includes(role)) return false;
  if (command === "select" && !policy.using) return false;
  return true;
}

function parseExpression(source) {
  const parser = new Parser(tokenize(source));
  const ast = parser.parseOr();
  if (!parser.done()) {
    throw new Error(`leftover SQL in policy expression: ${parser.rest()} (${source})`);
  }
  return ast;
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "," || ch === ".") {
      tokens.push({ type: ch });
      i++;
      continue;
    }
    if (source.startsWith("::", i)) {
      tokens.push({ type: "cast" });
      i += 2;
      continue;
    }
    if (source.startsWith("<>", i) || source.startsWith("!=", i)) {
      tokens.push({ type: "op", value: "<>" });
      i += 2;
      continue;
    }
    if (ch === "=") {
      tokens.push({ type: "op", value: "=" });
      i++;
      continue;
    }
    if (ch === "'") {
      let value = "";
      i++;
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        if (source[i] === "'") break;
        value += source[i++];
      }
      i++;
      tokens.push({ type: "string", value });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9]/.test(source[j])) j++;
      tokens.push({ type: "number", value: Number(source.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      tokens.push({ type: "ident", value: source.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`cannot read policy SQL near ${source.slice(i, i + 24)}`);
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  done() {
    return this.pos >= this.tokens.length;
  }

  rest() {
    return this.tokens
      .slice(this.pos)
      .map((token) => token.value || token.type)
      .join(" ");
  }

  peek() {
    return this.tokens[this.pos];
  }

  eat(type) {
    if (this.peek()?.type === type) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(type) {
    if (!this.eat(type)) {
      throw new Error(`expected ${type} before ${this.rest() || "end"}`);
    }
  }

  keyword(word) {
    const token = this.peek();
    return token?.type === "ident" && token.value.toLowerCase() === word;
  }

  eatKeyword(word) {
    if (!this.keyword(word)) return false;
    this.pos++;
    return true;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.eatKeyword("or")) {
      left = { type: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.eatKeyword("and")) {
      left = { type: "and", left, right: this.parseNot() };
    }
    return left;
  }

  parseNot() {
    if (this.eatKeyword("not")) return { type: "not", value: this.parseNot() };
    return this.parsePredicate();
  }

  parsePredicate() {
    if (this.eatKeyword("exists")) {
      this.expect("(");
      const query = this.parseSelect();
      this.expect(")");
      return { type: "exists", query };
    }
    const left = this.parsePrimary();
    if (this.eatKeyword("is")) {
      const neg = this.eatKeyword("not");
      if (!this.eatKeyword("null")) throw new Error("expected NULL");
      return { type: "isnull", value: left, neg };
    }
    if (this.eatKeyword("in")) {
      this.expect("(");
      if (this.keyword("select")) {
        const query = this.parseSelect();
        this.expect(")");
        return { type: "in", value: left, query };
      }
      const values = [this.parseOr()];
      while (this.eat(",")) values.push(this.parseOr());
      this.expect(")");
      return { type: "inlist", value: left, values };
    }
    if (this.peek()?.type === "op") {
      const op = this.peek().value;
      this.pos++;
      return { type: "cmp", op, left, right: this.parsePrimary() };
    }
    return left;
  }

  parsePrimary() {
    if (this.eat("(")) {
      if (this.keyword("select")) {
        const query = this.parseSelect();
        this.expect(")");
        this.skipCast();
        return { type: "scalar", query };
      }
      const expr = this.parseOr();
      this.expect(")");
      this.skipCast();
      return expr;
    }
    const token = this.peek();
    if (!token) throw new Error("policy expression ended early");
    if (token.type === "number" || token.type === "string") {
      this.pos++;
      this.skipCast();
      return { type: "lit", value: token.value };
    }
    if (token.type !== "ident") throw new Error(`unexpected ${token.type}`);
    const parts = [token.value];
    this.pos++;
    while (this.eat(".")) {
      const next = this.peek();
      if (next?.type !== "ident") throw new Error("expected a name after '.'");
      parts.push(next.value);
      this.pos++;
    }
    if (this.eat("(")) {
      const args = [];
      if (!this.eat(")")) {
        args.push(this.parseOr());
        while (this.eat(",")) args.push(this.parseOr());
        this.expect(")");
      }
      this.skipCast();
      return { type: "call", name: parts.map((part) => part.toLowerCase()), args };
    }
    this.skipCast();
    const lower = parts.map((part) => part.toLowerCase());
    if (lower.length === 1 && (lower[0] === "true" || lower[0] === "false" || lower[0] === "null")) {
      return { type: "lit", value: lower[0] === "true" ? true : lower[0] === "false" ? false : null };
    }
    return { type: "col", parts: lower };
  }

  skipCast() {
    while (this.eat("cast")) {
      if (this.peek()?.type === "ident") this.pos++;
      while (this.eat(".")) {
        if (this.peek()?.type === "ident") this.pos++;
      }
    }
  }

  parseSelect() {
    if (!this.eatKeyword("select")) throw new Error("expected SELECT");
    const columns = [this.parseOr()];
    while (this.eat(",")) columns.push(this.parseOr());
    let from = null;
    if (this.eatKeyword("from")) from = this.parseFrom();
    let where = null;
    if (this.eatKeyword("where")) where = this.parseOr();
    return { columns, from, where };
  }

  parseFrom() {
    let name = this.readIdent();
    if (this.eat(".")) name = this.readIdent();
    let alias = name;
    if (this.eatKeyword("as")) alias = this.readIdent();
    else if (this.peek()?.type === "ident" && !this.isClauseKeyword(this.peek().value)) {
      alias = this.readIdent();
    }
    return { table: name.toLowerCase(), alias: alias.toLowerCase() };
  }

  readIdent() {
    const token = this.peek();
    if (token?.type !== "ident") throw new Error(`expected a name before ${this.rest() || "end"}`);
    this.pos++;
    return token.value;
  }

  isClauseKeyword(value) {
    return ["where", "and", "or", "union", "limit", "group", "order"].includes(value.toLowerCase());
  }
}

function evalExpr(ast, scope, ctx) {
  switch (ast.type) {
    case "lit":
      return ast.value;
    case "col":
      return lookup(ast.parts, scope);
    case "call":
      return evalCall(ast, scope, ctx);
    case "not": {
      const value = evalExpr(ast.value, scope, ctx);
      if (value === null) return null;
      return value === true ? false : value === false ? true : null;
    }
    case "and":
      return land(evalExpr(ast.left, scope, ctx), evalExpr(ast.right, scope, ctx));
    case "or":
      return lor(evalExpr(ast.left, scope, ctx), evalExpr(ast.right, scope, ctx));
    case "cmp":
      return cmp(ast.op, evalExpr(ast.left, scope, ctx), evalExpr(ast.right, scope, ctx));
    case "isnull": {
      const value = evalExpr(ast.value, scope, ctx);
      const isNull = value == null;
      return ast.neg ? !isNull : isNull;
    }
    case "exists":
      return evalExists(ast.query, scope, ctx);
    case "in":
      return evalIn(ast.value, ast.query, scope, ctx);
    case "inlist":
      return evalInList(ast.value, ast.values, scope, ctx);
    case "scalar":
      return evalScalar(ast.query, scope, ctx);
    default:
      throw new Error(`unknown policy node ${ast.type}`);
  }
}

function evalCall(ast, scope, ctx) {
  const name = ast.name.join(".");
  if (name === "auth.uid") return ctx.uid == null ? null : ctx.uid;
  if (name === "auth.role") return ctx.role ?? null;
  if (name === "auth.jwt") return null;
  throw new Error(`unsupported policy function ${name}`);
}

function lookup(parts, scope) {
  if (parts.length >= 2) {
    const qual = parts[parts.length - 2];
    const col = parts[parts.length - 1];
    let current = scope;
    while (current) {
      if (current.alias === qual || current.table === qual) {
        if (current.row && Object.prototype.hasOwnProperty.call(current.row, col)) return current.row[col];
        return null;
      }
      current = current.parent;
    }
    return null;
  }
  const col = parts[0];
  let current = scope;
  while (current) {
    if (current.row && Object.prototype.hasOwnProperty.call(current.row, col)) return current.row[col];
    current = current.parent;
  }
  return null;
}

function cmp(op, left, right) {
  if (left == null || right == null) return null;
  const same = left === right || String(left) === String(right);
  if (op === "=") return same;
  if (op === "<>") return !same;
  return null;
}

function land(left, right) {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return null;
}

function lor(left, right) {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return null;
}

function rowsOf(table, ctx) {
  const tables = ctx.tables || {};
  return Array.isArray(tables[table]) ? tables[table] : [];
}

function childScope(from, row, parent) {
  return { table: from.table, alias: from.alias || from.table, row, parent };
}

function matchingRows(query, scope, ctx) {
  if (!query.from) return query.where && evalExpr(query.where, scope, ctx) !== true ? [] : [scope.row || {}];
  const matched = [];
  for (const row of rowsOf(query.from.table, ctx)) {
    const inner = childScope(query.from, row, scope);
    if (!query.where || evalExpr(query.where, inner, ctx) === true) matched.push(inner);
  }
  return matched;
}

function evalExists(query, scope, ctx) {
  return matchingRows(query, scope, ctx).length > 0;
}

function evalScalar(query, scope, ctx) {
  const rows = matchingRows(query, scope, ctx);
  if (rows.length !== 1) return null;
  return evalExpr(query.columns[0], rows[0], ctx);
}

function evalIn(valueAst, query, scope, ctx) {
  const left = evalExpr(valueAst, scope, ctx);
  if (left == null) return null;
  let sawNull = false;
  for (const inner of matchingRows(query, scope, ctx)) {
    const result = cmp("=", left, evalExpr(query.columns[0], inner, ctx));
    if (result === true) return true;
    if (result === null) sawNull = true;
  }
  return sawNull ? null : false;
}

function evalInList(valueAst, values, scope, ctx) {
  const left = evalExpr(valueAst, scope, ctx);
  if (left == null) return null;
  let sawNull = false;
  for (const item of values) {
    const result = cmp("=", left, evalExpr(item, scope, ctx));
    if (result === true) return true;
    if (result === null) sawNull = true;
  }
  return sawNull ? null : false;
}

import ts from "typescript";

// What one source file says about the code graph: the names it defines, what
// it imports from where, and the names it calls (a JSX element counts as a
// call of its component). Only the syntax is read, never the types, so a file
// parses in well under a millisecond and a broken one still yields facts.

type SymbolFact = {
  name: string;
  kind: "function" | "class" | "method" | "variable" | "type";
  line: number;
  endLine: number;
  exported: boolean;
};

// One imported name: `local` as the file uses it, `imported` as the other file
// exports it, "default" for a default import, and "*" for a namespace.
type ImportFact = { specifier: string; local: string; imported: string };

// `caller` is the enclosing function, or null at the top level; `object` is
// the namespace or value a method is called on (`api` in `api.load()`).
type CallFact = { caller: string | null; name: string; object: string | null; line: number };

export type FileFacts = {
  symbols: SymbolFact[];
  imports: ImportFact[];
  calls: CallFact[];
  defaultExport: string | null;
};

const scriptKinds: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

export const sourceExtensions = Object.keys(scriptKinds);

type Walk = { source: ts.SourceFile; facts: FileFacts; caller: string | null };

const lineOf = (walk: Walk, position: number) =>
  walk.source.getLineAndCharacterOfPosition(position).line + 1;

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function define(walk: Walk, node: ts.Node, name: string, kind: SymbolFact["kind"]): void {
  const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
  const line = lineOf(walk, node.getStart(walk.source));
  walk.facts.symbols.push({ name, kind, line, endLine: lineOf(walk, node.end), exported });
  if (exported && hasModifier(node, ts.SyntaxKind.DefaultKeyword)) walk.facts.defaultExport = name;
}

function importClause(walk: Walk, specifier: string, clause: ts.ImportClause | undefined): void {
  const add = (local: string, imported: string) =>
    void walk.facts.imports.push({ specifier, local, imported });
  if (!clause) return add("", "");
  if (clause.name) add(clause.name.text, "default");
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) add(bindings.name.text, "*");
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      add(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
}

// `export { a } from "./b"` and `export * from "./b"` make this file depend on
// ./b, like an import does.
function reexport(walk: Walk, node: ts.ExportDeclaration): void {
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;
  const specifier = node.moduleSpecifier.text;
  const elements =
    node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
  if (elements.length === 0) walk.facts.imports.push({ specifier, local: "", imported: "*" });
  for (const element of elements) {
    walk.facts.imports.push({
      specifier,
      local: "",
      imported: (element.propertyName ?? element.name).text,
    });
  }
}

function call(walk: Walk, callee: ts.Node, at: number): void {
  const line = lineOf(walk, at);
  if (ts.isIdentifier(callee)) {
    walk.facts.calls.push({ caller: walk.caller, name: callee.text, object: null, line });
  } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
    const object = ts.isIdentifier(callee.expression) ? callee.expression.text : null;
    walk.facts.calls.push({ caller: walk.caller, name: callee.name.text, object, line });
  }
}

// `require("x")` and `import("x")` with a fixed string are imports too.
function dynamicImport(walk: Walk, node: ts.CallExpression): boolean {
  const [first] = node.arguments;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (!(isRequire || isImport) || !first || !ts.isStringLiteral(first)) return false;
  walk.facts.imports.push({ specifier: first.text, local: "", imported: "*" });
  return true;
}

type Named = { name: string; kind: SymbolFact["kind"] };

// A class's method is named after its class: `Session.login`.
function method(node: ts.MethodDeclaration): Named | undefined {
  if (!ts.isIdentifier(node.name)) return undefined;
  const owner = ts.isClassDeclaration(node.parent) ? node.parent.name?.text : undefined;
  return { name: owner ? `${owner}.${node.name.text}` : node.name.text, kind: "method" };
}

// A function, class, type, or method bound to a name, and what that name is.
function declared(node: ts.Node): Named | undefined {
  if (ts.isMethodDeclaration(node)) return method(node);
  const kind: SymbolFact["kind"] | undefined = ts.isFunctionDeclaration(node)
    ? "function"
    : ts.isClassDeclaration(node)
      ? "class"
      : ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
        ? "type"
        : undefined;
  const name = kind ? (node as ts.DeclarationStatement).name : undefined;
  return kind && name && ts.isIdentifier(name) ? { name: name.text, kind } : undefined;
}

// `const load = () => …` and `export const Card = function …` are functions;
// any other top-level const is a variable.
function variables(walk: Walk, statement: ts.VariableStatement): void {
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const value = declaration.initializer;
    const isFunction = value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
    define(walk, statement, declaration.name.text, isFunction ? "function" : "variable");
  }
}

function inside(walk: Walk, node: ts.Node, caller: string): void {
  const saved = walk.caller;
  walk.caller = caller;
  ts.forEachChild(node, (child) => visit(walk, child));
  walk.caller = saved;
}

function visitDeclaration(walk: Walk, node: ts.Node): boolean {
  const named = declared(node);
  if (named) {
    define(walk, node, named.name, named.kind);
    inside(walk, node, named.name);
    return true;
  }
  // Only module-level consts are names other files can use.
  if (ts.isVariableStatement(node) && ts.isSourceFile(node.parent)) {
    variables(walk, node);
    for (const declaration of node.declarationList.declarations) {
      const name = ts.isIdentifier(declaration.name) ? declaration.name.text : null;
      if (name) inside(walk, declaration, name);
    }
    return true;
  }
  return false;
}

function visitReference(walk: Walk, node: ts.Node): void {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    importClause(walk, node.moduleSpecifier.text, node.importClause);
  } else if (ts.isExportDeclaration(node)) {
    reexport(walk, node);
  } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
    walk.facts.defaultExport = node.expression.text;
  } else {
    visitCall(walk, node);
  }
}

function visitCall(walk: Walk, node: ts.Node): void {
  const at = () => node.getStart(walk.source);
  if (ts.isCallExpression(node) && !dynamicImport(walk, node)) call(walk, node.expression, at());
  else if (ts.isNewExpression(node)) call(walk, node.expression, at());
  else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    // Lower-case tags are HTML elements, not components.
    if (/^[A-Z]/.test(node.tagName.getText(walk.source))) call(walk, node.tagName, at());
  }
}

function visit(walk: Walk, node: ts.Node): void {
  if (visitDeclaration(walk, node)) return;
  visitReference(walk, node);
  ts.forEachChild(node, (child) => visit(walk, child));
}

export function parseSource(path: string, text: string): FileFacts {
  const extension = path.slice(path.lastIndexOf("."));
  const kind = scriptKinds[extension] ?? ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const facts: FileFacts = { symbols: [], imports: [], calls: [], defaultExport: null };
  visit({ source, facts, caller: null }, source);
  return facts;
}

import type { ChangedFile } from '@openmaintainer/core';
import { asRecord, redact, safePath } from '@openmaintainer/shared';
import ts from 'typescript';

export interface Evidence {
  path: string;
  side: 'before' | 'after';
  line: number;
  text: string;
}
export interface ContractChange {
  id: string;
  kind: string;
  symbol: string;
  path: string;
  title: string;
  reason: string;
  migration: string;
  evidence: Evidence[];
}
interface Declaration {
  node: ts.Node;
  signature: string;
  required: number;
  defaults: string;
  literal?: string;
  fields: Map<string, { required: boolean; signature: string }>;
}
const printer = ts.createPrinter({ removeComments: true });
const print = (node: ts.Node, source: ts.SourceFile) =>
  printer.printNode(ts.EmitHint.Unspecified, node, source);
function declarations(source: ts.SourceFile) {
  const local = new Map<string, Declaration>();
  const exported = new Map<string, Declaration>();
  const callable = (node: ts.SignatureDeclarationBase): Declaration => ({
    node,
    signature: `${node.typeParameters?.map((p) => print(p, source)).join(',') ?? ''}(${node.parameters.map((p) => `${p.dotDotDotToken ? '...' : ''}${p.questionToken || p.initializer ? '?' : '!'}:${p.type ? print(p.type, source) : 'inferred'}`).join(',')}):${node.type ? print(node.type, source) : 'inferred'}`,
    required: node.parameters.filter((p) => !p.questionToken && !p.initializer && !p.dotDotDotToken).length,
    defaults: JSON.stringify(
      node.parameters.flatMap((p, index) => (p.initializer ? [[index, print(p.initializer, source)]] : [])),
    ),
    fields: new Map(),
  });
  const plain = (node: ts.Node, signature: string): Declaration => ({
    node,
    signature,
    required: 0,
    defaults: '[]',
    fields: new Map(),
  });
  function put(name: string, value: Declaration, node: ts.Node) {
    local.set(name, value);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      exported.set(modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ? 'default' : name, value);
  }
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node)) put(node.name?.text ?? 'default', callable(node), node);
    else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        const value =
          initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            ? callable(initializer)
            : plain(declaration, declaration.type ? print(declaration.type, source) : 'inferred');
        if (
          declaration.type &&
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        )
          value.signature += `:${print(declaration.type, source)}`;
        if (
          initializer &&
          (ts.isLiteralExpression(initializer) ||
            [
              ts.SyntaxKind.TrueKeyword,
              ts.SyntaxKind.FalseKeyword,
              ts.SyntaxKind.NullKeyword,
              ts.SyntaxKind.PrefixUnaryExpression,
            ].includes(initializer.kind))
        )
          value.literal = print(initializer, source);
        put(declaration.name.text, value, node);
      }
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const value = plain(node, print(node, source));
      const members = ts.isInterfaceDeclaration(node)
        ? node.members
        : ts.isTypeLiteralNode(node.type)
          ? node.type.members
          : [];
      for (const member of members)
        if (member.name)
          value.fields.set(member.name.getText(source), {
            required: !('questionToken' in member && member.questionToken),
            signature: print(member, source),
          });
      put(node.name.text, value, node);
    } else if (ts.isClassDeclaration(node) && node.name) put(node.name.text, plain(node, 'class'), node);
  }
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const entry of node.exportClause.elements) {
        const target = node.moduleSpecifier
          ? undefined
          : local.get(entry.propertyName?.text ?? entry.name.text);
        exported.set(entry.name.text, target ?? plain(node, print(node, source)));
      }
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      exported.set(
        'default',
        ts.isIdentifier(node.expression)
          ? (local.get(node.expression.text) ?? plain(node, print(node, source)))
          : ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression)
            ? callable(node.expression)
            : plain(node, print(node, source)),
      );
    }
  }
  return exported;
}
export function contractChanges(files: ChangedFile[]) {
  const changes: ContractChange[] = [];
  const limitations: string[] = [
    'Syntactic TypeScript/JavaScript contract comparison, not a type-checker or proof of consumer breakage. Wildcard re-exports, overload resolution, inferred return types and class member compatibility are not resolved. A file export may not be a package public entrypoint.',
  ];
  for (const file of files) {
    safePath(file.path);
    if (file.before === undefined || file.after === undefined) continue;
    const beforePath = file.previousPath ?? file.path;
    const evidence = (source: ts.SourceFile, node: ts.Node, side: 'before' | 'after'): Evidence => ({
      path: side === 'before' ? beforePath : file.path,
      side,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      text: redact(node.getText(source)).slice(0, 700),
    });
    const add = (kind: string, symbol: string, reason: string, migration: string, items: Evidence[]) => {
      if (changes.length >= 200) return;
      changes.push({
        id: `${file.path}:${kind}:${symbol}`,
        kind,
        symbol,
        path: file.path,
        title: `${kind.replaceAll('-', ' ')}: ${symbol}`,
        reason,
        migration,
        evidence: items,
      });
    };
    if (/\.[cm]?[jt]sx?$/.test(file.path)) {
      const oldSource = ts.createSourceFile(beforePath, file.before, ts.ScriptTarget.Latest, true);
      const newSource = ts.createSourceFile(file.path, file.after, ts.ScriptTarget.Latest, true);
      // Parsing diagnostics are available on parsed SourceFiles, but not part of the public SourceFile type.
      const invalid = [oldSource, newSource].some(
        (source) =>
          (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
            ?.length,
      );
      if (invalid) {
        limitations.push(
          `Skipped contract comparison for ${file.path}: syntax could not be parsed reliably.`,
        );
        continue;
      }
      const old = declarations(oldSource),
        next = declarations(newSource);
      for (const [name, previous] of old) {
        const current = next.get(name);
        const items = [
          evidence(oldSource, previous.node, 'before'),
          ...(current ? [evidence(newSource, current.node, 'after')] : []),
        ];
        if (!current)
          add(
            'removed-export',
            name,
            'An explicit export present in the base version is absent at the head.',
            'Restore a compatibility export or update consumer imports and document the replacement.',
            items,
          );
        else {
          if (current.required > previous.required)
            add(
              'required-parameter',
              name,
              `${previous.required} required parameters became ${current.required}; existing calls may omit a newly required argument.`,
              'Check old call sites; preserve a default/overload or document the new argument.',
              items,
            );
          else if (current.signature !== previous.signature)
            add(
              'changed-contract',
              name,
              'The declared contract changed; additions or wider types may still be compatible.',
              'Compile representative consumers against the new declaration before deciding on a breaking release.',
              items,
            );
          if (previous.defaults !== current.defaults)
            add(
              'changed-default',
              name,
              'Parameter default expressions changed. Callers omitting arguments may observe different behavior.',
              'Test omitted-argument calls and document the old and new default behavior.',
              items,
            );
          if (
            previous.literal !== undefined &&
            current.literal !== undefined &&
            previous.literal !== current.literal
          )
            add(
              'changed-exported-value',
              name,
              'An exported literal value changed.',
              'Check consumers relying on the old value and explain the behavior change in release notes.',
              items,
            );
          for (const [field, info] of previous.fields) {
            const updated = current.fields.get(field);
            if (!updated)
              add(
                'removed-field',
                `${name}.${field}`,
                'An explicit type member is no longer present.',
                'Check object readers and migration paths for the removed field.',
                items,
              );
            else if (!info.required && updated.required)
              add(
                'required-field',
                `${name}.${field}`,
                'An optional member became required.',
                'Compile an old minimal object and provide a default or migration for the required field.',
                items,
              );
          }
          for (const [field, info] of current.fields)
            if (info.required && !previous.fields.has(field))
              add(
                'required-field',
                `${name}.${field}`,
                'A new required type member was added.',
                'Check existing object construction sites and document how to populate the new field.',
                items,
              );
        }
      }
    } else if (/(^|\/)(package\.json|[^/]*config[^/]*\.json)$/.test(file.path)) {
      try {
        const old = asRecord(JSON.parse(file.before || '{}')),
          next = asRecord(JSON.parse(file.after || '{}'));
        const keys = file.path.endsWith('package.json')
          ? ['exports', 'main', 'types', 'type', 'engines', 'peerDependencies']
          : [...new Set([...Object.keys(old), ...Object.keys(next)])];
        for (const key of keys) {
          if (!(key in old) || JSON.stringify(old[key]) === JSON.stringify(next[key])) continue;
          const jsonEvidence = (text: string, side: 'before' | 'after'): Evidence => {
            const lines = text.split(/\r?\n/),
              index = lines.findIndex((line) => line.includes(JSON.stringify(key)));
            return {
              path: side === 'before' ? beforePath : file.path,
              side,
              line: Math.max(0, index) + 1,
              text: redact(JSON.stringify(side === 'before' ? old[key] : next[key]) ?? '(removed)').slice(
                0,
                700,
              ),
            };
          };
          add(
            file.path.endsWith('package.json') ? 'package-contract' : 'configuration-default',
            key,
            'An existing configuration value or package contract changed. Compatibility depends on consumers.',
            'Exercise consumers with the previous configuration and document any required migration.',
            [jsonEvidence(file.before, 'before'), jsonEvidence(file.after, 'after')],
          );
        }
      } catch {
        limitations.push(`Skipped invalid JSON in ${file.path}.`);
      }
    }
  }
  if (changes.length === 200)
    limitations.push('Contract output is capped at 200 findings; additional changes may be omitted.');
  return { changes, limitations };
}

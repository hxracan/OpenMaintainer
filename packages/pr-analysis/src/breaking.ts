import type { ChangedFile, Finding } from '@openmaintainer/core';
import { asRecord } from '@openmaintainer/shared';
import semver from 'semver';
import ts from 'typescript';

interface ExportInfo {
  signature: string;
  requiredParameters: number;
  fields: Set<string>;
}
function exported(source: string, path: string): Map<string, ExportInfo> {
  const file = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
    result = new Map<string, ExportInfo>();
  for (const node of file.statements) {
    if (
      !ts.canHaveModifiers(node) ||
      !ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    if (ts.isFunctionDeclaration(node) && node.name) {
      result.set(node.name.text, {
        signature: `${node.parameters.map((p) => p.getText(file)).join(',')}:${node.type?.getText(file) ?? 'inferred'}`,
        requiredParameters: node.parameters.filter(
          (p) => !p.questionToken && !p.initializer && !p.dotDotDotToken,
        ).length,
        fields: new Set(),
      });
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
      const members = ts.isInterfaceDeclaration(node)
        ? node.members
        : ts.isTypeLiteralNode(node.type)
          ? node.type.members
          : [];
      result.set(node.name.text, {
        signature: node.getText(file).replace(/\s+/g, ' '),
        requiredParameters: 0,
        fields: new Set(members.flatMap((m) => (m.name ? [m.name.getText(file)] : []))),
      });
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations)
        if (ts.isIdentifier(d.name))
          result.set(d.name.text, {
            signature: d.type?.getText(file) ?? 'inferred',
            requiredParameters: 0,
            fields: new Set(),
          });
    } else if (ts.isClassDeclaration(node) && node.name)
      result.set(node.name.text, { signature: 'class', requiredParameters: 0, fields: new Set() });
  }
  for (const node of file.statements)
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause))
      for (const e of node.exportClause.elements)
        result.set(e.name.text, { signature: e.getText(file), requiredParameters: 0, fields: new Set() });
  return result;
}
export function breakingChanges(files: ChangedFile[]): Finding[] {
  const findings: Finding[] = [];
  const add = (path: string, ruleId: string, title: string, explanation: string) =>
    findings.push({ path, ruleId, severity: 'warning', title, explanation });
  for (const file of files) {
    if (file.before !== undefined && file.after !== undefined && /\.[cm]?[jt]sx?$/.test(file.path)) {
      const before = exported(file.before, file.path),
        after = exported(file.after, file.path);
      for (const [name, old] of before) {
        const current = after.get(name);
        if (!current)
          add(
            file.path,
            'breaking.removed-export',
            `Export removed: ${name}`,
            'A named export disappeared. Consumers may fail; a rename also appears as removal.',
          );
        else if (current.signature !== old.signature)
          add(
            file.path,
            'breaking.signature',
            `Export contract changed: ${name}`,
            'A declared signature or type changed. Compatibility requires maintainer review.',
          );
        if (current)
          for (const field of old.fields)
            if (!current.fields.has(field))
              add(
                file.path,
                'breaking.field',
                `Field removed: ${name}.${field}`,
                'A public type member disappeared; API response and configuration consumers may break.',
              );
      }
      const flags = (s: string) =>
        new Set(
          [...s.matchAll(/\.(?:option|requiredOption)\(\s*['"][^'"]*?(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]),
        );
      const newFlags = flags(file.after);
      for (const flag of flags(file.before))
        if (!newFlags.has(flag))
          add(
            file.path,
            'breaking.cli',
            `CLI flag removed: ${flag}`,
            'A declared Commander option was removed.',
          );
    }
    if (
      file.status === 'removed' &&
      /\.[cm]?[jt]sx?$/.test(file.path) &&
      file.before &&
      exported(file.before, file.path).size
    )
      add(
        file.path,
        'breaking.module',
        'Exported module deleted',
        'This file declared exports before deletion. Verify entrypoints and consumers.',
      );
    if (file.path.endsWith('package.json') && file.before && file.after) {
      try {
        const old = asRecord(JSON.parse(file.before)),
          next = asRecord(JSON.parse(file.after));
        for (const section of ['dependencies', 'peerDependencies']) {
          for (const [name, version] of Object.entries(asRecord(next[section]))) {
            const previous = asRecord(old[section])[name];
            if (typeof version !== 'string' || typeof previous !== 'string') continue;
            const a = semver.minVersion(previous),
              b = semver.minVersion(version);
            if (a && b && b.major > a.major)
              add(
                file.path,
                'breaking.dependency-major',
                `Major dependency upgrade: ${name}`,
                `${previous} → ${version}`,
              );
          }
        }
      } catch {
        add(
          file.path,
          'breaking.manifest',
          'Manifest comparison unavailable',
          'One of the dependency manifests is invalid JSON.',
        );
      }
    }
    if (
      /migration/i.test(file.path) &&
      /\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|ALTER\s+COLUMN|SET\s+NOT\s+NULL)\b/i.test(
        file.after ?? file.patch ?? '',
      )
    )
      add(
        file.path,
        'breaking.database',
        'Potentially destructive migration',
        'Migration includes destructive or constraint-changing SQL. Review backup and rollback procedures.',
      );
    if (/config.*\.json$/i.test(file.path) && file.before && file.after) {
      try {
        const old = asRecord(JSON.parse(file.before)),
          next = asRecord(JSON.parse(file.after));
        for (const key of Object.keys(old))
          if (!(key in next))
            add(
              file.path,
              'breaking.config',
              `Configuration field removed: ${key}`,
              'Top-level configuration key was removed.',
            );
      } catch {
        /* Invalid JSON is handled by the repository manifest analyzer. */
      }
    }
  }
  return findings;
}

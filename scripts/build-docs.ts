import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  source = resolve(root, 'docs'),
  target = resolve(root, 'apps/docs/dist');
const pages = (await readdir(source)).filter((f) => f.endsWith('.md')).sort();
const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const parser = new Marked({
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
  },
});
await mkdir(target, { recursive: true });
for (const page of pages) {
  const input = await readFile(resolve(source, page), 'utf8');
  const title = input.match(/^# (.+)$/m)?.[1] ?? page;
  const html = (await parser.parse(input)).replace(/href="([^":#]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
  const navigation = pages
    .filter((p) => p !== 'implementation-plan.md')
    .map(
      (p) =>
        `<a href="${p.replace('.md', '.html')}"${p === page ? ' aria-current="page"' : ''}>${escapeHtml(p.replace('.md', '').replaceAll('-', ' '))}</a>`,
    )
    .join('');
  await writeFile(
    resolve(target, page.replace('.md', '.html')),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)} · OpenMaintainer</title><link rel="stylesheet" href="styles.css"></head><body><a class="skip" href="#content">Skip to content</a><header><a href="index.html">◈ OpenMaintainer</a><span>Documentation · 0.1.0</span><a href="https://github.com/hxracan/OpenMaintainer">Source ↗</a></header><div class="layout"><nav aria-label="Documentation">${navigation}</nav><main id="content">${html}</main></div><footer>Self-hosted. Deterministic first. Human decisions.</footer></body></html>`,
  );
}
await cp(resolve(source, 'assets'), resolve(target, 'assets'), { recursive: true });
await cp(resolve(source, 'openapi.json'), resolve(target, 'openapi.json'));
await cp(resolve(root, 'apps/docs/styles.css'), resolve(target, 'styles.css'));
console.log(`Built ${pages.length} documentation pages`);

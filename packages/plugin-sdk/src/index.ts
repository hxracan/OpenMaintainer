import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { SourceFile } from '@openmaintainer/core';
import { AppError } from '@openmaintainer/shared';
import { z } from 'zod';

export const capabilities = ['analyzer', 'command', 'condition', 'action', 'dashboard', 'ai'] as const;
export type Capability = (typeof capabilities)[number];
export const manifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]{1,64}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
    description: z.string().max(1000),
    entry: z.string().max(4096),
    capabilities: z.array(z.enum(capabilities)).min(1).max(6),
  })
  .strict();
export type PluginManifest = z.infer<typeof manifestSchema>;
export interface PluginContext {
  repository: string;
  files: SourceFile[];
}
export interface PluginFinding {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  path?: string;
}
export interface Plugin {
  analyze?: (context: PluginContext) => PluginFinding[] | Promise<PluginFinding[]>;
  command?: (input: unknown) => unknown | Promise<unknown>;
  condition?: (input: unknown) => boolean | Promise<boolean>;
  action?: (input: unknown) => unknown | Promise<unknown>;
  dashboard?: (input: unknown) => unknown | Promise<unknown>;
  ai?: (input: unknown) => unknown | Promise<unknown>;
}
export const definePlugin = (plugin: Plugin): Plugin => plugin;
const findingsSchema = z
  .array(
    z
      .object({
        id: z.string().max(100),
        severity: z.enum(['info', 'warning', 'error']),
        title: z.string().max(300),
        detail: z.string().max(4000),
        path: z.string().max(1000).optional(),
      })
      .strict(),
  )
  .max(100);
export async function loadRegistry(file: string): Promise<PluginManifest[]> {
  const metadata = await stat(file);
  if (metadata.size > 128000) throw new AppError('PLUGIN_REGISTRY', 'Plugin registry exceeds size limit');
  const manifests = z
    .array(manifestSchema)
    .max(30)
    .parse(JSON.parse(await readFile(file, 'utf8')));
  if (new Set(manifests.map((m) => m.name)).size !== manifests.length)
    throw new AppError('PLUGIN_REGISTRY', 'Plugin names must be unique');
  for (const manifest of manifests) {
    if (!isAbsolute(manifest.entry) || !/\.(mjs|js)$/.test(manifest.entry))
      throw new AppError('PLUGIN_ENTRY', 'Plugin registry requires absolute built JavaScript entries');
    manifest.entry = await realpath(manifest.entry);
  }
  return manifests;
}
// Workers contain ordinary crashes/timeouts, NOT malicious code. Install only trusted operator code.
// Plugins receive no app secrets in their environment but retain host filesystem/network privileges.
export async function invokePlugin(
  manifest: PluginManifest,
  capability: Capability,
  input: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  manifestSchema.parse(manifest);
  if (!manifest.capabilities.includes(capability))
    throw new AppError('PLUGIN_CAPABILITY', 'Plugin did not declare this capability');
  if (Buffer.byteLength(JSON.stringify(input)) > 4_000_000)
    throw new AppError('PLUGIN_INPUT', 'Plugin input exceeds size limit');
  options.signal?.throwIfAborted();
  const handler = capability === 'analyzer' ? 'analyze' : capability;
  const worker = new Worker(
    `
    const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{
      const module=await import(workerData.url), plugin=module.default;
      if(!plugin || typeof plugin[workerData.handler]!=='function') throw new Error('Missing capability handler');
      const result=await plugin[workerData.handler](workerData.input);
      const json=JSON.stringify(result);
      if(!json || Buffer.byteLength(json)>512000) throw new Error('Invalid output size');
      parentPort.postMessage({ok:true,value:JSON.parse(json)});
    })().catch(()=>parentPort.postMessage({ok:false}));
  `,
    {
      eval: true,
      env: {},
      execArgv: [],
      workerData: { url: pathToFileURL(manifest.entry).href, handler, input },
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
    },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new AppError('PLUGIN_ABORTED', 'Plugin execution cancelled'));
    const timer = setTimeout(
      () => finish(new AppError('PLUGIN_TIMEOUT', 'Plugin execution timed out')),
      options.timeoutMs ?? 5000,
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.on('error', () => finish(new AppError('PLUGIN_FAILED', 'Plugin worker failed')));
    worker.on('exit', () => finish(new AppError('PLUGIN_FAILED', 'Plugin exited without a result')));
    worker.on('message', (message: { ok?: boolean; value?: unknown }) => {
      if (!message.ok) return finish(new AppError('PLUGIN_FAILED', 'Plugin handler failed'));
      try {
        const value =
          capability === 'analyzer'
            ? findingsSchema.parse(message.value)
            : capability === 'condition'
              ? z.boolean().parse(message.value)
              : message.value;
        finish(undefined, value);
      } catch {
        finish(new AppError('PLUGIN_OUTPUT', 'Plugin returned invalid output'));
      }
    });
  });
}
export async function analyzeWithPlugins(
  manifests: PluginManifest[],
  context: PluginContext,
  signal?: AbortSignal,
) {
  const results: { plugin: string; findings: PluginFinding[]; error?: string }[] = [];
  for (const manifest of manifests.filter((m) => m.capabilities.includes('analyzer'))) {
    try {
      const findings = (await invokePlugin(manifest, 'analyzer', context, { signal })) as PluginFinding[];
      results.push({ plugin: manifest.name, findings });
    } catch (error) {
      signal?.throwIfAborted();
      results.push({
        plugin: manifest.name,
        findings: [],
        error: error instanceof AppError ? error.code : 'PLUGIN_FAILED',
      });
    }
  }
  return results;
}

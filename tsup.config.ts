import { defineConfig } from 'tsup';
export default defineConfig({
  format: ['esm'],
  target: 'node24',
  sourcemap: true,
  clean: true,
  noExternal: [/^@openmaintainer\//],
  external: [/^(?!@openmaintainer\/)[^./]/],
});

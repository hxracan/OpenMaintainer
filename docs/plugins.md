# Trusted plugins

Examples: license-policy, generated-artifacts, changelog-policy under examples/plugins. These are real analyzers, not demo stubs. They consume bounded file inventories; absent content must not be treated as proof about a file.

```sh
pnpm cli plugin install examples/plugins/license-policy/plugin.json --trust-code
pnpm cli plugin list
```

Set OPENMAINTAINER_PLUGINS to the absolute path of .openmaintainer/plugins.json and restart workers. Keep registries consistent across workers. Registered analyzer results appear in repository analysis history. The dashboard registry is informational, not a browser-based code installer.

## Contract

A strict plugin.json declares name, semantic version, description, built JavaScript entry and capabilities. Its module default export implements analyze(context), command(input), condition(input), action(input), dashboard(input) or ai(input). TypeScript authors can use definePlugin from @openmaintainer/plugin-sdk and build to ESM.

analyze returns up to 100 validated findings with id, severity, title, detail and optional path. condition returns a boolean. Other capabilities return bounded JSON. The SDK's invokePlugin provides the same isolated invocation interface for each capability.

Only analyzer is auto-wired into repository scans. Other capabilities are invocable explicitly with the SDK or CLI, not automatically injected into policy, dashboard rendering or AI prompts:

```sh
pnpm cli plugin run changelog-policy --capability condition --input examples/plugin-input.json
```

## Trust and containment

Registration never downloads packages or executes install scripts. Workers have a five-second default timeout, 64 MB old-generation limit, discarded stdout/stderr, empty environment and bounded inputs/outputs. A plugin failure is recorded without losing other analyzer results.

**This is not a security sandbox.** Trusted code can access the host filesystem/network and may affect other processes. Worker limits are not a defense against malicious native code or all resource exhaustion. Never auto-install plugins from analyzed repositories or user-submitted manifests. Host/container isolation is an operator responsibility.

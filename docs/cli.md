# CLI reference

Run `pnpm cli --help` from the checkout or `node packages/cli/dist/main.js --help` after building. There is no published npm CLI package yet.

Global options: --json produces machine-readable JSON; --quiet suppresses successful output; --verbose enables diagnostic command context; --repo owner/name selects GitHub scope; --token-env NAME selects a token environment variable (default GITHUB_TOKEN). Tokens never belong in command arguments.

Use --cli-version or -V for the tool's version; release commands reserve --version for the current package version.

## Commands

```sh
pnpm cli init
pnpm cli doctor
pnpm cli config validate .openmaintainer.yml
pnpm cli repo scan .
pnpm cli repo health .
pnpm cli --repo owner/repo pr analyze 42
pnpm cli --repo owner/repo issue analyze 12
pnpm cli --repo owner/repo issue duplicates 12
pnpm cli ci analyze ./build.log
pnpm cli --repo owner/repo ci analyze 123456
pnpm cli release prepare --version 1.0.0 --commits examples/commits.json
pnpm cli release notes --version 1.0.0 --commits examples/commits.json --output notes.md
pnpm cli release validate --version 1.1.0 --notes notes.md
pnpm cli automations list examples/policies.yml
pnpm cli automations validate examples/policies.yml
pnpm cli plugin list
pnpm cli plugin install examples/plugins/license-policy/plugin.json --trust-code
```

release status calculates the same preview as prepare, without saving or publishing. Optional --changeset FILE --package NAME merges a Changeset recommendation; --rc NUMBER produces a candidate. --output uses exclusive creation and will not overwrite a file.

repo health is a local structural check: remote issue/review/release data is unavailable, not an endorsement of health. CI analysis uses up to ten failed logs in the first hundred jobs. Duplicate ranking is lexical, not calibrated probability.

Exit code 0 means command completion, not absence of warnings; 1 indicates failure; release validation returns 2 when invalid. Errors are redacted. Human output is formatted JSON for consistent inspectability.

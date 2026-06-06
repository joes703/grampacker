# Supply-chain security

This project uses npm packages and GitHub-hosted CI. The goal is not to make dependency risk disappear; it is to make dependency changes slower, more visible, and easier to reject.

This policy implements the relevant recommendations from Supabase's [Securing npm installs](https://supabase.com/docs/guides/security/npm-security) guide, reviewed June 6, 2026. The guidance applies to the entire npm dependency tree, not only `@supabase/*` packages.

## What is enforced in this repo

### Exact package versions

`.npmrc` sets `save-exact=true`, so newly added dependencies are saved as exact versions instead of broad semver ranges. `package-lock.json` pins the full resolved tree.

Tradeoff: updates are more deliberate. That is useful here; a small app should not silently float to new dependency versions.

### New releases are quarantined

`.npmrc` sets `min-release-age=7`. npm can install versions already pinned in `package-lock.json`, but when resolving an update it refuses versions published less than seven days ago. Dependabot uses a matching seven-day cooldown for routine npm version updates.

Why: most package compromises are detected within hours or days. Waiting avoids being among the first consumers of a newly compromised release.

Tradeoff: routine fixes arrive at least seven days after publication. An urgent security update can be reviewed and applied deliberately with `npm install <package>@<version> --min-release-age=0`.

Do not permanently lower `min-release-age` in `.npmrc` for an urgent update. Before using the one-command override:

1. Confirm the exact version and publication time.
2. Confirm the publisher and upstream release or advisory.
3. Review the package and lockfile diff.
4. Run the full security, build, and test checks before merging.

### Dependencies come from the npm registry

`.npmrc` sets `allow-git=root`, which blocks transitive git dependencies. The npm version currently used by the project (11.13) does not support the equivalent `allow-remote`, `allow-file`, and `allow-directory` settings available in newer npm releases, so `scripts/check-lockfile-sources.mjs` parses `package-lock.json` and rejects every package that does not resolve from `https://registry.npmjs.org`.

CI runs this source check before `npm ci`, so a malicious lockfile cannot make the install job fetch code from a git repository, arbitrary URL, local tarball, or directory first. `npm run security:check` runs it again as part of the normal security suite.

### Install scripts are blocked by default

`.npmrc` sets `ignore-scripts=true`. This blocks dependency lifecycle scripts during `npm install` and `npm ci`, including `preinstall`, `install`, and `postinstall` hooks.

Why: many npm supply-chain attacks execute before app code runs by adding install hooks to a compromised package.

Tradeoff: a future dependency with a legitimate native build step may not work until it is reviewed. Prefer packages that do not need install scripts. If an exception is truly needed, use a one-off command and document the reason in the PR.

### Security check script

Run:

```sh
npm run security:check
```

This performs:

- a structured check that every lockfile package resolves from the npm registry
- `npm audit --audit-level=moderate`
- `npm audit signatures`
- a narrow IOC scan for dependency and hook markers from the May 2026 Mini Shai-Hulud npm campaign

`npm audit` and `npm audit signatures` run with `--min-release-age=0`. The age gate is for dependency resolution; audit commands must still inspect every version already pinned in the lockfile, including packages adopted less than seven days ago. `npm audit signatures` verifies registry signatures and provenance attestations where available. Missing attestations are not a failure today; invalid signatures are.

### CI

GitHub Actions runs on every PR and push to `main`:

- `npm run security:lockfile` before dependency installation
- `npm ci`
- `npm run security:check`
- `npm run lint`
- `npm run build`
- `npm test -- --run`

Workflow permissions are restricted to `contents: read`. The app does not need write access, package publishing credentials, or deployment secrets in CI.

### Dependency review

Dependency Review runs on PRs that change `package.json` or `package-lock.json` and fails on moderate-or-higher vulnerability severity.

Tradeoff: this depends on GitHub's dependency-review feature availability. If GitHub reports that the repo or account cannot use it, keep the regular CI check and remove or disable the workflow.

### Dependabot

Dependabot opens weekly PRs for npm dependencies and GitHub Actions. It groups common toolchain updates so dependency work is visible without creating daily noise. npm version updates have a seven-day cooldown matching the local npm release-age gate.

Do not auto-merge dependency PRs. Review the package names, changelogs, lockfile diff, CI result, and `npm run security:check` output.

## Safe dependency workflow

- Use `npm install <package>@<version>` for dependency changes and commit the resulting `package.json` and `package-lock.json` together.
- Do not use `npx <package>@latest` or similar unpinned ad-hoc execution. It fetches code outside this project's lockfile. Add recurring tools to `devDependencies`; for a one-off command, pin an exact reviewed version.
- Never hand-edit integrity hashes or resolved URLs in `package-lock.json`.
- Treat a new install script, publisher change, provenance downgrade, or non-registry source as a reason to stop and investigate.
- Remove dependencies that are no longer used. Every dependency and transitive package increases the available attack surface.

## Account and machine practices

These are not enforceable by the repo, but they matter more than most code changes:

- Do not keep an npm publish token on the development machine.
- Prefer GitHub fine-grained tokens or GitHub CLI auth over broad personal access tokens.
- Do not export cloud provider keys in shell startup files.
- Keep password-manager CLIs locked unless actively using them.
- Avoid mounting the host Docker socket into untrusted build containers.
- Keep local development and CI secrets separate.
- If using a remote dev box, make it lower privilege than the laptop, not a copy of the same secrets.

## Suspected package compromise

If a compromised package may have been installed, assume the account that ran the install and every credential readable by it are exposed:

1. Stop using the affected environment and record the package name, version, install time, and affected machines or CI runs.
2. Revoke or rotate reachable credentials, including GitHub tokens, SSH keys, cloud credentials, npm tokens, and Supabase secret or `service_role` keys. The public publishable or legacy `anon` key is not a secret, but still review its RLS exposure.
3. Remove `node_modules`, clean the npm cache, and reinstall a known-good lockfile in a clean environment.
4. Pin or override the affected dependency to a known-good version and rerun `npm run security:check`, the build, and tests.
5. Review logs and repository changes made after the suspected install. Report the package through the upstream security channel and npm if appropriate.

## Dependency review checklist

For any dependency add or major upgrade:

1. Is the package necessary?
2. Is it maintained by the expected publisher?
3. Does it add install scripts?
4. Does it introduce a git, URL, file, or directory dependency?
5. Does `npm audit signatures` pass?
6. Does `npm run security:check` pass?
7. Does the app still build and test from a clean `npm ci` install?

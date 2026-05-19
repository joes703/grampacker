# Supply-chain security

This project uses npm packages and GitHub-hosted CI. The goal is not to make dependency risk disappear; it is to make dependency changes slower, more visible, and easier to reject.

## What is enforced in this repo

### Exact package versions

`.npmrc` sets `save-exact=true`, so newly added dependencies are saved as exact versions instead of broad semver ranges. `package-lock.json` pins the full resolved tree.

Tradeoff: updates are more deliberate. That is useful here; a small app should not silently float to new dependency versions.

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

- `npm audit --audit-level=moderate`
- `npm audit signatures`
- a narrow IOC scan for dependency and hook markers from the May 2026 Mini Shai-Hulud npm campaign

`npm audit signatures` verifies registry signatures and provenance attestations where available. Missing attestations are not a failure today; invalid signatures are.

### CI

GitHub Actions runs on every PR and push to `main`:

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

Dependabot opens weekly PRs for npm dependencies and GitHub Actions. It groups common toolchain updates so dependency work is visible without creating daily noise.

Do not auto-merge dependency PRs. Review the package names, changelogs, lockfile diff, CI result, and `npm run security:check` output.

## Account and machine practices

These are not enforceable by the repo, but they matter more than most code changes:

- Do not keep an npm publish token on the development machine.
- Prefer GitHub fine-grained tokens or GitHub CLI auth over broad personal access tokens.
- Do not export cloud provider keys in shell startup files.
- Keep password-manager CLIs locked unless actively using them.
- Avoid mounting the host Docker socket into untrusted build containers.
- Keep local development and CI secrets separate.
- If using a remote dev box, make it lower privilege than the laptop, not a copy of the same secrets.

## Dependency review checklist

For any dependency add or major upgrade:

1. Is the package necessary?
2. Is it maintained by the expected publisher?
3. Does it add install scripts?
4. Does it introduce `github:` dependencies?
5. Does `npm audit signatures` pass?
6. Does `npm run security:check` pass?
7. Does the app still build and test from a clean `npm ci` install?

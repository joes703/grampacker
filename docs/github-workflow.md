# GitHub Workflow

This repo uses a modern solo/small-team GitHub workflow:

- Squash-only pull request merges.
- Branches are auto-deleted on GitHub after merge.
- Auto-merge is enabled.
- `main` is protected by the `main-protection` ruleset.
- Pull requests must pass `Verify` and `Dependency Review`.
- Pull requests do not need to be manually updated just because `main` moved.
- Force-pushes and deletion of `main` are blocked.

The goal is to keep CI as the merge gate without creating a serial
`update branch -> wait for CI -> merge -> repeat` workflow for Dependabot and
small PRs.

## Local Git Defaults

These are expected on developer machines:

```bash
git config --global fetch.prune true
git config --global pull.ff only
```

`fetch.prune=true` removes stale remote-tracking refs after GitHub auto-deletes
merged branches. This prevents accidentally checking out a dead branch and
rebasing commits that were already squash-merged.

`pull.ff=only` prevents `git pull` from creating surprise local merge commits.

## Normal Code Change

Start from current `main`:

```bash
git switch main
git pull --ff-only
git switch -c my-change
```

Make the change, then verify locally:

```bash
npm run lint
npm test -- --run
npm run build
```

Commit and open a PR:

```bash
git status
git add <changed-files>
git commit -m "type(scope): short description"
git push -u origin my-change
gh pr create
```

Watch CI and enable auto-merge:

```bash
gh pr checks --watch
gh pr merge --squash --auto
```

## Agent Auto-Merge Policy

Agents may enable auto-merge for low-risk PRs after local verification:

- docs
- copy
- formatting
- Dependabot patch/minor updates
- non-runtime chore changes
- test-only changes that do not weaken coverage

Agents must open the PR and wait for explicit owner approval before enabling
auto-merge for changes touching:

- auth, sessions, passkeys, or account behavior
- RLS, database schema, migrations, or Supabase configuration
- installability (web manifest), the service-worker teardown (`public/sw.js`), or browser cache behavior
- sharing/public-link behavior
- import/export data semantics
- dependency major updates
- broad refactors
- uncertain product behavior

After GitHub merges the PR:

```bash
git switch main
git pull --ff-only
git fetch --prune
git branch -D my-change
```

Use `-D` instead of `-d` for squash-merged branches. Squash merge creates a new
commit on `main`, so Git often cannot prove the original feature branch was
merged by ancestry even though the changes are present.

## Dependabot PRs

For routine Dependabot updates with green checks:

```bash
gh pr merge <number> --squash --auto
```

Do not run `gh pr update-branch` just because the PR is behind `main`. The
ruleset requires the checks to pass, but it no longer requires every PR branch
to be up to date with `main` before merge.

Use `gh pr update-branch <number>` only when there is a real conflict, a stale
check you intentionally want to rerun, or GitHub says the PR cannot be merged
without updating.

## After A Squash Merge

Treat the feature branch as done. Do not rebase it onto `main`.

If you check out a stale branch after it was squash-merged, Git may replay the
same logical changes onto a `main` that already contains them. That can create
conflicts such as add/add conflicts in files that were introduced by the PR.

Preferred cleanup:

```bash
git switch main
git pull --ff-only
git fetch --prune
git branch -D merged-branch
```

## Current Repository Settings

Repository pull request settings:

- `allow_squash_merge=true`
- `allow_merge_commit=false`
- `allow_rebase_merge=false`
- `allow_auto_merge=true`
- `delete_branch_on_merge=true`

`main-protection` ruleset:

- target: default branch
- require pull requests
- allowed merge method: squash
- required checks: `Verify`, `Dependency Review`
- `strict_required_status_checks_policy=false`
- block deletion
- block non-fast-forward updates

GitHub native merge queue would be the stricter large-team version of this
workflow, but it is not generally available for this personal public repository
setup. Auto-merge plus required checks is the practical equivalent here.

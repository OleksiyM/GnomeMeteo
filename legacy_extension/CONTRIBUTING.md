# Contributing to Weatherglass

Thanks for your interest in Weatherglass!

Before your first change, [`docs/onboarding.md`](docs/onboarding.md)
explains the shape of the system — how the extension loads inside the
shell and how data flows in, with diagrams.

## Branching policy

`main` is the default branch: all changes must land on a feature branch
and be merged through a pull request. Follow the monorepo worktree and
approval rules in [`../AGENTS.md`](../AGENTS.md).

```sh
git checkout -b topic/short-description   # branch off current main
# ... commit, then:
git push origin topic/short-description   # open a PR against main
```

## Development loop

- `gjs -m tools/syntax-check.mjs` — parse-gate every JS source.
- `bash tools/package.sh` — build `dist/*.zip` and run the zipcheck,
  which installs the packaged extension in a nested session and boots
  it; it is the real gate before shipping.
- `gnome-extensions install --force dist/weatherglass@vijaybala.dev.zip`
  then log out and back in (GJS caches modules per session).

## Conventions

- Commit author email must stay the GitHub noreply address; no personal
  emails anywhere in the tree or history.
- Verify merged commits remain noreply-clean after landing; use the
  merge method the operator requests for the PR.
- Match the existing code style; keep comments factual and specific.
- Bump `version` in `metadata.json` (integer) with every packaged
  upload to extensions.gnome.org — except a needs-work resubmission,
  which re-uploads the same version number (it replaces the pending
  package rather than stranding the flagged one in review).

## Ideas and bugs

Open an issue on the GitHub repository first for anything larger than a
typo — design direction happens there.

# AGENTS.md — WeatherGlass (app + extension monorepo)

Rules for AI agents working in this repository. Read before writing anything.

## Worktree discipline (mandatory)

**Never write code in this main checkout.** It is the deployment tree: the
launcher (`~/.local/bin/weatherglass`), the desktop entry, and the running
instance all point here. Edits in-place mutate the live app mid-run and dirty
the tree operators rely on being clean.

Before any code change:

1. `git fetch` (once `origin` is pushed; otherwise branch from local `main`)
2. Create a detached worktree and work there:
   ```bash
   git worktree add ../wg-work/<slug> -b <slug> main
   ```
3. Do all editing, testing (`gjs -m app/tests/*.js`), and committing there.
   To run the app FROM the worktree, launch it explicitly
   (`gjs -m <worktree>/app/src/main.js` or a temp launcher) — do not
   repoint `~/.local/bin/weatherglass` at a worktree.
4. Merge/fast-forward into `main` in this checkout only when the suite is
   green, and leave the main checkout clean (`git status --porcelain` empty).
5. Remove the worktree after merging: `git worktree remove ../wg-work/<slug>`

Exceptions requiring the operator's explicit OK (not self-service): docs-only
typo fixes, and emergency patches the operator directs onto the live tree.

## Verification culture (learned the hard way here)

- Batch-heredoc file writes have reported success while writing nothing —
  re-verify every scripted edit with grep/read.
- A gate you have not watched FAIL is a rumor: tamper-test new checks.
- Before UI test suites: `kill $(pgrep -x gjs)` (a running app absorbs the
  single-instance handshake and the suite silently passes on nothing).
- Design tokens flow extension → `shared/art` → app mirrors; run
  `python3 scripts/check-design-parity.py` after touching art/painter/moon.

## Do not push

Remotes stay unpushed until the operator says the word. Local commits only.

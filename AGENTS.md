# AGENTS.md — GnomeMeteo (GNOME Shell Extension)

Rules for AI agents working in this repository. Read before writing anything.

## Scope & Architecture

GnomeMeteo is a modern, lightweight GNOME Shell extension (GNOME 45–50+) providing weather indications and forecasts with native Libadwaita styling.
It is a single-extension repository — there is no standalone desktop app or legacy monorepo.

## Worktree discipline (mandatory)

**Never write code in this main checkout.** It is the source deployment tree for `./install.sh` and the active testing workspace. Edits in-place risk breaking running sessions and leaving uncommitted artifacts.

Before any code change:

1. Create a topic-branch worktree and work there:
   ```bash
   git worktree add ../wg-work/<slug> -b <slug> main
   ```
2. Do all editing, linting, and testing there.
3. Verify syntax and schemas:
   ```bash
   node -c extension/*.js
   glib-compile-schemas --strict schemas/
   ```
4. Merge/fast-forward into `main` in this checkout only when verification passes, and leave the main checkout clean (`git status --porcelain` empty).
5. Deploy and test live:
   ```bash
   ./install.sh
   gnome-extensions disable meteo@oleksiym.github.io && gnome-extensions enable meteo@oleksiym.github.io
   ```
6. Remove the worktree after merging: `git worktree remove ../wg-work/<slug>`

Exceptions requiring the operator's explicit OK: docs-only typo fixes, and emergency patches the operator directs onto the live tree.

## Identity & Authorship

- Standard commits use the repository configured author: `OleksiyM <oleksiymaliovanyy@gmail.com>`.
- Full lineage credit to original WeatherGlass author Vijay Bala is preserved in `README.md`, `LICENSE`, and `prefs.js` (`Adw.AboutDialog`).

## Verification culture

- **JS Syntax**: Run `node -c extension/*.js` before committing any JavaScript changes.
- **GSettings Schemas**: Run `glib-compile-schemas --strict schemas/` whenever schemas change.
- **Runtime Integrity**: After reloading, verify clean initialization in GNOME Shell logs:
  `journalctl --user -b -n 30 --no-pager | grep -i meteo`
- **Re-verify Edits**: Always verify scripted file edits with read/grep.

## Do not push

Remotes stay unpushed until the operator says the word. Local commits only.

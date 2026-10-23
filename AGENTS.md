# AGENTS.md — GnomeMeteo (GNOME Shell Extension)

Rules and operational manual for AI agents working in this repository. Read before writing anything.

## Scope & Architecture

GnomeMeteo is a modern, lightweight GNOME Shell extension (GNOME 45–50+) providing weather indications and forecasts with native Libadwaita styling.
It is a single-extension repository — there is no standalone desktop app or legacy monorepo.
- `extension/`: Root of the extension code (JavaScript, CSS, assets, schemas, compiled locale).
- `po/`: Gettext source catalogs (`.po`, `.pot`, `LINGUAS`).
- `scripts/`: Helper scripts for i18n (`build-i18n.sh`), packaging (`build-package.sh`), and version checking (`check-version.sh`).
- `install.sh` / `uninstall.sh`: One-liner curl installers and local deployment scripts.
- `index.html`: Modern landing page deployed to GitHub Pages via `.github/workflows/pages.yml`.

## Worktree discipline (mandatory)

**Never write code in this main checkout.** It is the source deployment tree for `./install.sh` and the active testing workspace. Edits in-place risk breaking running sessions and leaving uncommitted artifacts.

Before any code change:

1. Create a topic-branch worktree and work there:
   ```bash
   git worktree add ../gm-work/<slug> -b <slug> main
   ```
2. Do all editing, linting, and testing there.
3. Verify syntax, schemas, and translations:
   ```bash
   node -c extension/*.js
   glib-compile-schemas --strict extension/schemas/
   ./scripts/build-i18n.sh
   ```
4. Merge/fast-forward into `main` in this checkout only when verification passes, and leave the main checkout clean (`git status --porcelain` empty).
5. Deploy and test live:
   ```bash
   ./install.sh
   gnome-extensions disable meteo@oleksiym.github.io && gnome-extensions enable meteo@oleksiym.github.io
   ```
6. Remove the worktree after merging: `git worktree remove ../gm-work/<slug>`

Exceptions requiring the operator's explicit OK: docs-only typo fixes, and emergency patches the operator directs onto the live tree.

## Localization (i18n)

- Strings marked with `_('...')` in `extension/*.js` are translated via GNU Gettext.
- PO catalogs live in `po/{uk,ru}.po` and `po/meteo@oleksiym.github.io.pot`. Active locales are listed in `po/LINGUAS`.
- **Never hand-edit binary `.mo` files.** Always update `po/*.po` and compile via `./scripts/build-i18n.sh`.
- Compiled `.mo` files are deployed to `extension/locale/<lang>/LC_MESSAGES/meteo@oleksiym.github.io.mo`.

## Release & Versioning Lifecycle

Releases follow Semantic Versioning (`X.Y.Z`).

1. **Bump Version**:
   - `extension/metadata.json`: increment integer `"version"` and set `"version-name": "X.Y.Z"`.
   - `extension/prefs.js`: verify version reads dynamically from `this.metadata['version-name']`.
2. **Verify Tag Contract**:
   ```bash
   ./scripts/check-version.sh vX.Y.Z
   ```
3. **Commit & Tag**:
   ```bash
   git commit -am "chore(release): bump version to X.Y.Z"
   git tag -a vX.Y.Z -m "GnomeMeteo X.Y.Z"
   ```
4. **Push Release**:
   Only push when explicitly approved by the operator:
   ```bash
   git push origin main && git push origin vX.Y.Z
   ```
5. **Automation**:
   - Pushing tag `v*` triggers `.github/workflows/release.yml`, which packages the extension zip, attests SLSA provenance via Sigstore, generates commit-based release notes, and publishes the GitHub Release.
   - Pushing to `main` with changes to `index.html` or screenshots triggers `.github/workflows/pages.yml` to update the website.

## Identity & Authorship

- Standard commits use the repository configured author: `OleksiyM <oleksiymaliovanyy@gmail.com>`.
- Full lineage credit to original WeatherGlass author Vijay Bala is preserved in `README.md`, `LICENSE`, `prefs.js` (`Adw.AboutDialog`), and `index.html`.

## Verification culture

- **JS Syntax**: Run `node -c extension/*.js` before committing any JavaScript changes.
- **GSettings Schemas**: Run `glib-compile-schemas --strict extension/schemas/` whenever schemas change.
- **Runtime Integrity**: After reloading, verify clean initialization in GNOME Shell logs:
  `journalctl --user -b -n 30 --no-pager | grep -i meteo`
- **Re-verify Edits**: Always verify scripted file edits with read/grep.

## Do not push

Remotes stay unpushed until the operator says the word. Local commits only.

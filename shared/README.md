# shared/

Canonical design assets that BOTH products draw from.

- `art/icon-render.mjs` — the brand-art pipeline. The app imports it
  directly; the extension keeps a synced copy of everything above the
  `OUTPUT EMISSION` marker (EGO zips must be self-contained).
  `scripts/check-design-parity.py` enforces the sync mechanically.
- `tokens/` — reserved for the ink/palette token extraction (roadmap).

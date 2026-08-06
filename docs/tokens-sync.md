# Design Tokens Sync — Deep Dive

Pipeline-specific KT for `sync-figma-tokens.js`. See [`SETUP.md`](../SETUP.md)
for the shared overview (prerequisites, credentials, which workflows exist)
- this doc covers what's specific to the tokens pipeline: how category
resolution and value conversion actually work, and troubleshooting unique
to it.

## What it does

Fetches Figma's **local variables** (colors, spacing, radius, typography,
shadows, etc.) for the target file, converts them into CSS custom
properties grouped by category and theme mode, and diffs the result
against the previous run to flag anything that looks like a breaking
change (a variable removed, renamed, or that changed type).

```
config.json + env vars
        │
        ▼
   config.js  (loadTokensConfig)  ── resolves paths, validates FIGMA_TOKEN / FIGMA_FILE_KEY
        │
        ▼
sync-figma-tokens.js  (main)
        │
        ├─ getFigmaFileVersion()  → GET /v1/files/:key            (file version, for the snapshot key)
        ├─ getLocalVariables()    → GET /v1/files/:key/variables/local
        ├─ saveJSONSnapshots()    → tokens/variables-latest.json
        │                           tokens/snapshots/variables-<ts>_<figmaVersion>.json
        ├─ generateCSSTokens()    → tokens/<category>.css (one per non-empty category) + tokens/index.css
        └─ generateDiffReport() +
           detectBreakingChanges() → tokens/diff-latest.json
```

`sync-figma-tokens.js` only runs `main()` automatically when invoked
directly (`node sync-figma-tokens.js`) - not when imported, so its pure
functions (kebab-casing, category resolution, value conversion, diffing)
can be exercised in isolation, e.g. from a test.

## Variable identity

Diffing (`generateDiffReport()`) keys everything off the Figma **variable
ID**, which is stable across renames - an ID present in both snapshots is
the same variable even if its name changed; an ID that disappears is a real
removal, not a rename candidate to guess at via name similarity.

## Category resolution

For each variable, `getCategory()` decides which output CSS file
(`colors.css`, `spacing.css`, `radius.css`, `typography.css`,
`shadows.css`, `other.css`) it belongs in, in this order:

1. **Figma's own `scopes`** on the variable (e.g. a variable actually bound
   to a corner-radius property gets `CORNER_RADIUS`), mapped through
   `config.json`'s `css.scopeCategoryMap` - checked first because it
   reflects how the variable is actually *used* in the file, independent of
   what the designer happened to name it.
2. **`resolvedType === "COLOR"`** - a reliable fallback for color variables
   that only carry the generic `ALL_SCOPES` scope.
3. **Name-based heuristics** (e.g. a name starting with `spacing/` or
   containing `radius`) - the last resort, for variables with neither a
   specific scope nor a `COLOR` type.
4. **`other`** if none of the above match.

If a variable lands in `other.css` unexpectedly, check its `scopes` in
Figma first - an explicit scope always wins over a "correct-looking" name.

## Value conversion

`convertValue()` turns a raw Figma variable value into a CSS value:
- **`VARIABLE_ALIAS`** (a variable pointing at another variable, e.g. a
  semantic token aliasing a primitive) becomes `var(--target-name)` -
  preserving the alias relationship in the generated CSS rather than
  flattening it to the target's literal value, so it still resolves
  correctly against whichever theme mode is active in the cascade.
- **`COLOR`** becomes `rgba(r, g, b, a)`.
- **`FLOAT`** gets the unit for its category from `config.json`'s
  `css.units` (falling back to `units.default`).
- **`STRING`** / **`BOOLEAN`** get their literal/quoted representation.

CSS is grouped by mode: a variable's `Default`/`Light` mode goes under
`:root`, any other mode (e.g. `Dark`) goes under
`[data-theme="<mode-name>"]`.

## Figma access specifics

- Needs a token with read access to file content. Unlike the components
  sync, this one doesn't require anything to be *published* - local
  variables are readable as soon as they exist in the file, published or
  not.
- Calls two read-only endpoints: `GET /v1/files/:key` (file version/name,
  used in the snapshot key) and `GET /v1/files/:key/variables/local`.

## Troubleshooting (tokens-specific)

- **A color/spacing value looks wrong in the generated CSS** - check
  whether the variable is a `VARIABLE_ALIAS` pointing at another variable;
  the emitted `var(--target)` resolves against whatever `--target` is
  currently defined as for the active theme mode, so the visible value
  depends on cascade order, not just this one variable's own definition.
- **A variable landed in the wrong category file** - see the category
  resolution precedence above.
- **`Unresolved variable alias: <id>`** - the alias target wasn't found in
  this run's variable set (e.g. it was deleted, or is in a different,
  unfetched collection); falls back to `transparent`/`initial`.

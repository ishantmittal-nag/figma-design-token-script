# sync-figma-tokens.js — Change Log

This document explains the changes made to `sync-figma-tokens.js` and `config.json`, and the reasoning behind each one.

## 1. Breaking-change detection now keys strictly off the Figma variable ID

**File:** `sync-figma-tokens.js` — `generateDiffReport()`

**Before:** In addition to comparing variables by ID, the script tried to *guess* renames by normalizing variable names and fuzzy-matching them across the sets of added/removed variables (different IDs, similar-looking names).

**Problem:** Figma variable IDs are stable across a rename — renaming a variable in Figma never changes its ID. That means:
- The fuzzy-match heuristic could produce **false-positive renames**: two unrelated variables (one removed, one added) with coincidentally similar names would be reported as a rename instead of a removal + addition.
- It was also unnecessary: a real rename is already fully captured by comparing `previousVar.name !== currentVar.name` for the *same* ID.

**Change:** Removed the name-fuzzy-matching pass entirely (and the now-unused `normalizeTokenName` helper). Diffing is now purely ID-based:
- Same ID in both snapshots, name differs → **renamed**
- Same ID in both snapshots, value or type differs → **modified**
- ID only in the previous snapshot → **removed**
- ID only in the current snapshot → **added**

This makes breaking-change detection deterministic and tied to what Figma itself considers "the same variable," instead of a string-similarity guess.

## 2. CSS units are now configurable per category

**Files:** `config.json` (`css.units`), `sync-figma-tokens.js` — `resolveUnit()`, `convertValue()`

**Before:** `convertValue()` hardcoded `px` for every numeric (`FLOAT`) variable, regardless of what it represented (spacing, radius, font size, stroke width, etc.).

**Change:** Added a `css.units` block to `config.json`:

```json
"units": {
  "default": "px",
  "colors": "",
  "spacing": "px",
  "radius": "px",
  "typography": "px",
  "shadows": "px",
  "other": "px"
}
```

`resolveUnit(category)` looks up the unit for the variable's resolved category, falling back to `units.default` if the category isn't listed. Defaults were chosen to exactly match the previous hardcoded behavior (`px` everywhere), so nothing changes in generated CSS until the config is edited — e.g. setting `"typography": "rem"` to switch font-related tokens to `rem`.

## 3. All paths resolve relative to the script file, not the invoking shell's working directory

**File:** `sync-figma-tokens.js` — `SCRIPT_DIR`, `resolveFromScript()`

**Before:** `config.json` and every path in `config.paths` (`outputDir`, `snapshotDir`, `latestJsonFile`, `latestCssDir`) were resolved with `path.join(process.cwd(), ...)`.

**Problem:** `process.cwd()` is whatever directory the process was *launched* from. If a CI/CD pipeline (or a developer, or a monorepo task runner) invokes `node sync-figma-tokens.js` from a different directory than the repo root, every path silently resolves somewhere else — the script can fail to find `config.json`, or write tokens/snapshots into the wrong location.

**Change:** Added:

```js
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
function resolveFromScript(relativePath) {
    return path.resolve(SCRIPT_DIR, relativePath);
}
```

`config.json` and every entry under `config.paths` are now resolved through `resolveFromScript()`, anchoring them to the script's own file location on disk. Behavior is now identical no matter which directory the process is launched from — verified by resolving paths from an unrelated working directory and confirming they still point at the repo's `tokens/` folder.

## 4. CSS token categorization uses Figma's own variable metadata instead of guessing from the name

**Files:** `config.json` (`css.scopeCategoryMap`), `sync-figma-tokens.js` — `getCategory()`, `getCategoryFromScopes()`

**Before:** `getCategory()` classified every variable into `colors` / `spacing` / `radius` / `typography` / `shadows` / `other` purely by pattern-matching substrings in the variable's *name* (e.g. `name.includes("radius")`). This breaks whenever a variable is named something that doesn't follow the expected convention (e.g. `Blue/50`, `Primary/Primary 600`, or a bare number like `48`).

**Investigation:** Figma's Variables API exposes two fields that could plausibly drive this:
- `codeSyntax` — a per-platform code name a *designer* can manually type in for a variable. Inspecting the actual snapshots in `tokens/variables-latest.json`, this was `{}` (empty) on every single variable — nobody had set it, and it can't be relied on if designers aren't expected to think about code output.
- `scopes` — an array Figma **auto-populates** based on where the variable is actually bound in the file (e.g. a variable used to set a corner radius gets `scopes: ["CORNER_RADIUS"]`, one used for a gap gets `["GAP"]`), with no designer effort required.

**Change:** `getCategory()` now resolves a variable's category in this order:
1. **By scope** — look up each of the variable's `scopes` against a configurable `css.scopeCategoryMap` in `config.json` (e.g. `CORNER_RADIUS → radius`, `GAP → spacing`, `ALL_FILLS/STROKE_COLOR → colors`, various font-related scopes → `typography`).
2. **By resolved type** — if no scope matched (Figma's catch-all `ALL_SCOPES` carries no usage hint), a `resolvedType` of `COLOR` is still a reliable signal, catching color variables whose names don't contain the word "color" (e.g. `Blue/50`, `Text/Primary`).
3. **By name** — the original substring-matching heuristic, retained as a last-resort fallback.

**Verified against the real data in `tokens/variables-latest.json`:** categorization correctly moved 25 previously-miscategorized color variables (like `Blue/50`, `Primary/Primary 600`) from `other` into `colors`, while variables with no strong signal at all (a few `Stroke/*` values and some unnamed numeric literals) still fall into `other`, which is the appropriately conservative outcome. The `scopeCategoryMap` is editable in `config.json` if a project uses additional or different scopes.

---

### Net effect

- Breaking-change reports are more trustworthy (no coincidental false-positive renames).
- Generated CSS units are tunable per token category without touching code.
- The script behaves identically regardless of the directory a CI/CD job invokes it from.
- CSS category assignment is driven primarily by how a variable is actually used in Figma, not by naming conventions designers may not follow.

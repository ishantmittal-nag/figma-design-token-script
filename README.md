# Figma Design Token Sync

Keeps `tokens/` in this repo in sync with the variables (colors, spacing,
radius, typography, shadows, etc.) defined in a Figma file: it fetches
Figma's local variables, converts them into CSS custom properties grouped
by category and theme mode, and diffs the result against the previous run
to flag anything that looks like a breaking change (a variable removed,
renamed, or that changed type).

This branch (`tokens-sync`) is **intentionally isolated** — it holds only
what's needed to run the token sync, nothing from any other pipeline (in
particular, nothing component-sync-related — see the sibling
`components-sync` branch and its own README for that).

## Requirements

### Runtime

- **Node.js 20** (pinned in the workflow; use the same locally for
  consistent behavior).
- **npm packages** (`package.json`):
  - [`dotenv`](https://www.npmjs.com/package/dotenv) — loads `FIGMA_TOKEN` /
    `FIGMA_FILE_KEY` from a local `.env` file when running outside CI. This
    is the only dependency the sync logic itself needs; installed via
    `npm ci` (needs `package-lock.json`, already committed).

### Figma access

- A **Figma personal access token** (`FIGMA_TOKEN`), belonging to an
  account that has at least **viewer access to the target Figma file**.
- The token needs **read access to file content** — the script calls two
  read-only Figma REST endpoints: `GET /v1/files/:key` (for the file's
  version/name, used in the snapshot key) and
  `GET /v1/files/:key/variables/local` (the actual variables). No write
  scope is needed anywhere in this pipeline; it never modifies anything in
  Figma.
- Unlike the components sync, this one doesn't require anything to be
  *published* — local variables are readable as soon as they exist in the
  file, published or not.

### GitHub / repo permissions

- **Actions must be enabled** for the repository.
- The workflow declares `permissions: contents: write` at the job level —
  this is what lets the "Commit and push updated tokens" step push back to
  `tokens-sync` using the default, automatically-provided `GITHUB_TOKEN`
  (via `actions/checkout`'s persisted credentials). No personal access
  token or deploy key is needed for that push.
- **Branch protection**: if `tokens-sync` ever gets required-review or
  required-status-check rules applied to it, the bot's direct `git push` in
  that step will start failing — either exclude this branch from
  protection, or allow the Actions bot/`github-actions[bot]` to bypass it.
- **Repo Variables/Secrets**: whoever sets `FIGMA_TOKEN` (secret) or
  `FIGMA_FILE_KEY` / `FIGMA_API_BASE_URL` (Variables) needs at least
  **Maintain** (ideally Admin) access to the repo's Settings →
  *Secrets and variables → Actions* page.
- **`gh` CLI / API access**, only if triggering runs via `gh workflow run`
  instead of the Actions UI button — needs a token with the `workflow`
  scope (see [Triggering manually](#triggering-manually) below).

## How it works

```
config.json + env vars
        │
        ▼
   config.js  (loadConfig)  ── resolves paths, validates FIGMA_TOKEN / FIGMA_FILE_KEY
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

**`config.js`** is the only other file in the pipeline. It reads
`config.json`, resolves the required env vars, and returns everything as
plain values — kept separate from the main script so configuration loading
can be reasoned about (and tested) independently of the sync logic itself.
It has no side effects on import.

**`sync-figma-tokens.js`** does the actual work, and only runs `main()`
automatically when invoked directly (`node sync-figma-tokens.js`) — not
when imported, so its pure functions (kebab-casing, category resolution,
value conversion, diffing) can be exercised in isolation.

### Variable identity

Diffing (`generateDiffReport()`) keys everything off the Figma **variable
ID**, which is stable across renames — an ID present in both snapshots is
the same variable even if its name changed; an ID that disappears is a real
removal, not a rename candidate to guess at via name similarity.

### Category resolution

For each variable, `getCategory()` decides which output CSS file
(`colors.css`, `spacing.css`, `radius.css`, `typography.css`,
`shadows.css`, `other.css`) it belongs in, in this order:

1. **Figma's own `scopes`** on the variable (e.g. a variable actually bound
   to a corner-radius property gets `CORNER_RADIUS`), mapped through
   `config.json`'s `css.scopeCategoryMap` — checked first because it
   reflects how the variable is actually *used* in the file, independent of
   what the designer happened to name it.
2. **`resolvedType === "COLOR"`** — a reliable fallback for color variables
   that only carry the generic `ALL_SCOPES` scope.
3. **Name-based heuristics** (e.g. a name starting with `spacing/` or
   containing `radius`) — the last resort, for variables with neither a
   specific scope nor a `COLOR` type.
4. **`other`** if none of the above match.

### Value conversion

`convertValue()` turns a raw Figma variable value into a CSS value:
- **`VARIABLE_ALIAS`** (a variable pointing at another variable, e.g. a
  semantic token aliasing a primitive) becomes `var(--target-name)` —
  preserving the alias relationship in the generated CSS, rather than
  flattening it to the target's literal value, so it still resolves
  correctly against whichever theme mode is active in the cascade.
- **`COLOR`** becomes `rgba(r, g, b, a)`.
- **`FLOAT`** gets the unit for its category from `config.json`'s
  `css.units` (falling back to `units.default`).
- **`STRING`** / **`BOOLEAN`** get their literal/quoted representation.

CSS is grouped by mode: a variable's `Default`/`Light` mode goes under
`:root`, any other mode (e.g. `Dark`) goes under
`[data-theme="<mode-name>"]`.

## Configuration

### Files

- **`config.json`** — output paths, the env var *names* to read credentials
  from, CSS generation settings (which categories exist, units per
  category, the scope→category map), and the default Figma API base URL.
  Editing this is a code change (needs a PR).

### Environment / secrets

| Name | Type | Required | Notes |
|---|---|---|---|
| `FIGMA_TOKEN` | GitHub **secret** | Yes | The only real credential — a Figma personal access token. See [Figma access](#figma-access) above for the scope/access it needs. |
| `FIGMA_FILE_KEY` | GitHub **Variable** (preferred) | Yes | Which Figma file to sync. Not sensitive — just an identifier — so it lives in Settings → Secrets and variables → Actions → **Variables**, not Secrets. `secrets.FIGMA_FILE_KEY` is still read as a fallback for repos that haven't migrated yet; once the Variable is set, the old secret can be deleted. |
| `FIGMA_API_BASE_URL` | GitHub Variable (optional) | No | Defaults to `https://api.figma.com/v1` (from `config.json`). Set this only for a non-standard Figma API host (e.g. an enterprise instance). |

Locally, these can also go in a `.env` file (loaded via `dotenv`) instead of
the shell environment — copy `.env.example` to `.env` and fill in real
values.

### Changing config without editing code

- **Per-run override**: trigger the workflow manually (see
  [Triggering manually](#triggering-manually)) and fill in `figma_file_key`
  / `figma_api_base_url` — these win over the repo Variables for that run
  only.
- **Persistent default**: set the `FIGMA_FILE_KEY` / `FIGMA_API_BASE_URL`
  repo Variables once (Settings → Secrets and variables → Actions →
  Variables tab). No code change, no PR.
- Which CSS categories exist and how they're mapped (`css.categories`,
  `css.units`, `css.scopeCategoryMap`) is still a `config.json` change —
  these are structural, not per-run knobs, so they weren't moved to
  Variables.

## How CI runs it

Workflow: [`.github/workflows/sync-figma-tokens.yml`](.github/workflows/sync-figma-tokens.yml)

Triggers:
- **`workflow_dispatch`** — manual run. Accepts `figma_file_key` /
  `figma_api_base_url` overrides (see above).
- **`push`** to `tokens-sync` (excluding changes under `tokens/`, to avoid
  the bot re-triggering itself on its own commits).
- **`schedule`** (nightly, `0 0 * * *`) — dormant unless this workflow file
  also lives on the repo's default branch, since GitHub only fires
  `schedule` on the default branch. Kept here ready to go if that changes.

### Triggering manually

GitHub only shows the **"Run workflow"** button in the Actions UI for
workflow files that exist on the repo's **default branch**. Since this
workflow intentionally lives only on `tokens-sync`, that button won't
appear until this file is also merged there — at which point it'll show up
automatically.

Until then (or as an alternative any time), trigger it via the `gh` CLI or
the REST API directly — this works regardless of which branch the file
lives on:

```bash
gh workflow run sync-figma-tokens.yml --ref tokens-sync
```

```bash
curl -X POST \
  -H "Authorization: Bearer <token with 'workflow' scope>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/actions/workflows/sync-figma-tokens.yml/dispatches \
  -d '{"ref":"tokens-sync"}'
```

What the job does:
1. Checks out `tokens-sync`.
2. Runs `node sync-figma-tokens.js`.
3. Commits and pushes anything that changed under `tokens/`.
4. Distinguishes two different non-zero-exit cases:
   - **Breaking change detected, but the sync still committed successfully**
     → posted to the job summary as a warning, not a failed run.
   - **The script errored before writing anything** (bad token, Figma API
     down, etc.) → the job fails loudly.

## Running locally

```bash
npm install
FIGMA_TOKEN=... FIGMA_FILE_KEY=... npm run sync
```

(or put those in a `.env` file). Output:
- `tokens/variables-latest.json` — raw variables + collections, kept for
  diffing against the next run.
- `tokens/snapshots/variables-<timestamp>_<figmaVersion>.json` — a
  timestamped, Figma-version-tagged copy of the same, one per run.
- `tokens/<category>.css` (e.g. `colors.css`, `spacing.css`) — generated CSS
  custom properties, one file per non-empty category.
- `tokens/index.css` — `@import`s every generated category file.
- `tokens/diff-latest.json` — added/removed/modified/renamed since the
  previous snapshot, plus any breaking changes.

## Troubleshooting

- **No "Run workflow" button in the Actions UI** — see
  [Triggering manually](#triggering-manually); it's a GitHub UI limitation
  for workflow files not on the default branch, not a bug in this pipeline.
- **"Missing FIGMA_TOKEN or FIGMA_FILE_KEY in environment"** — the env var
  *names* come from `config.json`'s `environment` block; check those match
  what's actually set (locally or as CI secrets/Variables).
- **Figma API request failed: 403/404** — usually the token's account
  doesn't have access to the file, or `FIGMA_FILE_KEY` points at the wrong
  file. See [Figma access](#figma-access).
- **A variable landed in `other.css` instead of the category you expected**
  — check `getCategory()`'s precedence above: an explicit `scopes` entry (via
  `scopeCategoryMap`) always wins over name-based guessing, so a
  mis-scoped variable in Figma won't be rescued by a "correct" name.
- **A color/spacing value looks wrong in the generated CSS** — check
  whether the variable is a `VARIABLE_ALIAS` pointing at another variable;
  the emitted `var(--target)` resolves against whatever `--target` is
  currently defined as for the active theme mode, so the visible value
  depends on cascade order, not just this one variable's own definition.
- **"Commit and push" step fails with a non-fast-forward/permission error**
  — either another run pushed in the same window (harmless race, just
  re-run), or branch protection on `tokens-sync` is blocking the bot's push
  (see [GitHub / repo permissions](#github--repo-permissions)).

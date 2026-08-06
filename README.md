# Figma Component Sync

Keeps `components/` in this repo in sync with the components published in a
Figma file: it fetches the published component list, cross-references each
one against the codebase (via Code Connect and/or a manual mapping), diffs
it against the previous run, and flags anything that looks like a breaking
change (a component removed or renamed).

This branch (`figma-components-sync`) is **intentionally isolated** — it
holds only what's needed to run the sync. It does not contain the
application source; `src/` is pulled in transiently at CI time (see
[How CI runs it](#how-ci-runs-it)) purely so Code Connect has something to
parse.

## How it works

```
config.json + env vars
        │
        ▼
   config.js  (loadConfig)  ── resolves paths, validates FIGMA_TOKEN / FIGMA_FILE_KEY
        │
        ▼
sync-figma-components.js  (main)
        │
        ├─ getFileComponents()        → GET /v1/files/:key/components (Figma API)
        ├─ saveJSONSnapshots()        → components/components-latest.json
        │                               components/snapshots/components-<ts>.json
        ├─ getCodeConnectMap()        → runs `figma connect parse` against src/**/*.figma.tsx
        ├─ generateCleanMappingFile() → components/code-connect-map.json
        └─ generateDiffReport() +
           detectBreakingChanges()    → components/diff-latest.json
```

**`config.js`** is the only other file in the pipeline. It reads
`config.json`, resolves the required env vars, and returns everything as
plain values — kept separate from the main script so configuration loading
can be reasoned about (and tested) independently of the sync logic itself.
It has no side effects on import.

**`sync-figma-components.js`** does the actual work, and only runs `main()`
automatically when invoked directly (`node sync-figma-components.js`) — not
when imported, so its pure functions (diffing, node-id resolution, mapping
precedence) can be exercised in isolation.

### Component identity

Two different "identity" keys are used deliberately, matching how the Figma
API itself is inconsistent about it:

- **`key`** (Figma's published component key) is stable across renames and
  re-edits — used for the added/removed/renamed/modified diff.
- **`node_id`** (or the *component set's* node id, for a variant) is used to
  join against Code Connect and the manual `componentMap` — both of those
  are written against a Figma node URL, which survives renames the same way.

### Mapping precedence

For a given component, `resolveCodeLocation()` in
[sync-figma-components.js](sync-figma-components.js) picks a code location
in this order:

1. **Code Connect** (`*.figma.tsx` files in `src/`, parsed via the
   `@figma/code-connect` CLI) — authoritative when present.
2. **Manual `componentMap`** in `config.json` — a same-project fallback for
   components nobody's connected yet. Keyed by the full Figma node URL
   (Figma's "Copy link to selection"), not by name.
3. **Unmapped** — no code location found; reported as `mappingSource:
   "unmapped"` in `components/code-connect-map.json`.

## Configuration

### Files

- **`config.json`** — paths, the env var *names* to read credentials from,
  the manual `componentMap`, and the default Figma API base URL. Editing
  this is a code change (needs a PR).
- **`figma.config.json`** — Code Connect's own project config (parser,
  etc.), read from the repo root regardless of which directory holds the
  `*.figma.tsx` files.

### Environment / secrets

| Name | Type | Required | Notes |
|---|---|---|---|
| `FIGMA_TOKEN` | GitHub **secret** | Yes | The only real credential — a Figma personal access token. |
| `FIGMA_FILE_KEY` | GitHub **Variable** (preferred) | Yes | Which Figma file to sync. Not sensitive — just an identifier — so it lives in Settings → Secrets and variables → Actions → **Variables**, not Secrets. `secrets.FIGMA_FILE_KEY` is still read as a fallback for repos that haven't migrated yet; once the Variable is set, the old secret can be deleted. |
| `FIGMA_API_BASE_URL` | GitHub Variable (optional) | No | Defaults to `https://api.figma.com/v1` (from `config.json`). Set this only for a non-standard Figma API host (e.g. an enterprise instance). |

Locally, these can also go in a `.env` file (loaded via `dotenv`) instead of
the shell environment.

### Changing config without editing code

- **Per-run override**: trigger the workflow manually (Actions tab → *Sync
  Figma Components* → *Run workflow*) and fill in `figma_file_key` /
  `figma_api_base_url` — these win over the repo Variables for that run
  only.
- **Persistent default**: set the `FIGMA_FILE_KEY` / `FIGMA_API_BASE_URL`
  repo Variables once (Settings → Secrets and variables → Actions →
  Variables tab). No code change, no PR.

## How CI runs it

Workflow: [`.github/workflows/sync-figma-components.yml`](.github/workflows/sync-figma-components.yml)

Triggers:
- **`workflow_dispatch`** — manual run from the Actions tab. Also accepts
  `app_branch` (which branch to pull `src/` from for Code Connect — default
  `main`).
- **`push`** to `figma-components-sync` (excluding changes under
  `components/`, to avoid the bot re-triggering itself on its own commits).
- **`schedule`** (nightly, `0 0 * * *`) — dormant unless this workflow file
  also lives on the repo's default branch, since GitHub only fires
  `schedule` on the default branch. Kept here ready to go if that changes.

What the job does:
1. Checks out `figma-components-sync`.
2. Sparse-checks-out just `src/` from `app_branch` (default `main`) into a
   temp path and stages it locally as `src/` — this repo doesn't track
   `src/` itself, it's pulled in only so Code Connect has real
   `*.figma.tsx` files to parse. Never committed back.
3. Runs `node sync-figma-components.js`.
4. Commits and pushes anything that changed under `components/`.
5. Distinguishes two different non-zero-exit cases:
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
- `components/components-latest.json` — raw Figma API response, kept for
  diffing against the next run.
- `components/snapshots/components-<timestamp>.json` — a timestamped copy
  of the same, one per run.
- `components/code-connect-map.json` — the flat, human-readable mapping:
  one entry per published component, with its resolved code location (or
  `null` if unmapped).
- `components/diff-latest.json` — added/removed/modified/renamed since the
  previous snapshot, plus any breaking changes.

## Troubleshooting

- **"Missing FIGMA_TOKEN or FIGMA_FILE_KEY in environment"** — the env var
  *names* come from `config.json`'s `environment` block; check those match
  what's actually set (locally or as CI secrets/Variables).
- **Everything reports `mappingSource: "unmapped"`** — Code Connect found no
  `*.figma.tsx` files. In CI this usually means `app_branch` doesn't have a
  `src/` directory, or the branch input pointed at the wrong branch. Check
  the "Stage app src/ for Code Connect parsing" step's log.
- **A component that should be Code Connect-mapped shows up as `manual` or
  `unmapped` instead** — Code Connect resolves through the *component set's*
  node id for variants, not the variant's own node id. Confirm the
  `figma.connect(...)` call targets the set's node URL, not one variant's.

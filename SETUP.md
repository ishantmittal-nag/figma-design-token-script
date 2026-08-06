# Design Sync — Setup & Operation Guide

This repo contains only the sync pipeline itself - no application code. It
automatically syncs Figma design tokens (variables) and published
components into `tokens/`/`components/` here, flags breaking changes, and
opens a PR for review. Whatever application actually consumes these tokens
and components lives in a separate repository. This doc covers what needs
to be in place to run the sync, both locally and via the scheduled GitHub
Action.

## What runs

| Script                       | Pulls from Figma                          | Writes to      |
|-------------------------------|-------------------------------------------|-----------------|
| `sync-figma-tokens.js`        | Local variables (`/files/:key/variables/local`) | `tokens/`       |
| `sync-figma-components.js`    | Published library components (`/files/:key/components`) | `components/`  |

Both scripts:
1. Fetch the current state from Figma.
2. Save a timestamped snapshot alongside a `*-latest.json`.
3. Diff the two most recent snapshots by Figma's own stable ID (`variable.id`
   for tokens, `component.key` for components) - never by name, since names
   can change without the underlying thing changing identity.
4. Write a `diff-latest.json` (added/removed/modified/renamed + a
   `breakingChanges` list) and exit with code `1` if anything breaking was
   found (removed or renamed).

Neither script needs a second execution to "work" - the first run just has
nothing to diff against yet (`📝 First run - no previous snapshot to compare`).

Both scripts share `config.js` for loading `config.json` and validating
`FIGMA_TOKEN`/`FIGMA_FILE_KEY` - `sync-figma-tokens.js` calls
`loadTokensConfig()`, `sync-figma-components.js` calls
`loadComponentsConfig()`. Each only reads the `config.json` blocks it
actually needs (tokens gets `paths`/`css`; components gets `components`),
kept separate so neither script's config shape leaks into the other's. See
[`docs/tokens-sync.md`](docs/tokens-sync.md) and
[`docs/components-sync.md`](docs/components-sync.md) for a per-pipeline
deep dive (architecture, category/mapping rules, troubleshooting specific
to each) - this doc stays the shared overview.

## 1. Prerequisites

- Node 18+ (`design-sync.yml` pins `node-version: 18`, the two dedicated
  workflows pin `20`; anything 18+ works locally too).
- `npm install` at the repo root - just `dotenv` and `@figma/code-connect`,
  the only two things either script needs.

## 2. Figma credentials

Create a `.env` file at the repo root (already gitignored - never commit
this):

```
enter FIGMA_TOKEN
enter FIGMA_FILE_KEY
```

- **FIGMA_TOKEN** - a Figma personal access token: Figma → Settings →
  Security → Personal access tokens. It needs read access to file content
  and, for the components script, the `library_content:read` scope
  specifically (a full-access/no-scope-restricted token covers both; a
  narrowly-scoped token needs both scopes explicitly checked when created).
  Tokens expire - a `403 Token expired` error from either script means it's
  time to generate a new one.
- **FIGMA_FILE_KEY** - the ID segment in the Figma file URL:
  `https://www.figma.com/design/`**`THIS_PART`**`/File-Name`.

## 3. Running manually

```bash
node sync-figma-tokens.js
node sync-figma-components.js
```

Console output tells you exactly what happened - files fetched, snapshot
paths written, and a change summary once there are two snapshots to compare.
A non-zero exit code means breaking changes were detected (or a real error);
that's intentional and is how the CI workflow decides whether to flag a PR.

## 4. Config reference (`config.json`)

- `paths.*` / `components.outputDir` etc. - all resolved relative to the
  script's own file location, not wherever you happen to run `node` from.
- `css.categories` - the list of CSS output buckets (`colors.css`,
  `spacing.css`, ...). Add a category here (and to `css.units` /
  `css.scopeCategoryMap` if relevant) rather than editing the script.
- `css.units` - the CSS unit appended per category for numeric (`FLOAT`)
  variables (e.g. `"colors": ""`, `"spacing": "px"`).
- `css.scopeCategoryMap` - maps a Figma variable's auto-populated `scopes`
  (e.g. `CORNER_RADIUS`, `GAP`) to a CSS category. This is checked before
  falling back to name-based guessing, since scopes reflect how a variable
  is actually used in Figma regardless of naming.
- `components.codeConnectDir` - directory the Code Connect CLI parses for
  `*.figma.tsx` files (see below). Defaults to `./src`, which **does not
  exist in this repo** - the application source (and any `*.figma.tsx`
  files) lives in a separate repository. Code Connect cross-referencing is
  effectively a no-op here unless `codeConnectDir` is pointed at a
  directory that's actually present (e.g. a sparse-checkout of the app repo
  staged before the sync runs, the way the old isolated `components-sync`
  branch used to do it) or `*.figma.tsx` files are otherwise made available
  locally.
- `components.componentMap` - manual fallback map from an exact Figma
  component name to a code location string (a file path, a URL to the
  source in the app's repo, or whatever's useful for a reviewer), for
  components that don't have a Code Connect mapping:

  ```json
  "componentMap": {
    "Button / Primary": "https://github.com/<org>/<app-repo>/blob/main/src/components/atoms/PrimaryButton.jsx"
  }
  ```

  Code Connect always wins when both exist for the same component (it's
  tied to the exact node, so it survives a Figma-side rename); this map is
  the fallback for everything else. **Given Code Connect has nothing to
  parse in this repo by default, `componentMap` is the primary way to get
  components linked to a code location in the PR body** - see
  [`docs/components-sync.md`](docs/components-sync.md) for the full mapping
  precedence.

## 5. Components: publishing + Code Connect

The components script only sees components that have actually been
**published to a team library** in Figma - `Found 0 published component(s)`
means nothing's been published yet, not that something's broken.

To get a component's changes linked to a source location in the PR body:

- **Add it to `componentMap`** above (works immediately, no extra tooling -
  the practical default here since this repo has no app source of its own), or
- **Adopt Code Connect** (requires a Figma Organization/Enterprise plan +
  Dev Mode seat) in the *application's* repository, alongside the real
  component:

  ```tsx
  import figma from "@figma/code-connect";
  import { PrimaryButton } from "./PrimaryButton";

  figma.connect(PrimaryButton, "https://www.figma.com/design/<file-key>/...?node-id=10-20", {
    props: {
      label: figma.string("Text Content"),
    },
    example: (props) => <PrimaryButton>{props.label}</PrimaryButton>,
  });
  ```

  For `sync-figma-components.js` to see those `*.figma.tsx` files, they
  need to be available locally when it runs - point `codeConnectDir` at a
  checkout of the app repo (or a subset of it) rather than relying on the
  default `./src`.

## 6. Automated sync - three workflows

There are three GitHub Actions workflows, all PR-based (none push straight
to `main` - a bad or unexpected sync always gets a review step first):

| Workflow | Trigger | Runs | Opens a PR touching |
|---|---|---|---|
| [`design-sync.yml`](.github/workflows/design-sync.yml) | Nightly (`0 0 * * *`) + manual | Both scripts | `tokens/` and `components/` together |
| [`sync-figma-tokens.yml`](.github/workflows/sync-figma-tokens.yml) | Manual only | `sync-figma-tokens.js` | `tokens/` only |
| [`sync-figma-components.yml`](.github/workflows/sync-figma-components.yml) | Manual only | `sync-figma-components.js` | `components/` only |

The two dedicated ones exist for running just one pipeline on demand
without also triggering the other - `design-sync.yml` stays the sole
scheduled automation, so three different sources aren't all opening
overlapping nightly PRs. All three read the same `FIGMA_TOKEN`/
`FIGMA_FILE_KEY` credentials and, being on `main`, all show a **"Run
workflow"** button directly in the Actions tab (GitHub only shows that
button for workflow files present on the default branch).

Each opens a PR **only if its diff report shows a real change**
(added/removed/modified/renamed > 0) - not on every run, since the diff
reports' own timestamps would otherwise make the working tree look
"different" every single run even with zero actual token/component changes.
Every PR:
- Is titled with ⚠️ if any breaking change was found, ✅ otherwise.
- Links to the relevant `diff-latest.json` file(s) for the full detail.
- (Components PRs specifically) lists every changed component with its
  resolved code location, or a note that no mapping was found.

`tokens/snapshots/` and `components/snapshots/` accumulate one file per
sync that produced a real change - nothing prunes them automatically by
design, so prune old ones by hand occasionally if repo size becomes a
concern.

### Credentials: secret vs. Variable

- **`FIGMA_TOKEN`** stays a **repository secret** (Settings → Secrets and
  variables → Actions → Secrets) - it's the one real credential here.
- **`FIGMA_FILE_KEY`** is not sensitive, just an identifier, so it belongs
  in **repository Variables** (same page, Variables tab) instead - editable
  from the GitHub UI with no code change. All three workflows read
  `vars.FIGMA_FILE_KEY` first, falling back to `secrets.FIGMA_FILE_KEY` for
  compatibility with the old secret-only setup (safe to delete that secret
  once the Variable is confirmed working).
- **`FIGMA_API_BASE_URL`** is an optional repo Variable for pointing at a
  non-standard Figma API host (e.g. an enterprise instance); defaults to
  `https://api.figma.com/v1` from `config.json` if unset.
- The two dedicated workflows also accept `figma_file_key` /
  `figma_api_base_url` as `workflow_dispatch` inputs, which override the
  repo Variables for that one run only - useful for testing against a
  different file without changing the persistent default.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `403 Token expired` | Regenerate `FIGMA_TOKEN` in Figma settings. |
| `Found 0 published component(s)` | Nothing's been published to a team library in this file yet - not an error. |
| `Resolved 0 Code Connect mapping(s)` | No `*.figma.tsx` files exist under `components.codeConnectDir` yet - add some, or rely on `componentMap`. |
| `Could not run Code Connect parse - continuing without code-location mapping` | Non-fatal; the rest of the sync still completes, just without Code Connect-derived locations for that run. |
| PR opens every day with all-zero counts | Shouldn't happen with the current gate - if it does, check that `tokens/diff-latest.json` / `components/diff-latest.json` are being read correctly in the "Check for changes" step. |

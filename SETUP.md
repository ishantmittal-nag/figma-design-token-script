# Design Sync — Setup & Operation Guide

This repo automatically syncs Figma design tokens (variables) and published
components into this codebase, flags breaking changes, and opens a PR for
review. This doc covers what needs to be in place to run it, both locally
and via the scheduled GitHub Action.

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

## 1. Prerequisites

- Node 18+ (the CI workflow pins `node-version: 18`; anything newer works
  too - this was developed and tested against Node 24 locally).
- `npm install` at the repo root. This also pulls in `@figma/code-connect`
  (used only for the local Code Connect cross-referencing step below, not
  for the app itself).

## 2. Figma credentials

Create a `.env` file at the repo root (already gitignored - never commit
this):

```
FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIGMA_FILE_KEY=xxxxxxxxxxxxxxxxxxxxxx
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
  `*.figma.tsx` files (see below). Defaults to `./src`.
- `components.componentMap` - manual fallback map from an exact Figma
  component name to its file path in this repo, for components that don't
  have a Code Connect mapping yet:

  ```json
  "componentMap": {
    "Button / Primary": "src/components/atoms/PrimaryButton.jsx"
  }
  ```

  Code Connect always wins when both exist for the same component (it's
  tied to the exact node, so it survives a Figma-side rename); this map is
  the fallback for everything else.

## 5. Components: publishing + Code Connect

The components script only sees components that have actually been
**published to a team library** in Figma - `Found 0 published component(s)`
means nothing's been published yet, not that something's broken.

To get a component's changes linked to a source file in the PR body, either:

- **Add it to `componentMap`** above (no extra tooling, works immediately), or
- **Adopt Code Connect** (requires a Figma Organization/Enterprise plan +
  Dev Mode seat): create `YourComponent.figma.tsx` next to the real
  component, e.g.:

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

  `sync-figma-components.js` runs `figma connect parse` locally on every
  sync (no publish needed for our purposes) to build this mapping
  automatically - nothing else to wire up. Running `npx figma connect
  publish` separately is what makes the snippet show up in Figma's own Dev
  Mode panel, which is a nice bonus but not required for the PR flagging to
  work.

## 6. Automated sync (`.github/workflows/design-sync.yml`)

Runs daily at midnight UTC (and on-demand via **Actions → Design Tokens
Sync → Run workflow**). Requires two **repository secrets** (Settings →
Secrets and variables → Actions): `FIGMA_TOKEN` and `FIGMA_FILE_KEY`, same
values as your local `.env`.

It runs both scripts, then opens a PR **only if either diff report shows a
real change** (added/removed/modified/renamed > 0) - not on every run, since
the diff reports' own timestamps would otherwise make the working tree look
"different" every single day even with zero actual token/component changes.
The PR:
- Is titled with ⚠️ if any breaking change was found, ✅ otherwise.
- Lists every changed component with its resolved code location (or a
  note that no mapping was found).
- Links to both `tokens/diff-latest.json` and `components/diff-latest.json`
  for the full detail.

`tokens/snapshots/` and `components/snapshots/` accumulate one file per
sync that produced a real change - nothing prunes them automatically by
design, so prune old ones by hand occasionally if repo size becomes a
concern.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `403 Token expired` | Regenerate `FIGMA_TOKEN` in Figma settings. |
| `Found 0 published component(s)` | Nothing's been published to a team library in this file yet - not an error. |
| `Resolved 0 Code Connect mapping(s)` | No `*.figma.tsx` files exist under `components.codeConnectDir` yet - add some, or rely on `componentMap`. |
| `Could not run Code Connect parse - continuing without code-location mapping` | Non-fatal; the rest of the sync still completes, just without Code Connect-derived locations for that run. |
| PR opens every day with all-zero counts | Shouldn't happen with the current gate - if it does, check that `tokens/diff-latest.json` / `components/diff-latest.json` are being read correctly in the "Check for changes" step. |

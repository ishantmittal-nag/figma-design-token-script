# Components Sync — Deep Dive

Pipeline-specific KT for `sync-figma-components.js`. See
[`SETUP.md`](../SETUP.md) for the shared overview (prerequisites,
credentials, which workflows exist) - this doc covers what's specific to
the components pipeline: how mapping/diffing actually works, and
troubleshooting unique to it.

## What it does

Fetches every component **published to a team library** in the target
Figma file, cross-references each one against this codebase (via Code
Connect and/or a manual mapping), diffs it against the previous run, and
flags anything that looks like a breaking change (a component removed or
renamed).

```
config.json + env vars
        │
        ▼
   config.js  (loadComponentsConfig)  ── resolves paths, validates FIGMA_TOKEN / FIGMA_FILE_KEY
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

`sync-figma-components.js` only runs `main()` automatically when invoked
directly (`node sync-figma-components.js`) - not when imported, so its pure
functions (diffing, node-id resolution, mapping precedence) can be
exercised in isolation, e.g. from a test.

## Component identity

Two different "identity" keys are used deliberately, matching how the Figma
API itself is inconsistent about it:

- **`key`** (Figma's published component key) is stable across renames and
  re-edits - used for the added/removed/renamed/modified diff.
- **`node_id`** (or the *component set's* node id, for a variant) is used to
  join against Code Connect and the manual `componentMap` - both of those
  are written against a Figma node URL, which survives renames the same way.

## Mapping precedence

For a given component, `resolveCodeLocation()` picks a code location in
this order:

1. **Code Connect** (`*.figma.tsx` files under `components.codeConnectDir`,
   default `./src` - parsed via the `@figma/code-connect` CLI) -
   authoritative when present. This repo has no application source of its
   own, so `./src` won't exist unless `codeConnectDir` is pointed at a
   local checkout of the app repo (or a subset of it, staged before the
   sync runs) - without that, this step finds nothing and every component
   falls through to `componentMap` or `unmapped`.
2. **Manual `componentMap`** in `config.json` - a fallback for components
   nobody's connected yet. Keyed by the full Figma node URL (Figma's "Copy
   link to selection"), not by name.
3. **Unmapped** - no code location found; reported as `mappingSource:
   "unmapped"` in `components/code-connect-map.json`.

Both Code Connect and the manual map resolve through the *component set's*
node id for a variant, not the variant's own node id - a `figma.connect(...)`
call (or a `componentMap` entry) is written against the set (e.g. "Input
Field"), covering every variant through props, while the Components API
publishes each variant under its own node id. If a component that should be
mapped shows up as `unmapped` instead, check that the `figma.connect(...)`
call targets the set's node URL, not one variant's.

## Figma access specifics

- Needs a token with read access to file content, and the file must have
  **published components** (a team library file with at least one
  published component/component set) - `Found 0 published component(s)`
  means nothing's published yet, not an error.
- `figma connect parse` is **local file parsing only** - it reads
  `*.figma.tsx` files from disk and does not itself call the Figma API,
  despite `FIGMA_TOKEN` being passed through to it as `FIGMA_ACCESS_TOKEN`
  for compatibility with future Code Connect CLI features that might need it.

## Troubleshooting (components-specific)

- **Everything reports `mappingSource: "unmapped"`** - expected if
  `codeConnectDir` is left at its default `./src` and `componentMap` is
  empty, since neither has anything to resolve against in this repo. Either
  populate `componentMap`, or point `codeConnectDir` at a local checkout
  that actually has `*.figma.tsx` files targeting the component *set's*
  node URL (see above).
- **"Could not run Code Connect parse - continuing without code-location
  mapping"** - non-fatal; the CLI itself failed to run (e.g. a
  `figma.config.json` parser mismatch). The rest of the sync still
  completes, just without Code Connect-derived locations for that run.
- **A component that should be Code Connect-mapped shows up as `manual` or
  `unmapped` instead** - see the node-id precedence note above.
- **PR shows a component as changed but the code looks untouched** -
  `modified` is driven by Figma's own `updated_at` timestamp on the
  component, not a diff of visual properties. A no-op republish in Figma
  (e.g. saving without changes) can still bump this.

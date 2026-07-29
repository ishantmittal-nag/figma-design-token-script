# Component Sync: What It Catches, What It Misses, and Why

`sync-figma-components.js` diffs published Figma components against the previous
snapshot and flags additions/removals/renames/republishes, the same way
`sync-figma-tokens.js` diffs variables. This document records what that diff can
and cannot see, based on what the Figma REST API and Code Connect actually expose
— not a bug list, a description of the data source's real shape.

## 1. How Figma exposes components via the REST API

The script calls `GET /v1/files/:file_key/components`
([sync-figma-components.js:88-109](sync-figma-components.js#L88-L109)). Per
[Figma's REST API docs](https://developers.figma.com/docs/rest-api/), this is a
**Tier 3** endpoint requiring the `library_assets:read` scope, and it returns
**only published-library components** — nothing shows up here until someone hits
Publish in Figma's Assets panel.

Every entry in the response has exactly these fields (verified against your
actual `components/components-latest.json`):

```
key, file_key, node_id, thumbnail_url, name, description, description_rt,
created_at, updated_at,
containing_frame: { name, nodeId, pageId, pageName, backgroundColor,
                     containingStateGroup, containingComponentSet },
user: { id, handle, img_url }
```

That's it. There is **no `fills`, `strokes`, `effects`, `children`, or
`boundVariables` field anywhere in this payload** — not on the component, not on
`containing_frame`. `containing_frame.backgroundColor` looks like it might be
color data, but it's the background of the *outer wrapper frame* (e.g. "Button",
"Product Card") the component set lives in, not a paint on the component or any
of its child layers — and in your file it's `rgba(0, 0, 0, 0)` on all 17
components, i.e. unset. The diff logic doesn't read this field at all today
([sync-figma-components.js:274-337](sync-figma-components.js#L274-L337)).

To get a component's own visual definition (fills, strokes, effects, nested
layers), you need a different, heavier endpoint —
`GET /v1/files/:file_key/nodes?ids=<node_id>` — which the current script never
calls. See [§5](#5-what-a-more-expensive-approach-would-look-like).

## 2. How Figma exposes Code Connect mappings

Code Connect associates a Figma component with a source-code location. There are
two distinct ways to get at that association, and they are **not** interchangeable:

| Mechanism | What it sees | Usable from headless CI? |
|---|---|---|
| `figma connect parse --dir <path>` (CLI) | Only local `*.figma.tsx` files under `<path>`, in *this* repo | Yes — this is what `sync-figma-components.js` runs ([sync-figma-components.js:136-195](sync-figma-components.js#L136-L195)) |
| `get_code_connect_map` (Figma MCP server tool) | Mappings **already published to Figma's servers**, from any codebase | No — see below |

Published Code Connect mappings genuinely live on Figma's servers regardless of
which repo published them, but the *only* documented way to query them is
Figma's MCP server, which comes in two flavors per
[Figma's MCP server docs](https://developers.figma.com/docs/figma-mcp-server/):

- **Local server** (`127.0.0.1:3845`) — requires the Figma desktop app open, in
  Dev Mode, with Code Connect enabled in MCP settings. Not something a CI runner
  can have running.
- **Remote server** (`https://mcp.figma.com/mcp`) — OAuth-authenticated, but
  Figma's own docs state it "Only clients listed in the Figma MCP Catalog like
  VS Code, Cursor, or Claude Code can connect" — it is not a general-purpose
  HTTP API and isn't built for backend/CI calls.

There is no REST API endpoint for Code Connect mappings at all.

**Consequence:** if a component's Code Connect mapping was published from a
*different* repository than this one, `sync-figma-components.js` cannot see it,
under any configuration. The only mapping source it can reach is (a) local
`.figma.tsx` files in this repo, or (b) the manual `componentMap` fallback in
`config.json`.

## 3. What the current pipeline catches

Diffing is entirely keyed on the component's stable `key`
([sync-figma-components.js:274-337](sync-figma-components.js#L274-L337)), mirroring
how variables are diffed by ID. Given your actual 17 components (Button ×6
variants, Input Field ×5 states, Card ×3 types, Product Card ×3 states), here's
what each category catches:

- **Added** — a new `key` appears that wasn't in the previous snapshot.
  Example: someone adds a `Type=Tertiary, State=Default` variant to the Button
  component set and publishes it.
- **Removed** — a `key` from the previous snapshot is gone.
  Example: `State=Error` is deleted from Input Field and the library republished.
- **Renamed** — same `key`, different `name`.
  Example: `Type=Primary, State=Default` renamed to `Type=Primary, State=Idle`,
  same underlying component.
- **Modified** — same `key`, `updated_at` timestamp changed.
  Example: the Button component's *structure* changes (a new child layer added,
  auto-layout padding changed, a layer reordered) and the library is republished
  — `updated_at` bumps, `modified` fires, even though we don't know *what*
  specifically changed inside it.

All four require the change to have been **published** — an edit sitting
unpublished in the Figma file is invisible to this whole pipeline until someone
hits Publish.

## 4. What the current pipeline misses

- **Any color/fill/stroke/effect change**, on the component or any child layer,
  hardcoded or otherwise — because the data source has no such fields, full stop
  (§1). This applies even to a republished change: `modified` will still fire
  (because `updated_at` moved), but the diff report can never say *"the fill
  changed from X to Y"* — only *"something about this changed, go look."*
  Example: the Button's Hover-state background is manually recolored (not via
  a bound variable) and republished — `modified` fires but with zero detail
  about what changed.
- **Color changes via a bound Variable** are correctly *not* flagged here at
  all — not a gap, a design boundary. If `Type=Primary, State=Default`'s fill
  references a color variable and only the variable's *value* changes, the
  component's own definition (still pointing at the same variable) is
  unchanged, so `updated_at` doesn't move and nothing republishes. That value
  change is exactly what `tokens/diff-latest.json` (from `sync-figma-tokens.js`)
  already reports — it's the correct place for it, not a hole in the component
  diff.
- **Unpublished edits** — any change made in the Figma file that hasn't been
  pushed through Publish yet is invisible regardless of what it is.
- **Code Connect mappings published from another repository** — see §2. Right
  now `componentMap` in `config.json` is empty and there are no `.figma.tsx`
  files in `./src`, so every component currently resolves to
  `codeLocation: null` in the diff output.
- **What specifically changed structurally** — even a legitimate `modified`
  (padding, a reordered layer, a new child) reports only "this key's
  `updated_at` moved," never a description of the change, since the endpoint
  never returns the properties that changed.

## 5. What a more expensive approach would look like

To catch actual visual property changes (colors, structure), the script would
need to additionally call `GET /v1/files/:file_key/nodes?ids=<id1>,<id2>,...`
— batchable into one request across all component `node_id`s (and
`containing_frame.nodeId`s, to reach children outside the component's own
subtree) — then, per node, walk `document.fills` / `document.strokes` /
`document.effects` / `document.children[].fills` (recursively, since a color
change can be arbitrarily deep in the tree) and hash or deep-diff that subtree
against the previous snapshot's copy of the same data.

### Measured, not estimated

Rather than guess, I called this endpoint directly against your real file and
saved the raw responses in this repo for inspection:

- [`components/node-sample-button.json`](components/node-sample-button.json) —
  one request for node `2:72`, the Button component *set* (all 6 variants as
  children).
- [`components/node-sample-all-17.json`](components/node-sample-all-17.json) —
  one batched request for all 17 of your current components' own `node_id`s
  (the same set `/components` returns today).

| | `/components` (current, Tier 3) | `/nodes` (proposed, Tier 1) |
|---|---|---|
| Same 17 components | 18,416 bytes, **1.25s** | 132,981 bytes, **4.43s** |
| Nodes actually returned | 17 (flat metadata) | 128 (nested, avg depth up to 5) |
| Payload ratio | 1× | **~7.2× larger** |
| Figma rate-limit tier | 50–150 req/min (Dev/Full seat, Starter→Enterprise) | **10–20 req/min** (Dev/Full seat, Starter→Enterprise) — confirmed from [Figma's rate-limit table](https://developers.figma.com/docs/rest-api/rate-limits) |

Two compounding problems, not one:

1. **Payload scales with total nested nodes, not component count.** Your 17
   components average ~7.5 descendant nodes each once you expand fills/strokes/
   children (128 nodes / 17 requested ids). Extrapolating linearly to 300
   components: ~2,250 nested nodes, ~2.3MB raw JSON per sync run, versus ~325KB
   on `/components` today for the same count. That's the payload/parse/diff
   cost, and it keeps growing — component libraries tend to add nested
   structure (icons, sub-components) faster than they add top-level components.
2. **The endpoint itself is far more rate-limited than the one we use today.**
   `/v1/files/:file_key/nodes` is a **Tier 1** endpoint — Figma's most
   restricted tier (10–20 requests/minute even on a paid Dev seat, and "up to
   6/month" on a View/Collab seat). `/components` is Tier 3 (50–150/min). A
   single 300-component request will also very likely exceed practical
   comma-separated URL-length limits long before it exceeds the id count Figma
   permits, forcing it to be split into multiple `/nodes` calls — each one
   competing for that same tight 10–20/min Tier-1 budget, shared across
   whatever else in your pipeline calls Tier 1 endpoints. `sync-figma-tokens.js`
   already makes one Tier-1-adjacent file call per run
   ([sync-figma-tokens.js:102](sync-figma-tokens.js#L102) via
   `getFigmaFileVersion`); a node-tree color diff would need to coexist with
   that in the same rate budget.

In short: it's not just "a bigger response" — it's a ~7× heavier payload per
call, running against an endpoint with a rate ceiling roughly **5–10× tighter**
than the one the current pipeline uses. At your current scale (17 components)
it's a non-issue (4.4s, one call, well under 10/min). At "hundreds of
components," the payload becomes multi-megabyte and the request volume alone
risks tripping Figma's own throttling — independent of anything about how
carefully the diffing logic itself is written.

Other tradeoffs versus the current approach:

- **Signal-to-noise**: a raw subtree hash changes on *anything* — a 1px position
  nudge, a layer renamed by a designer while iterating, a reorder — not just
  color. Getting back to "a color changed" specifically means diffing
  `fills`/`strokes`/`effects` in isolation from geometry/position fields, which
  is meaningfully more logic than `generateDiffReport`'s current identity/name/
  timestamp comparison.
- **Still gated on Publish**: this doesn't change — the `/nodes` endpoint reads
  whatever is currently in the file, but if the goal is still "diff what shipped
  to the library," you'd want to fetch nodes as of each *published* snapshot,
  which the components endpoint's `updated_at` already tells you when to do.
- **Code Connect**: no equivalent expensive-but-possible option exists for
  mappings published from other repos — that gap is a platform limitation (§2),
  not a matter of calling a heavier endpoint. The only mitigation is keeping
  `componentMap` current by hand, or standardizing Code Connect files inside
  this repo so `figma connect parse` can actually find them.

This isn't currently implemented. Worth building only if component-level color
diffing (independent of the variables pipeline) is something you actually need
day to day — happy to build it if so.

## Sources

- [Figma REST API — Introduction](https://developers.figma.com/docs/rest-api/)
- [Figma REST API — Component endpoints](https://developers.figma.com/docs/rest-api/component-endpoints/)
- [Figma REST API — Rate limits](https://developers.figma.com/docs/rest-api/rate-limits)
- [Figma MCP Server — overview](https://developers.figma.com/docs/figma-mcp-server/)
- [Figma MCP Server — remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Figma Help Center — Code Connect](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect)
- `components/components-latest.json` in this repo (actual API response, inspected directly)

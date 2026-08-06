# Figma Design Sync

Syncs Figma design tokens (variables) and published components into this
repository, flags breaking changes, and opens a PR for review. This repo
contains only the sync pipeline itself - no application code.

Start with [`SETUP.md`](SETUP.md) for prerequisites, credentials, and how
the three GitHub Actions workflows work. For pipeline-specific detail
(architecture, mapping/category rules, troubleshooting), see
[`docs/components-sync.md`](docs/components-sync.md) and
[`docs/tokens-sync.md`](docs/tokens-sync.md).

## Quick start

```bash
npm install
cp .env.example .env   # fill in FIGMA_TOKEN and FIGMA_FILE_KEY
npm run sync:tokens
npm run sync:components
```

## What's in here

| Path | What it is |
|---|---|
| `sync-figma-tokens.js`, `sync-figma-components.js` | The two sync scripts |
| `config.js`, `config.json` | Shared config loading + pipeline settings |
| `tokens/`, `components/` | Generated output (committed - this is the point of the sync) |
| `.github/workflows/` | Three workflows: combined (`design-sync.yml`), and one dedicated workflow per pipeline |
| `docs/`, `SETUP.md` | KT / operational documentation |

If you're looking for the application these tokens/components feed into,
that lives in a separate repository - this one only produces the synced
data and generated CSS.

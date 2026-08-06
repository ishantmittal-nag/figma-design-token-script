import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ==================================================
// Script-relative Paths
// ==================================================

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveFromScript(relativePath) {
    return path.resolve(SCRIPT_DIR, relativePath);
}

// ==================================================
// Load Configuration + Environment
// ==================================================
// Reads config.json plus the env vars it names, validates the required
// Figma credentials are present, and resolves every path relative to this
// script's own directory (so the sync still works regardless of the caller's
// cwd). Kept as a plain function - not run on import - so it can be called
// (and mocked) independently of the rest of the sync, e.g. from a test.
//
// FIGMA_API_BASE_URL is the one setting exposed as a direct env override on
// top of config.json: it lets a GitHub Actions run point at a different
// Figma API host (e.g. an enterprise instance) via a repo Variable or
// workflow_dispatch input, without editing config.json or touching secrets.

export function loadConfig() {
    const configPath = resolveFromScript("config.json");
    const configData = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData);

    const FIGMA_TOKEN = process.env[config.environment.figmaTokenVar]?.trim();
    const FIGMA_FILE_KEY = process.env[config.environment.figmaFileKeyVar]?.trim();

    if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) {
        throw new Error(
            `Missing ${config.environment.figmaTokenVar} or ${config.environment.figmaFileKeyVar} in environment`
        );
    }

    return {
        SCRIPT_DIR,
        FIGMA_TOKEN,
        FIGMA_FILE_KEY,
        OUTPUT_DIR: resolveFromScript(config.paths.outputDir),
        SNAPSHOT_DIR: resolveFromScript(config.paths.snapshotDir),
        LATEST_JSON: resolveFromScript(config.paths.latestJsonFile),
        LATEST_CSS_DIR: resolveFromScript(config.paths.latestCssDir),
        API_BASE_URL: process.env.FIGMA_API_BASE_URL?.trim() || config.figma.apiBaseUrl,
        UNITS_CONFIG: config.css?.units || {},
        SCOPE_CATEGORY_MAP: config.css?.scopeCategoryMap || {},
        CSS_CATEGORIES: config.css?.categories || ["other"]
    };
}

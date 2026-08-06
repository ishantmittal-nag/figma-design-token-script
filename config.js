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
// Load config.json + validate the shared env vars
// ==================================================
// Both sync-figma-tokens.js and sync-figma-components.js read the same
// config.json and need the same two credentials, so that part is shared;
// each script gets its own loader below for the config it actually uses,
// rather than one loader returning a big object with both scripts' fields
// mixed together.

function loadRawConfig() {
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

    // FIGMA_API_BASE_URL is the one setting exposed as a direct env override
    // on top of config.json: it lets a GitHub Actions run point at a
    // different Figma API host (e.g. an enterprise instance) via a repo
    // Variable or workflow_dispatch input, without editing config.json or
    // touching secrets.
    const API_BASE_URL = process.env.FIGMA_API_BASE_URL?.trim() || config.figma.apiBaseUrl;

    return { config, FIGMA_TOKEN, FIGMA_FILE_KEY, API_BASE_URL };
}

export function loadTokensConfig() {
    const { config, FIGMA_TOKEN, FIGMA_FILE_KEY, API_BASE_URL } = loadRawConfig();

    return {
        SCRIPT_DIR,
        FIGMA_TOKEN,
        FIGMA_FILE_KEY,
        API_BASE_URL,
        OUTPUT_DIR: resolveFromScript(config.paths.outputDir),
        SNAPSHOT_DIR: resolveFromScript(config.paths.snapshotDir),
        LATEST_JSON: resolveFromScript(config.paths.latestJsonFile),
        LATEST_CSS_DIR: resolveFromScript(config.paths.latestCssDir),
        UNITS_CONFIG: config.css?.units || {},
        SCOPE_CATEGORY_MAP: config.css?.scopeCategoryMap || {},
        CSS_CATEGORIES: config.css?.categories || ["other"]
    };
}

export function loadComponentsConfig() {
    const { config, FIGMA_TOKEN, FIGMA_FILE_KEY, API_BASE_URL } = loadRawConfig();
    const OUTPUT_DIR = resolveFromScript(config.components.outputDir);

    return {
        SCRIPT_DIR,
        FIGMA_TOKEN,
        FIGMA_FILE_KEY,
        API_BASE_URL,
        OUTPUT_DIR,
        SNAPSHOT_DIR: resolveFromScript(config.components.snapshotDir),
        LATEST_JSON: resolveFromScript(config.components.latestJsonFile),
        CODE_CONNECT_DIR: resolveFromScript(config.components.codeConnectDir),
        MAPPING_JSON: path.join(OUTPUT_DIR, "code-connect-map.json"),
        // Keyed by full Figma node URL (e.g. "https://www.figma.com/design/FILEKEY/Name?node-id=1-2"),
        // copied straight from Figma's "Copy link to selection" - not by component name, so an entry
        // survives a rename the same way a Code Connect file does.
        COMPONENT_MAP: config.components.componentMap || {}
    };
}

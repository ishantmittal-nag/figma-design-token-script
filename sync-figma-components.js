import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import {
    makeScriptRelativeResolver,
    getFormattedTimestamp,
    getFigmaFileVersion,
    loadSnapshot,
    getLatestTwoSnapshots,
    detectBreakingChanges,
    formatDiffSummary,
    saveDiffReport
} from "./figma-sync-shared.js";

dotenv.config();

// ==================================================
// Script-relative Paths
// ==================================================

const resolveFromScript = makeScriptRelativeResolver(import.meta.url);
const SCRIPT_DIR = resolveFromScript(".");

// ==================================================
// Load Configuration
// ==================================================

let config;

try {
    const configPath = resolveFromScript("config.json");
    const configData = fs.readFileSync(
        configPath,
        "utf-8"
    );
    config = JSON.parse(configData);
} catch (error) {
    console.error(
        "Failed to load config.json:",
        error.message
    );
    process.exit(1);
}

// ==================================================
// Environment Variables
// ==================================================

const FIGMA_TOKEN = process.env[
    config.environment.figmaTokenVar
]?.trim();

const FIGMA_FILE_KEY = process.env[
    config.environment.figmaFileKeyVar
]?.trim();

// ==================================================
// Configuration from config.json
// ==================================================

const OUTPUT_DIR = resolveFromScript(config.components.outputDir);
const SNAPSHOT_DIR = resolveFromScript(config.components.snapshotDir);
const LATEST_JSON = resolveFromScript(config.components.latestJsonFile);
const CODE_CONNECT_DIR = resolveFromScript(config.components.codeConnectDir);

// Raw config shape is { <figma component URL>: <source path> } - resolved to
// a node-id-keyed lookup once Code Connect's own URL-parsing helper is
// available (declared further down, but hoisted - see "URL / Node ID
// Resolution" below).
const COMPONENT_MAP_BY_URL = config.components.componentMap || {};
const COMPONENT_MAP_BY_NODE_ID = buildComponentMapByNodeId(COMPONENT_MAP_BY_URL);

const API_BASE_URL = config.figma.apiBaseUrl;

// ==================================================
// Validate Environment
// ==================================================

if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) {
    console.error(
        `Missing ${config.environment.figmaTokenVar} or ${config.environment.figmaFileKeyVar} in environment`
    );
    process.exit(1);
}

// ==================================================
// Fetch Published File Components
// ==================================================
// Unlike variables (which are readable as soon as they exist locally in the
// file), this only returns components that have actually been published to
// a team library - an empty result here means nothing's been published yet,
// not that the request failed.

async function getFileComponents() {
    const url = `${API_BASE_URL}/files/${FIGMA_FILE_KEY}/components`;

    console.log("Fetching published Figma components...");

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "X-Figma-Token": FIGMA_TOKEN
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Figma API request failed: ${response.status}\n${errorText}`
        );
    }

    const data = await response.json();
    return data?.meta?.components || [];
}

// ==================================================
// URL / Node ID Resolution
// ==================================================
// Both code-location sources - Code Connect and the manual componentMap -
// are keyed off a Figma node id extracted from a URL, rather than a
// component's `name`. A component's `name` is not a safe key on its own:
// Figma's variant-naming convention ("State=Default", "Type=Primary") is
// generic by design, so unrelated components in the same file routinely end
// up with an identical `name` (this file has two: Product Card and Input
// Field both have variants literally named "State=Default" and
// "State=Disabled"). node_id has none of that ambiguity - it's unique
// within the file - and is stable across renames/restyles, which is why the
// Files API's own diff logic already keys off it for everything else.

function normalizeNodeId(nodeId) {
    // Figma node URLs use "123-456"; the Files API returns "123:456".
    return nodeId.replace(/-/g, ":");
}

function extractNodeIdFromUrl(figmaNodeUrl) {
    try {
        const url = new URL(figmaNodeUrl);
        const nodeId = url.searchParams.get("node-id");
        return nodeId ? normalizeNodeId(nodeId) : null;
    } catch {
        return null;
    }
}

// Turns the human-authored { <figma URL> : <source path> } map from
// config.json into a { <node id> : <source path> } lookup, using the same
// URL parsing Code Connect's own mapping goes through - one identifier
// scheme for both code-location sources instead of two.
function buildComponentMapByNodeId(componentMapByUrl) {
    const map = {};

    for (const [figmaUrl, source] of Object.entries(componentMapByUrl)) {
        const nodeId = extractNodeIdFromUrl(figmaUrl);

        if (!nodeId) {
            console.warn(
                `componentMap entry has an unparseable Figma URL, skipping: ${figmaUrl}`
            );
            continue;
        }

        map[nodeId] = source;
    }

    return map;
}

// ==================================================
// Code Connect Cross-Reference
// ==================================================
// Runs the Code Connect CLI locally against whatever *.figma.tsx files
// already exist in the repo (no Figma API call needed for this part - it's
// purely local source parsing) to build a map from a component's Figma node
// id to the source file it's connected to. That's what lets a changed Figma
// component get reported alongside the actual codebase location a developer
// needs to look at, instead of just a bare component name.

function getCodeConnectMap() {
    // Invoke the CLI's own JS entrypoint directly through `node` rather than
    // shelling out to `npx`/`npx.cmd` - npx resolves to a platform-specific
    // shim (a .cmd file on Windows) that execFileSync can't run without a
    // shell, while the bin script itself is plain node-executable JS on
    // every platform.
    const codeConnectBin = resolveFromScript("node_modules/@figma/code-connect/bin/figma");

    let raw;

    try {
        raw = execFileSync(
            process.execPath,
            [codeConnectBin, "connect", "parse", "--dir", CODE_CONNECT_DIR],
            {
                cwd: SCRIPT_DIR,
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    ...process.env,
                    FIGMA_ACCESS_TOKEN: FIGMA_TOKEN
                }
            }
        );
    } catch (error) {
        console.warn(
            "Could not run Code Connect parse - continuing without code-location mapping:",
            error.message
        );
        return {};
    }

    let entries;

    try {
        entries = JSON.parse(raw);
    } catch {
        console.warn(
            "Code Connect parse did not return valid JSON - continuing without code-location mapping"
        );
        return {};
    }

    const map = {};

    for (const entry of entries) {
        const nodeId = extractNodeIdFromUrl(entry.figmaNode);

        if (!nodeId) {
            continue;
        }

        map[nodeId] = {
            source: entry.source || entry._codeConnectFilePath || null,
            component: entry.component || null
        };
    }

    return map;
}

// ==================================================
// Save JSON Snapshots with Versioning
// ==================================================

function saveJSONSnapshots(components, figmaVersion) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const timestamp = getFormattedTimestamp();
    const snapshotKey = `${timestamp}_${figmaVersion}`;

    const componentsByKey = {};
    for (const component of components) {
        componentsByKey[component.key] = component;
    }

    const jsonData = {
        fileKey: FIGMA_FILE_KEY,
        figmaVersion: figmaVersion,
        snapshotKey: snapshotKey,
        fetchedAt: new Date().toISOString(),
        components: componentsByKey
    };

    const formattedJSON = JSON.stringify(jsonData, null, 2);

    // Save latest JSON
    fs.writeFileSync(LATEST_JSON, formattedJSON, "utf-8");
    console.log("Updated components/components-latest.json");

    // Save timestamped snapshot
    const snapshotPath = path.join(
        SNAPSHOT_DIR,
        `components-${snapshotKey}.json`
    );

    fs.writeFileSync(snapshotPath, formattedJSON, "utf-8");
    console.log(`Created snapshot: ${snapshotPath}`);

    return snapshotKey;
}

// ==================================================
// Diff and Breaking Change Detection
// ==================================================

// Code Connect is the authoritative source when a component has one (it's
// tied to the exact node, so it survives a rename); the manual componentMap
// in config.json is the fallback. Both are resolved by node_id, which -
// unlike `name` - doesn't change across a rename, so a single lookup covers
// the rename case too instead of needing to check both the old and new name.
function resolveCodeLocation(component, codeConnectMap) {
    const codeConnectMatch = codeConnectMap[component.node_id];
    if (codeConnectMatch?.source) {
        return codeConnectMatch.source;
    }

    return COMPONENT_MAP_BY_NODE_ID[component.node_id] || null;
}

function describeComponent(component, codeConnectMap) {
    return {
        key: component.key,
        name: component.name,
        nodeId: component.node_id,
        codeLocation: resolveCodeLocation(component, codeConnectMap)
    };
}

function generateDiffReport(previousSnapshot, currentSnapshot, codeConnectMap) {
    const previousComponents = previousSnapshot.components || {};
    const currentComponents = currentSnapshot.components || {};

    const added = [];
    const removed = [];
    const modified = [];
    const renamed = [];

    // Every comparison below keys off the Figma component's published `key`,
    // which is stable across renames and re-edits - the same reasoning
    // applied to variable IDs in sync-figma-tokens.js.

    // Find removed components
    for (const [key, component] of Object.entries(previousComponents)) {
        if (!currentComponents[key]) {
            removed.push(describeComponent(component, codeConnectMap));
        }
    }

    // Find added components
    for (const [key, component] of Object.entries(currentComponents)) {
        if (!previousComponents[key]) {
            added.push(describeComponent(component, codeConnectMap));
        }
    }

    // Find renamed/modified components
    for (const [key, currentComponent] of Object.entries(currentComponents)) {
        if (previousComponents[key]) {
            const previousComponent = previousComponents[key];

            if (previousComponent.name !== currentComponent.name) {
                renamed.push({
                    previousName: previousComponent.name,
                    currentName: currentComponent.name,
                    key: key,
                    // node_id doesn't change on a rename, so this resolves
                    // correctly without needing to check the old name too.
                    codeLocation: resolveCodeLocation(currentComponent, codeConnectMap)
                });
            }

            // Figma stamps published components with their own `updated_at`
            // on every republish, so that's the "did this change" signal -
            // no need to hash/compare visual properties ourselves.
            if (previousComponent.updated_at !== currentComponent.updated_at) {
                modified.push(describeComponent(currentComponent, codeConnectMap));
            }
        }
    }

    return {
        added,
        removed,
        modified,
        renamed
    };
}

function detectComponentBreakingChanges(diff) {
    return detectBreakingChanges([
        { type: "REMOVED_COMPONENTS", items: diff.removed, message: c => `${c} component(s) removed` },
        { type: "RENAMED_COMPONENTS", items: diff.renamed, message: c => `${c} component(s) renamed` }
    ]);
}

// ==================================================
// Main
// ==================================================

async function main() {
    console.log("\n=========================================");
    console.log("Figma Component Sync");
    console.log("=========================================\n");

    try {
        // Fetch file version and published components concurrently -
        // independent requests, same pattern as sync-figma-tokens.js.
        const [figmaVersion, components] = await Promise.all([
            getFigmaFileVersion(API_BASE_URL, FIGMA_FILE_KEY, FIGMA_TOKEN),
            getFileComponents()
        ]);

        console.log(
            `Found ${components.length} published component(s)`
        );

        // Save JSON files with versioning
        const snapshotKey = saveJSONSnapshots(components, figmaVersion);

        // Cross-reference with Code Connect (best-effort, non-fatal). Skip
        // the subprocess spawn entirely when there are no components to
        // annotate - the most expensive step in this script, and wasted
        // work whenever nothing's been published yet.
        const codeConnectMap = components.length > 0 ? getCodeConnectMap() : {};
        console.log(
            components.length > 0
                ? `Resolved ${Object.keys(codeConnectMap).length} Code Connect mapping(s)`
                : "Skipped Code Connect lookup - no published components to annotate"
        );

        // Generate diff report if previous snapshot exists
        let breakingChanges = [];

        const snapshots = getLatestTwoSnapshots(SNAPSHOT_DIR, "components-");
        if (snapshots) {
            const [latestPath, previousPath] = snapshots;
            const latestSnapshot = loadSnapshot(latestPath);
            const previousSnapshot = loadSnapshot(previousPath);

            const diff = generateDiffReport(previousSnapshot, latestSnapshot, codeConnectMap);
            breakingChanges = detectComponentBreakingChanges(diff);

            const diffSummary = formatDiffSummary(diff, breakingChanges, "COMPONENT CHANGES");
            console.log(diffSummary);

            saveDiffReport(OUTPUT_DIR, diff, breakingChanges, snapshotKey, "Component diff report");
        } else {
            console.log("\n📝 First run - no previous snapshot to compare");
        }

        console.log("\n=========================================");
        console.log("Figma component sync completed successfully");
        console.log(`Snapshot: ${snapshotKey}`);
        if (breakingChanges.length > 0) {
            console.log(`⚠️  ${breakingChanges.length} breaking change(s) detected`);
            console.log("=========================================\n");
            process.exit(1);
        } else {
            console.log("=========================================\n");
            process.exit(0);
        }
    } catch (error) {
        console.error("\nError:", error.message);
        process.exit(1);
    }
}

// ==================================================
// Execute
// ==================================================

main();

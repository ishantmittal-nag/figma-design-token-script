import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import { loadComponentsConfig, resolveFromScript } from "./config.js";

dotenv.config();

// ==================================================
// Configuration
// ==================================================
// See config.js - reads config.json plus the required env vars and resolves
// every path relative to this script's directory. Loaded eagerly here (not
// inside main()) so every function below can keep referencing these as
// plain module-level constants, same as before the config load moved out.

let CFG;

try {
    CFG = loadComponentsConfig();
} catch (error) {
    console.error("Failed to load configuration:", error.message);
    process.exit(1);
}

const {
    SCRIPT_DIR,
    FIGMA_TOKEN,
    FIGMA_FILE_KEY,
    OUTPUT_DIR,
    SNAPSHOT_DIR,
    LATEST_JSON,
    CODE_CONNECT_DIR,
    MAPPING_JSON,
    COMPONENT_MAP,
    API_BASE_URL
} = CFG;

// ==================================================
// Utility Functions
// ==================================================

function getFormattedTimestamp() {
    return new Date()
        .toISOString()
        .split(".")[0]
        .replace(/:/g, "-");
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
// Code Connect Cross-Reference
// ==================================================
// Runs the Code Connect CLI locally against whatever *.figma.tsx files
// already exist in the repo (no Figma API call needed for this part - it's
// purely local source parsing) to build a map from a component's Figma node
// id to the source file it's connected to. That's what lets a changed Figma
// component get reported alongside the actual codebase location a developer
// needs to look at, instead of just a bare component name.

export function normalizeNodeId(nodeId) {
    // Figma node URLs use "123-456"; the Files API returns "123:456".
    return nodeId.replace(/-/g, ":");
}

export function extractNodeIdFromUrl(figmaNodeUrl) {
    try {
        const url = new URL(figmaNodeUrl);
        const nodeId = url.searchParams.get("node-id");
        return nodeId ? normalizeNodeId(nodeId) : null;
    } catch {
        return null;
    }
}

// ==================================================
// Manual Mapping (config.json componentMap)
// ==================================================
// A same-project fallback for components nobody's connected yet: a developer
// pastes a Figma node URL (Figma's own "Copy link to selection") as the key,
// pointing at wherever the component lives in this codebase. Resolved to a
// node-id-keyed lookup up front, same join key Code Connect and the diff both
// use, so a rename in Figma doesn't orphan the entry the way a name key would.

function buildManualMapByNodeId(componentMap) {
    const map = {};

    for (const [figmaNodeUrl, codeLocation] of Object.entries(componentMap)) {
        const nodeId = extractNodeIdFromUrl(figmaNodeUrl);

        if (!nodeId) {
            console.warn(
                `Skipping componentMap entry - could not extract a node ID from "${figmaNodeUrl}". Expected a Figma node URL, e.g. https://www.figma.com/design/FILEKEY/Name?node-id=1-2`
            );
            continue;
        }

        map[nodeId] = codeLocation;
    }

    return map;
}

const MANUAL_MAP_BY_NODE_ID = buildManualMapByNodeId(COMPONENT_MAP);

function getCodeConnectMap() {
    // Invoke the CLI's own JS entrypoint directly through `node` rather than
    // shelling out to `npx`/`npx.cmd` - npx resolves to a platform-specific
    // shim (a .cmd file on Windows) that execFileSync can't run without a
    // shell, while the bin script itself is plain node-executable JS on
    // every platform.
    const codeConnectBin = resolveFromScript("node_modules/@figma/code-connect/bin/figma");

    // Code Connect looks for figma.config.json *inside* whatever --dir points
    // to, not the project root - but a project's config (e.g. `parser:
    // "react"`) belongs at the root regardless of which subdirectory holds
    // the actual *.figma.tsx files. Passing --config explicitly decouples
    // the two so a root-level figma.config.json is always picked up; if the
    // file doesn't exist, Code Connect just falls back to its own defaults.
    const args = ["connect", "parse", "--dir", CODE_CONNECT_DIR];
    const rootConfigPath = resolveFromScript("figma.config.json");
    if (fs.existsSync(rootConfigPath)) {
        args.push("--config", rootConfigPath);
    }

    let raw;

    try {
        raw = execFileSync(
            process.execPath,
            [codeConnectBin, ...args],
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
// Display Name + Figma URL Helpers
// ==================================================
// The Files API names a variant after its own variant properties (e.g.
// "Type=Primary, State=Disabled") - that's meaningless without knowing which
// component set it's a variant of. The set name is already in the response,
// just nested under containing_frame.containingComponentSet instead of on
// the component itself. Standalone components (not part of a set) have no
// containing_frame.containingComponentSet, so they fall back to their own name.

function getComponentSetName(component) {
    return component.containing_frame?.containingComponentSet?.name || null;
}

export function getDisplayName(component) {
    const setName = getComponentSetName(component);
    return setName ? `${setName} / ${component.name}` : component.name;
}

// Deep-links straight to the node so a developer can open the exact variant
// in Figma instead of hunting for it by name. The file title in the URL path
// is cosmetic - Figma resolves the file from fileKey alone and redirects.
function buildFigmaUrl(nodeId) {
    return `https://www.figma.com/design/${FIGMA_FILE_KEY}/?node-id=${nodeId.replace(":", "-")}`;
}

// ==================================================
// Clean Mapping File
// ==================================================
// components-latest.json is Figma's raw API response, kept for diffing.
// This is the file a developer or another tool should actually read: one
// small, flat object per currently-published component, keyed by node id,
// saying where (if anywhere) it lives in this codebase and how that location
// was determined.

function generateCleanMappingFile(components, codeConnectMap) {
    const mappings = {};

    for (const component of components) {
        const { location, mappingSource } = resolveCodeLocation(component, codeConnectMap);

        mappings[component.node_id] = {
            componentName: getDisplayName(component),
            componentSetName: getComponentSetName(component),
            key: component.key,
            figmaUrl: buildFigmaUrl(component.node_id),
            codeLocation: location,
            mappingSource
        };
    }

    const mappingData = {
        fileKey: FIGMA_FILE_KEY,
        generatedAt: new Date().toISOString(),
        mappings
    };

    fs.writeFileSync(MAPPING_JSON, JSON.stringify(mappingData, null, 2), "utf-8");
    console.log("Updated components/code-connect-map.json");

    return mappingData;
}

// ==================================================
// Save JSON Snapshots with Versioning
// ==================================================

function saveJSONSnapshots(components) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const timestamp = getFormattedTimestamp();
    const snapshotKey = timestamp;

    const componentsByKey = {};
    for (const component of components) {
        componentsByKey[component.key] = component;
    }

    const jsonData = {
        fileKey: FIGMA_FILE_KEY,
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

function getLatestTwoSnapshots() {
    const files = fs
        .readdirSync(SNAPSHOT_DIR)
        .filter(f => f.startsWith("components-") && f.endsWith(".json"))
        .sort()
        .reverse();

    if (files.length < 2) {
        return null; // First run, no previous snapshot to compare
    }

    return [
        path.join(SNAPSHOT_DIR, files[0]),
        path.join(SNAPSHOT_DIR, files[1])
    ];
}

function loadSnapshot(filePath) {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
}

// Code Connect is the authoritative source when a component has one (it's
// tied to the exact node, so it survives a rename); MANUAL_MAP_BY_NODE_ID is
// a same-project fallback for components nobody's gotten around to
// connecting yet. Both are keyed by node id, so neither needs a rename
// workaround - the id doesn't change when a component is renamed in Figma.
//
// A `figma.connect(...)` call (and a manual componentMap entry, following
// the same shape) is written against a component SET's node id (e.g.
// node-id=4-23 for "Input Field"), covering every variant through props like
// figma.enum(), not one call per variant. But the Components API publishes
// each variant under its own node id (4:2, 4:6, ...), so a variant's direct
// node_id essentially never appears in either map - both need to be checked
// against the variant's containingComponentSet id instead. Standalone
// components (no component set) fall through to the direct match, which is
// still correct since their published node id *is* the connect/mapping URL's
// node id.
export function resolveCodeLocation(component, codeConnectMap) {
    const setNodeId = component.containing_frame?.containingComponentSet?.nodeId;

    const codeConnectMatch = codeConnectMap[component.node_id] ||
        (setNodeId && codeConnectMap[setNodeId]);
    if (codeConnectMatch?.source) {
        return { location: codeConnectMatch.source, mappingSource: "code-connect" };
    }

    const manualMatch = MANUAL_MAP_BY_NODE_ID[component.node_id] ||
        (setNodeId && MANUAL_MAP_BY_NODE_ID[setNodeId]);
    if (manualMatch) {
        return { location: manualMatch, mappingSource: "manual" };
    }

    return { location: null, mappingSource: "unmapped" };
}

function describeComponent(component, codeConnectMap) {
    const { location, mappingSource } = resolveCodeLocation(component, codeConnectMap);

    return {
        key: component.key,
        name: getDisplayName(component),
        nodeId: component.node_id,
        figmaUrl: buildFigmaUrl(component.node_id),
        codeLocation: location,
        mappingSource
    };
}

export function generateDiffReport(previousSnapshot, currentSnapshot, codeConnectMap) {
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

            // Compare the full display name (component set name + variant name),
            // not just the variant's own name field - a variant's name is just
            // "State=Default" etc., so renaming the component SET itself (e.g.
            // "Input Field" -> "Input") would otherwise go undetected here.
            if (getDisplayName(previousComponent) !== getDisplayName(currentComponent)) {
                renamed.push({
                    previousName: getDisplayName(previousComponent),
                    currentName: getDisplayName(currentComponent),
                    key: key,
                    figmaUrl: buildFigmaUrl(currentComponent.node_id),
                    codeLocation: resolveCodeLocation(currentComponent, codeConnectMap).location
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

export function detectBreakingChanges(diff) {
    const breakingChanges = [];

    if (diff.removed.length > 0) {
        breakingChanges.push({
            type: "REMOVED_COMPONENTS",
            severity: "high",
            count: diff.removed.length,
            items: diff.removed,
            message: `${diff.removed.length} component(s) removed`
        });
    }

    if (diff.renamed.length > 0) {
        breakingChanges.push({
            type: "RENAMED_COMPONENTS",
            severity: "high",
            count: diff.renamed.length,
            items: diff.renamed,
            message: `${diff.renamed.length} component(s) renamed`
        });
    }

    return breakingChanges;
}

function formatDiffSummary(diff, breakingChanges) {
    let summary = "\n📊 COMPONENT CHANGES\n";
    summary += `  Added:    ${diff.added.length}\n`;
    summary += `  Removed:  ${diff.removed.length}\n`;
    summary += `  Modified: ${diff.modified.length}\n`;
    summary += `  Renamed:  ${diff.renamed.length}\n`;

    if (breakingChanges.length > 0) {
        summary += "\n⚠️  BREAKING CHANGES:\n";
        for (const change of breakingChanges) {
            summary += `  ❌ ${change.type} (${change.count})\n`;
        }
    }

    return summary;
}

function saveDiffReport(diff, breakingChanges, snapshotKey) {
    const diffData = {
        timestamp: new Date().toISOString(),
        snapshotKey: snapshotKey,
        summary: {
            added: diff.added.length,
            removed: diff.removed.length,
            modified: diff.modified.length,
            renamed: diff.renamed.length,
            breakingChanges: breakingChanges.length
        },
        changes: diff,
        breakingChanges: breakingChanges
    };

    const diffPath = path.join(OUTPUT_DIR, "diff-latest.json");
    fs.writeFileSync(diffPath, JSON.stringify(diffData, null, 2), "utf-8");
    console.log(`📄 Component diff report saved: ${diffPath}`);

    return diffPath;
}

// ==================================================
// Main
// ==================================================

async function main() {
    console.log("\n=========================================");
    console.log("Figma Component Sync");
    console.log("=========================================\n");

    try {
        // Fetch published components
        const components = await getFileComponents();

        console.log(
            `Found ${components.length} published component(s)`
        );

        // Save JSON files with versioning
        const snapshotKey = saveJSONSnapshots(components);

        // Cross-reference with Code Connect (best-effort, non-fatal)
        const codeConnectMap = getCodeConnectMap();
        console.log(
            `Resolved ${Object.keys(codeConnectMap).length} Code Connect mapping(s)`
        );
        console.log(
            `Resolved ${Object.keys(MANUAL_MAP_BY_NODE_ID).length} manual componentMap mapping(s)`
        );

        // Clean, flat node-id -> code-location mapping for humans/tooling
        generateCleanMappingFile(components, codeConnectMap);

        // Generate diff report if previous snapshot exists
        let breakingChanges = [];

        const snapshots = getLatestTwoSnapshots();
        if (snapshots) {
            const [latestPath, previousPath] = snapshots;
            const latestSnapshot = loadSnapshot(latestPath);
            const previousSnapshot = loadSnapshot(previousPath);

            const diff = generateDiffReport(previousSnapshot, latestSnapshot, codeConnectMap);
            breakingChanges = detectBreakingChanges(diff);

            const diffSummary = formatDiffSummary(diff, breakingChanges);
            console.log(diffSummary);

            saveDiffReport(diff, breakingChanges, snapshotKey);
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
// Only run automatically when this file is the process entry point (`node
// sync-figma-components.js`) - not when it's imported, e.g. by a test file
// that just wants the exported pure functions above.

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    main();
}

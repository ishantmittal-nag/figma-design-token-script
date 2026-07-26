import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ==================================================
// Load Configuration
// ==================================================

let config;

try {
    const configPath = path.join(
        process.cwd(),
        "config.json"
    );
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

const OUTPUT_DIR = config.paths.outputDir;
const SNAPSHOT_DIR = config.paths.snapshotDir;
const LATEST_JSON = config.paths.latestJsonFile;
const LATEST_CSS_DIR = config.paths.latestCssDir;

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
// Utility Functions
// ==================================================

function toKebabCase(value) {
    return value
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-zA-Z0-9/-]/g, "")
        .replace(/\/+/g, "-")
        .toLowerCase();
}

function getFormattedTimestamp() {
    return new Date()
        .toISOString()
        .split(".")[0]
        .replace(/:/g, "-");
}

// ==================================================
// Fetch Figma File Version
// ==================================================

async function getFigmaFileVersion() {
    const url = `${API_BASE_URL}/files/${FIGMA_FILE_KEY}`;

    console.log("Fetching Figma file metadata...");

    try {
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
        const version = data?.version || "unknown";
        const name = data?.name || "unknown";

        console.log(
            `File: ${name}`
        );
        console.log(
            `Version: ${version}`
        );

        return version;
    } catch (error) {
        console.error(
            "Failed to fetch file version:",
            error.message
        );
        throw error;
    }
}

// ==================================================
// Convert Figma Color to CSS
// ==================================================

function figmaColorToCSS(color) {
    if (!color || typeof color !== "object") {
        return "transparent";
    }

    const r = Math.round((color.r ?? 0) * 255);
    const g = Math.round((color.g ?? 0) * 255);
    const b = Math.round((color.b ?? 0) * 255);
    const a = color.a ?? 1;

    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ==================================================
// Convert Figma Variable Value to CSS
// ==================================================

function convertValue(value, resolvedType) {
    // COLOR
    if (resolvedType === "COLOR") {
        return figmaColorToCSS(value);
    }

    // FLOAT
    if (resolvedType === "FLOAT") {
        if (typeof value === "number") {
            return `${value}px`;
        }
        return value;
    }

    // STRING
    if (resolvedType === "STRING") {
        return `"${value}"`;
    }

    // BOOLEAN
    if (resolvedType === "BOOLEAN") {
        return value ? "true" : "false";
    }

    // Fallback
    return String(value);
}

// ==================================================
// Determine CSS Category
// ==================================================

function getCategory(variable) {
    const name = variable.name.toLowerCase();

    // Colors
    if (
        name.startsWith("color/") ||
        name.startsWith("colors/") ||
        name.includes("color")
    ) {
        return "colors";
    }

    // Spacing
    if (
        name.startsWith("spacing/") ||
        name.startsWith("space/") ||
        name.includes("spacing")
    ) {
        return "spacing";
    }

    // Radius
    if (
        name.startsWith("radius/") ||
        name.startsWith("border-radius/") ||
        name.includes("radius")
    ) {
        return "radius";
    }

    // Typography
    if (
        name.startsWith("font/") ||
        name.startsWith("font-size/") ||
        name.startsWith("typography/") ||
        name.includes("font")
    ) {
        return "typography";
    }

    // Shadows
    if (
        name.startsWith("shadow/") ||
        name.startsWith("elevation/") ||
        name.includes("shadow")
    ) {
        return "shadows";
    }

    // Everything else
    return "other";
}

// ==================================================
// Fetch Figma Variables
// ==================================================

async function getLocalVariables() {
    const url = `${API_BASE_URL}/files/${FIGMA_FILE_KEY}/variables/local`;

    console.log("Fetching Figma variables...");

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

    return await response.json();
}

// ==================================================
// Save JSON Snapshots with Versioning
// ==================================================

function saveJSONSnapshots(variables, variableCollections, figmaVersion) {
    // Create directories
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const timestamp = getFormattedTimestamp();
    const snapshotKey = `${timestamp}_${figmaVersion}`;

    // JSON content
    const jsonData = {
        fileKey: FIGMA_FILE_KEY,
        figmaVersion: figmaVersion,
        snapshotKey: snapshotKey,
        fetchedAt: new Date().toISOString(),
        variables,
        variableCollections
    };

    const formattedJSON = JSON.stringify(jsonData, null, 2);

    // Save latest JSON
    fs.writeFileSync(LATEST_JSON, formattedJSON, "utf-8");
    console.log("Updated tokens/variables-latest.json");

    // Save timestamped + versioned snapshot
    const snapshotPath = path.join(
        SNAPSHOT_DIR,
        `variables-${snapshotKey}.json`
    );

    fs.writeFileSync(snapshotPath, formattedJSON, "utf-8");
    console.log(`Created snapshot: ${snapshotPath}`);

    return snapshotKey;
}

// ==================================================
// Generate CSS File
// ==================================================

function generateCSSFile(variables, fileName) {
    let css = `/* =========================================
   ${fileName.toUpperCase()}
   Generated from Figma Variables
   ========================================= */

`;

    // Group variables by mode
    const modes = {};

    for (const variable of variables) {
        if (!modes[variable.modeName]) {
            modes[variable.modeName] = [];
        }
        modes[variable.modeName].push(variable);
    }

    // Generate CSS per mode
    for (const [modeName, modeVariables] of Object.entries(modes)) {
        const normalizedMode = modeName
            .toLowerCase()
            .replace(/\s+/g, "-");

        // Default / Light mode
        if (normalizedMode === "default" || normalizedMode === "light") {
            css += `:root {\n`;
        } else {
            css += `\n[data-theme="${normalizedMode}"] {\n`;
        }

        for (const variable of modeVariables) {
            css += `  ${variable.cssName}: ${variable.cssValue};\n`;
        }

        css += `}\n`;
    }

    // Write CSS file
    const filePath = path.join(OUTPUT_DIR, `${fileName}.css`);

    fs.writeFileSync(filePath, css, "utf-8");
    console.log(`Updated ${filePath}`);
}

// ==================================================
// Generate CSS Tokens
// ==================================================

function generateCSSTokens(variables, variableCollections) {
    // CSS categories
    const cssFiles = {
        colors: [],
        spacing: [],
        radius: [],
        typography: [],
        shadows: [],
        other: []
    };

    // Process each Figma variable
    for (const variable of Object.values(variables)) {
        const category = getCategory(variable);

        // Find variable collection
        const collection = variableCollections[variable.variableCollectionId];

        if (!collection) {
            console.warn(
                `Collection not found for ${variable.name}`
            );
            continue;
        }

        // Process modes
        const modes = collection.modes || [];

        for (const mode of modes) {
            const modeId = mode.modeId;
            const modeName = mode.name || "Default";
            const value = variable.valuesByMode?.[modeId];

            if (value === undefined) {
                continue;
            }

            // CSS variable name
            const cssName = `--${toKebabCase(variable.name)}`;

            // CSS variable value
            const cssValue = convertValue(value, variable.resolvedType);

            cssFiles[category].push({
                cssName,
                cssValue,
                modeName
            });
        }
    }

    // Generate individual CSS files
    const generatedFiles = [];

    for (const [category, categoryVariables] of Object.entries(cssFiles)) {
        if (categoryVariables.length === 0) {
            continue;
        }

        generateCSSFile(categoryVariables, category);
        generatedFiles.push(category);
    }

    // Generate index.css
    let indexCSS = `/* =========================================
   FIGMA DESIGN TOKENS
   Generated automatically
   ========================================= */

`;

    for (const file of generatedFiles) {
        indexCSS += `@import "./${file}.css";\n`;
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, "index.css"), indexCSS, "utf-8");
    console.log("Updated tokens/index.css");
}

// ==================================================
// Diff and Breaking Change Detection
// ==================================================

function getLatestTwoSnapshots() {
    const files = fs
        .readdirSync(SNAPSHOT_DIR)
        .filter(f => f.startsWith("variables-") && f.endsWith(".json"))
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

function normalizeTokenName(name) {
    return name
        .toLowerCase()
        .replace(/[\s_-]+/g, "")
        .trim();
}

function variablesEqual(var1, var2) {
    return JSON.stringify(var1) === JSON.stringify(var2);
}

function loadSnapshot(filePath) {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
}

function generateDiffReport(previousSnapshot, currentSnapshot) {
    const previousVars = previousSnapshot.variables || {};
    const currentVars = currentSnapshot.variables || {};

    const added = [];
    const removed = [];
    const modified = [];
    const renamed = [];

    // Build name lookup maps
    const previousNames = {};
    const currentNames = {};

    Object.entries(previousVars).forEach(([id, variable]) => {
        previousNames[id] = variable.name;
    });

    Object.entries(currentVars).forEach(([id, variable]) => {
        currentNames[id] = variable.name;
    });

    // Find removed variables
    for (const [id, variable] of Object.entries(previousVars)) {
        if (!currentVars[id]) {
            removed.push({
                name: variable.name,
                id: id,
                type: variable.resolvedType
            });
        }
    }

    // Find added variables
    for (const [id, variable] of Object.entries(currentVars)) {
        if (!previousVars[id]) {
            added.push({
                name: variable.name,
                id: id,
                type: variable.resolvedType
            });
        }
    }

    // Find renamed variables
    for (const prevId of Object.keys(previousVars)) {
        if (!currentVars[prevId]) {
            const prevName = previousNames[prevId];
            const prevNormalized = normalizeTokenName(prevName);

            for (const currId of Object.keys(currentVars)) {
                if (!previousVars[currId]) {
                    const currName = currentNames[currId];
                    const currNormalized = normalizeTokenName(currName);

                    if (prevNormalized === currNormalized && prevName !== currName) {
                        renamed.push({
                            previousName: prevName,
                            currentName: currName,
                            previousId: prevId,
                            currentId: currId
                        });
                    }
                }
            }
        }
    }

    // Find modified variables
    for (const [id, currentVar] of Object.entries(currentVars)) {
        if (previousVars[id]) {
            const previousVar = previousVars[id];

            // Check if name changed (and not already in renamed list)
            const isRenamed = renamed.some(r => r.previousId === id);
            if (previousVar.name !== currentVar.name && !isRenamed) {
                renamed.push({
                    previousName: previousVar.name,
                    currentName: currentVar.name,
                    previousId: id,
                    currentId: id
                });
            }

            // Check if values changed
            const previousValuesByMode = previousVar.valuesByMode || {};
            const currentValuesByMode = currentVar.valuesByMode || {};

            const modeIds = new Set([
                ...Object.keys(previousValuesByMode),
                ...Object.keys(currentValuesByMode)
            ]);

            let hasValueChange = false;

            for (const modeId of modeIds) {
                const prevValue = previousValuesByMode[modeId];
                const currValue = currentValuesByMode[modeId];

                if (!variablesEqual(prevValue, currValue)) {
                    hasValueChange = true;
                    break;
                }
            }

            // Check if type changed
            const typeChanged = previousVar.resolvedType !== currentVar.resolvedType;

            if (hasValueChange || typeChanged) {
                modified.push({
                    name: currentVar.name,
                    id: id,
                    type: currentVar.resolvedType,
                    previousType: previousVar.resolvedType,
                    typeChanged: typeChanged,
                    reason: typeChanged ? "type_changed" : "value_changed"
                });
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

function detectBreakingChanges(diff) {
    const breakingChanges = [];

    if (diff.removed.length > 0) {
        breakingChanges.push({
            type: "REMOVED_VARIABLES",
            severity: "high",
            count: diff.removed.length,
            items: diff.removed,
            message: `${diff.removed.length} variable(s) removed`
        });
    }

    if (diff.renamed.length > 0) {
        breakingChanges.push({
            type: "RENAMED_VARIABLES",
            severity: "high",
            count: diff.renamed.length,
            items: diff.renamed,
            message: `${diff.renamed.length} variable(s) renamed`
        });
    }

    const typeChanges = diff.modified.filter(m => m.typeChanged);
    if (typeChanges.length > 0) {
        breakingChanges.push({
            type: "TYPE_CHANGED",
            severity: "high",
            count: typeChanges.length,
            items: typeChanges,
            message: `${typeChanges.length} variable(s) had type changed`
        });
    }

    return breakingChanges;
}

function formatDiffSummary(diff, breakingChanges) {
    let summary = "\n📊 TOKEN CHANGES\n";
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
    console.log(`📄 Diff report saved: ${diffPath}`);

    return diffPath;
}

// ==================================================
// Main
// ==================================================

async function main() {
    console.log("\n=========================================");
    console.log("Figma Design Token Sync");
    console.log("=========================================\n");

    try {
        // Fetch Figma file version
        const figmaVersion = await getFigmaFileVersion();

        // Fetch Figma data
        const data = await getLocalVariables();

        const variables = data.meta?.variables || {};
        const variableCollections = data.meta?.variableCollections || {};

        console.log(
            `Found ${Object.keys(variables).length} variables`
        );
        console.log(
            `Found ${Object.keys(variableCollections).length} variable collections`
        );

        // Save JSON files with versioning
        const snapshotKey = saveJSONSnapshots(
            variables,
            variableCollections,
            figmaVersion
        );

        // Generate CSS
        generateCSSTokens(variables, variableCollections);

        // Generate diff report if previous snapshot exists
        let diffSummary = "";
        let breakingChanges = [];

        const snapshots = getLatestTwoSnapshots();
        if (snapshots) {
            const [latestPath, previousPath] = snapshots;
            const latestSnapshot = loadSnapshot(latestPath);
            const previousSnapshot = loadSnapshot(previousPath);

            const diff = generateDiffReport(previousSnapshot, latestSnapshot);
            breakingChanges = detectBreakingChanges(diff);

            diffSummary = formatDiffSummary(diff, breakingChanges);
            console.log(diffSummary);

            saveDiffReport(diff, breakingChanges, snapshotKey);
        } else {
            console.log("\n📝 First run - no previous snapshot to compare");
        }

        console.log("\n=========================================");
        console.log("Figma token sync completed successfully");
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

import fs from "fs";
import path from "path";
import { getCached, setCached } from "./src/utils/tokenCache.js";

// ==================================================
// Load JSON Snapshots
// ==================================================

function loadSnapshot(filePath) {
    try {
        const data = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        console.error(`Failed to load snapshot: ${filePath}`);
        throw error;
    }
}

// ==================================================
// Get Latest Two Snapshots
// ==================================================

function getLatestSnapshots(snapshotDir) {
    const files = fs
        .readdirSync(snapshotDir)
        .filter(f => f.startsWith("variables-") && f.endsWith(".json"))
        .sort()
        .reverse();

    if (files.length < 2) {
        console.error(
            "Need at least 2 snapshots to compare. Found:",
            files.length
        );
        process.exit(1);
    }

    return [
        path.join(snapshotDir, files[0]),  // Latest
        path.join(snapshotDir, files[1])   // Previous
    ];
}

// ==================================================
// Normalize Variable Name (for rename detection)
// ==================================================

function normalizeTokenName(name) {
    return name
        .toLowerCase()
        .replace(/[\s_-]+/g, "")
        .trim();
}

// ==================================================
// Find Renamed Variables
// ==================================================

function findRenamedVariables(previousVars, currentVars, previousNames, currentNames) {
    const renames = [];

    // Variables in previous but not in current (potentially deleted)
    for (const prevId of Object.keys(previousVars)) {
        if (!currentVars[prevId]) {
            const prevName = previousNames[prevId];
            const prevNormalized = normalizeTokenName(prevName);

            // Search for similar normalized names in current
            for (const currId of Object.keys(currentVars)) {
                if (!previousVars[currId]) {
                    const currName = currentNames[currId];
                    const currNormalized = normalizeTokenName(currName);

                    if (prevNormalized === currNormalized && prevName !== currName) {
                        renames.push({
                            previousName: prevName,
                            currentName: currName,
                            previousId: prevId,
                            currentId: currId,
                            similarity: "renamed"
                        });
                    }
                }
            }
        }
    }

    return renames;
}

// ==================================================
// Deep Compare Variable Values
// ==================================================

function variablesEqual(var1, var2) {
    return JSON.stringify(var1) === JSON.stringify(var2);
}

// ==================================================
// Generate Diff Report
// ==================================================

function generateDiff(previousSnapshot, currentSnapshot) {
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

    // Find modified and renamed variables
    renamed.push(
        ...findRenamedVariables(previousVars, currentVars, previousNames, currentNames)
    );

    // Find modified (same ID, different values)
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
                    currentId: id,
                    similarity: "renamed"
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

// ==================================================
// Detect Breaking Changes
// ==================================================

function detectBreakingChanges(diff) {
    const breakingChanges = [];

    // Breaking change 1: Removed variables
    if (diff.removed.length > 0) {
        breakingChanges.push({
            type: "REMOVED_VARIABLES",
            severity: "high",
            count: diff.removed.length,
            items: diff.removed,
            message: `${diff.removed.length} variable(s) removed. Developers using these will get undefined values.`
        });
    }

    // Breaking change 2: Renamed variables (implicit removal + addition)
    if (diff.renamed.length > 0) {
        breakingChanges.push({
            type: "RENAMED_VARIABLES",
            severity: "high",
            count: diff.renamed.length,
            items: diff.renamed,
            message: `${diff.renamed.length} variable(s) renamed. Old names will no longer work in CSS.`
        });
    }

    // Breaking change 3: Type changes
    const typeChanges = diff.modified.filter(m => m.typeChanged);
    if (typeChanges.length > 0) {
        breakingChanges.push({
            type: "TYPE_CHANGED",
            severity: "high",
            count: typeChanges.length,
            items: typeChanges,
            message: `${typeChanges.length} variable(s) had their type changed. This may break type safety.`
        });
    }

    return breakingChanges;
}

// ==================================================
// Format Diff Report for Display
// ==================================================

function formatDiffReport(diff, breakingChanges) {
    let report = "\n========================================= \n";
    report += "DESIGN TOKEN CHANGES\n";
    report += "========================================= \n\n";

    // Summary
    report += "📊 SUMMARY\n";
    report += `  Added:    ${diff.added.length}\n`;
    report += `  Removed:  ${diff.removed.length}\n`;
    report += `  Modified: ${diff.modified.length}\n`;
    report += `  Renamed:  ${diff.renamed.length}\n`;

    // Breaking Changes
    if (breakingChanges.length > 0) {
        report += "\n⚠️  BREAKING CHANGES DETECTED\n";
        report += "========================================= \n";

        for (const change of breakingChanges) {
            report += `\n❌ ${change.type}\n`;
            report += `   Severity: ${change.severity.toUpperCase()}\n`;
            report += `   Count: ${change.count}\n`;
            report += `   Message: ${change.message}\n`;

            if (change.items.length > 0 && change.items.length <= 10) {
                report += "   Items:\n";
                for (const item of change.items) {
                    if (item.name) {
                        report += `     • ${item.name}`;
                        if (item.previousName) {
                            report += ` (was: ${item.previousName})`;
                        }
                        if (item.type) {
                            report += ` [${item.type}]`;
                        }
                        report += "\n";
                    }
                }
            } else if (change.items.length > 10) {
                report += `   Items: ${change.items.length} items (showing first 10)\n`;
                for (let i = 0; i < Math.min(10, change.items.length); i++) {
                    const item = change.items[i];
                    report += `     • ${item.name}`;
                    if (item.previousName) {
                        report += ` (was: ${item.previousName})`;
                    }
                    if (item.type) {
                        report += ` [${item.type}]`;
                    }
                    report += "\n";
                }
                report += `   ... and ${change.items.length - 10} more\n`;
            }
        }
    }

    // Added
    if (diff.added.length > 0) {
        report += "\n✅ ADDED\n";
        for (const item of diff.added.slice(0, 10)) {
            report += `  + ${item.name} [${item.type}]\n`;
        }
        if (diff.added.length > 10) {
            report += `  ... and ${diff.added.length - 10} more\n`;
        }
    }

    // Removed
    if (diff.removed.length > 0) {
        report += "\n❌ REMOVED\n";
        for (const item of diff.removed.slice(0, 10)) {
            report += `  - ${item.name} [${item.type}]\n`;
        }
        if (diff.removed.length > 10) {
            report += `  ... and ${diff.removed.length - 10} more\n`;
        }
    }

    // Modified
    if (diff.modified.length > 0) {
        report += "\n🔄 MODIFIED\n";
        for (const item of diff.modified.slice(0, 10)) {
            report += `  ~ ${item.name} [${item.type}]`;
            if (item.typeChanged) {
                report += ` (type: ${item.previousType} → ${item.type})`;
            }
            report += "\n";
        }
        if (diff.modified.length > 10) {
            report += `  ... and ${diff.modified.length - 10} more\n`;
        }
    }

    // Renamed
    if (diff.renamed.length > 0) {
        report += "\n🔁 RENAMED\n";
        for (const item of diff.renamed.slice(0, 10)) {
            report += `  ${item.previousName} → ${item.currentName}\n`;
        }
        if (diff.renamed.length > 10) {
            report += `  ... and ${diff.renamed.length - 10} more\n`;
        }
    }

    report += "\n========================================= \n";

    return report;
}

// ==================================================
// Export Diff as JSON
// ==================================================

function exportDiffJSON(diff, breakingChanges, outputPath) {
    const diffData = {
        timestamp: new Date().toISOString(),
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

    fs.writeFileSync(outputPath, JSON.stringify(diffData, null, 2), "utf-8");
    console.log(`\n📄 Diff exported to: ${outputPath}`);
}

// ==================================================
// Main
// ==================================================

async function main() {
    const snapshotDir = process.argv[2] || "./tokens/snapshots";
    const outputDiffPath = process.argv[3] || "./tokens/diff-latest.json";

    if (!fs.existsSync(snapshotDir)) {
        console.error(`Snapshot directory not found: ${snapshotDir}`);
        process.exit(1);
    }

    console.log("🔍 Comparing token snapshots...\n");

    try {
        // Get latest two snapshots
        const [latestPath, previousPath] = getLatestSnapshots(snapshotDir);

        const latestSnapshot = getCached("diff", latestPath) || loadSnapshot(latestPath);
        const previousSnapshot = getCached("diff", previousPath) || loadSnapshot(previousPath);

        console.log(`Previous: ${path.basename(previousPath)}`);
        console.log(`Latest:   ${path.basename(latestPath)}\n`);

        // Generate diff
        const diff = generateDiff(previousSnapshot, latestSnapshot);

        // Detect breaking changes
        const breakingChanges = detectBreakingChanges(diff);

        // Format and display report
        const report = formatDiffReport(diff, breakingChanges);
        console.log(report);

        // Export diff as JSON
        exportDiffJSON(diff, breakingChanges, outputDiffPath);

        // Exit with appropriate code
        if (breakingChanges.length > 0) {
            console.error(
                "\n⚠️  BREAKING CHANGES DETECTED - Review before merging"
            );
            process.exit(1);
        } else {
            console.log("\n✅ No breaking changes detected");
            process.exit(0);
        }
    } catch (error) {
        console.error("\n❌ Error during diff:", error.message);
        process.exit(1);
    }
}

main();

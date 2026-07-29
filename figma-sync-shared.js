import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ==================================================
// Fetch Figma File Version
// ==================================================
// Both sync scripts snapshot against the same Figma file, so the "what
// revision was this pulled from" signal is identical for either one - a
// single shared fetch avoids the two copies drifting (e.g. one script
// getting a fix the other doesn't).

export async function getFigmaFileVersion(apiBaseUrl, fileKey, figmaToken) {
    const url = `${apiBaseUrl}/files/${fileKey}`;

    console.log("Fetching Figma file metadata...");

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "X-Figma-Token": figmaToken
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

        console.log(`File: ${name}`);
        console.log(`Version: ${version}`);

        return version;
    } catch (error) {
        console.error("Failed to fetch file version:", error.message);
        throw error;
    }
}

// ==================================================
// Script-relative Paths
// ==================================================
// Resolve everything relative to the *calling* script's own file location
// rather than process.cwd(), so behavior doesn't change based on the
// directory a CI/CD pipeline (or a developer) happens to invoke `node`
// from. Each sync script passes its own `import.meta.url` so paths still
// resolve correctly even though the resolver itself lives in this shared file.

export function makeScriptRelativeResolver(importMetaUrl) {
    const scriptDir = path.dirname(fileURLToPath(importMetaUrl));
    return (relativePath) => path.resolve(scriptDir, relativePath);
}

// ==================================================
// Snapshot Helpers
// ==================================================

export function getFormattedTimestamp() {
    return new Date()
        .toISOString()
        .split(".")[0]
        .replace(/:/g, "-");
}

export function loadSnapshot(filePath) {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
}

export function getLatestTwoSnapshots(snapshotDir, filePrefix) {
    const files = fs
        .readdirSync(snapshotDir)
        .filter(f => f.startsWith(filePrefix) && f.endsWith(".json"))
        .sort()
        .reverse();

    if (files.length < 2) {
        return null; // First run, no previous snapshot to compare
    }

    return [
        path.join(snapshotDir, files[0]),
        path.join(snapshotDir, files[1])
    ];
}

// ==================================================
// Breaking Change Detection
// ==================================================
// Each entry describes one possible category of breaking change as
// { type, items, message(count) }. Only categories with at least one item
// produce an entry, so a caller can list every category it cares about
// without hand-writing a length check + push for each one.

export function detectBreakingChanges(entries) {
    return entries
        .filter(entry => entry.items.length > 0)
        .map(entry => ({
            type: entry.type,
            severity: "high",
            count: entry.items.length,
            items: entry.items,
            message: entry.message(entry.items.length)
        }));
}

// ==================================================
// Diff Summary + Report
// ==================================================

export function formatDiffSummary(diff, breakingChanges, label) {
    let summary = `\n📊 ${label}\n`;
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

export function saveDiffReport(outputDir, diff, breakingChanges, snapshotKey, logLabel) {
    const totalChanges = diff.added.length + diff.removed.length + diff.modified.length + diff.renamed.length;

    const diffData = {
        timestamp: new Date().toISOString(),
        snapshotKey: snapshotKey,
        hasChanges: totalChanges > 0,
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

    const diffPath = path.join(outputDir, "diff-latest.json");
    fs.writeFileSync(diffPath, JSON.stringify(diffData, null, 2), "utf-8");
    console.log(`📄 ${logLabel} saved: ${diffPath}`);

    return diffPath;
}

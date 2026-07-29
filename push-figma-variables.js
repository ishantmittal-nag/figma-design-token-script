import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ==================================================
// Standalone script - deliberately NOT wired into the sync-figma-*.js
// pipeline or its config.json/.env. It targets a *different* Figma file
// (the destination you're pushing into) than the FIGMA_FILE_KEY those
// scripts read from, so file key + token are passed explicitly on the
// command line every run rather than picked up from environment state.
//
// Usage:
//   node push-figma-variables.js --file-key=<target file key> --token=<figma PAT> [--source=path/to/variables.json] [--dry-run]
//
// Requires a Figma PAT with the `file_variables:write` scope.
//
// IMPORTANT: this always CREATEs collections/modes/variables - it has no
// concept of "this variable already exists in the target file, update it
// instead." Running it twice against the same target file duplicates
// everything rather than syncing it. It's meant for seeding/duplicating a
// token library into a new or empty file, not for repeated two-way sync.
// ==================================================

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_BASE_URL = "https://api.figma.com/v1";

// ==================================================
// CLI Arguments
// ==================================================

function parseArgs(argv) {
    const args = { "dry-run": false };
    for (const arg of argv) {
        if (arg === "--dry-run") {
            args["dry-run"] = true;
            continue;
        }
        const match = arg.match(/^--([^=]+)=(.*)$/);
        if (match) {
            args[match[1]] = match[2];
        }
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));

const FIGMA_FILE_KEY = args["file-key"];
const FIGMA_TOKEN = args["token"];
const DRY_RUN = args["dry-run"];
const SOURCE_PATH = args["source"]
    ? path.resolve(process.cwd(), args["source"])
    : path.resolve(SCRIPT_DIR, "tokens/variables-latest.json");

if (!FIGMA_FILE_KEY || !FIGMA_TOKEN) {
    console.error(
        "Usage: node push-figma-variables.js --file-key=<target file key> --token=<figma PAT> [--source=path/to/variables.json] [--dry-run]"
    );
    process.exit(1);
}

// ==================================================
// Load Source Variables
// ==================================================

// A collection/variable with `remote: true` is one this file merely
// *consumes* from another team library, not one it owns - Figma's file-level
// snapshot includes them so the file's variables are fully resolvable, but
// recreating them as new local collections here wouldn't reproduce a shared
// library link, just a disconnected, orphaned copy. Only `remote: false`
// (locally-owned) entries are pushed by default.
function loadSourceVariables() {
    if (!fs.existsSync(SOURCE_PATH)) {
        console.error(`Source variables file not found: ${SOURCE_PATH}`);
        console.error("Run sync-figma-tokens.js first to generate it, or pass --source explicitly.");
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf-8"));
    const allCollections = data.variableCollections || {};
    const allVariables = data.variables || {};

    const includeRemote = args["include-remote"];

    const variableCollections = includeRemote
        ? allCollections
        : Object.fromEntries(Object.entries(allCollections).filter(([, c]) => !c.remote));

    const variables = includeRemote
        ? allVariables
        : Object.fromEntries(Object.entries(allVariables).filter(([, v]) => !v.remote));

    const skippedCollections = Object.keys(allCollections).length - Object.keys(variableCollections).length;
    const skippedVariables = Object.keys(allVariables).length - Object.keys(variables).length;

    if (!includeRemote && (skippedCollections > 0 || skippedVariables > 0)) {
        console.log(
            `Skipping ${skippedCollections} remote collection(s) and ${skippedVariables} remote variable(s) ` +
            "consumed from other libraries (pass --include-remote to push disconnected copies of them too)\n"
        );
    }

    return { variables, variableCollections };
}

// ==================================================
// Figma API Helper
// ==================================================

async function figmaRequest(method, urlPath, body) {
    const response = await fetch(`${API_BASE_URL}${urlPath}`, {
        method,
        headers: {
            "X-Figma-Token": FIGMA_TOKEN,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            `Figma API request failed: ${response.status}\n${JSON.stringify(responseBody, null, 2)}`
        );
    }

    return responseBody;
}

// ==================================================
// Temp ID Helpers
// ==================================================
// Figma's write API lets a CREATE action supply its own "temporary" id,
// which later entries in the *same* request (or, for collections, a
// follow-up request once we know the real id) can reference before the
// real id exists. Prefixing by kind keeps them unique and readable.

const tempCollectionId = sourceId => `coll_${sourceId}`;
const tempModeId = sourceId => `mode_${sourceId}`;
const tempVariableId = sourceId => `var_${sourceId}`;

// ==================================================
// Payload Builders (pure - no network calls)
// ==================================================

function buildCollectionsPayload(variableCollections) {
    return Object.entries(variableCollections).map(([sourceId, collection]) => ({
        action: "CREATE",
        id: tempCollectionId(sourceId),
        name: collection.name
    }));
}

// A newly-created collection always comes with exactly one Figma-generated
// mode already attached - there is no way to create a collection with zero
// modes. So the source's first mode is represented by renaming that
// auto-created mode (action: UPDATE) rather than creating a duplicate;
// only modes beyond the first are genuinely new (action: CREATE).
function buildModesPayload(variableCollections, realCollectionIds, defaultModeIds) {
    const modes = [];

    for (const [sourceCollectionId, collection] of Object.entries(variableCollections)) {
        const realCollectionId = realCollectionIds[sourceCollectionId];
        const collectionModes = collection.modes || [];

        collectionModes.forEach((mode, index) => {
            if (index === 0) {
                const defaultModeId = defaultModeIds[realCollectionId];
                if (defaultModeId) {
                    modes.push({
                        action: "UPDATE",
                        id: defaultModeId,
                        name: mode.name,
                        variableCollectionId: realCollectionId
                    });
                }
            } else {
                modes.push({
                    action: "CREATE",
                    id: tempModeId(mode.modeId),
                    name: mode.name,
                    variableCollectionId: realCollectionId
                });
            }
        });
    }

    return modes;
}

function buildVariablesPayload(variables, realCollectionIds) {
    const payload = [];

    for (const [sourceVariableId, variable] of Object.entries(variables)) {
        const realCollectionId = realCollectionIds[variable.variableCollectionId];

        if (!realCollectionId) {
            console.warn(`Skipping "${variable.name}" - its collection wasn't found in the source snapshot`);
            continue;
        }

        payload.push({
            action: "CREATE",
            id: tempVariableId(sourceVariableId),
            name: variable.name,
            variableCollectionId: realCollectionId,
            resolvedType: variable.resolvedType
        });
    }

    return payload;
}

function modeReference(sourceCollectionId, sourceModeId, variableCollections, realCollectionIds, defaultModeIds) {
    const collection = variableCollections[sourceCollectionId];
    const modeIndex = (collection?.modes || []).findIndex(m => m.modeId === sourceModeId);

    if (modeIndex === 0) {
        return defaultModeIds[realCollectionIds[sourceCollectionId]];
    }

    return tempModeId(sourceModeId);
}

// A value can itself be a reference to another variable rather than a
// literal - that alias's target id belongs to the *source* file, which
// means nothing in the target file, so it has to be remapped to the
// corresponding variable's temp id here instead.
function resolveValueForTarget(value, variables) {
    if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
        if (!variables[value.id]) {
            console.warn(`Skipping alias to unknown source variable: ${value.id}`);
            return undefined;
        }
        return { type: "VARIABLE_ALIAS", id: tempVariableId(value.id) };
    }
    return value;
}

function buildModeValuesPayload(variables, variableCollections, realCollectionIds, defaultModeIds) {
    const modeValues = [];

    for (const [sourceVariableId, variable] of Object.entries(variables)) {
        const sourceCollectionId = variable.variableCollectionId;
        const valuesByMode = variable.valuesByMode || {};

        for (const [sourceModeId, rawValue] of Object.entries(valuesByMode)) {
            const value = resolveValueForTarget(rawValue, variables);
            if (value === undefined) {
                continue;
            }

            modeValues.push({
                variableId: tempVariableId(sourceVariableId),
                modeId: modeReference(sourceCollectionId, sourceModeId, variableCollections, realCollectionIds, defaultModeIds),
                value
            });
        }
    }

    return modeValues;
}

// ==================================================
// Main
// ==================================================

async function main() {
    console.log("\n=========================================");
    console.log("Push Variables to Figma");
    console.log("=========================================\n");
    console.log(`Target file: ${FIGMA_FILE_KEY}`);
    console.log(`Source:      ${SOURCE_PATH}`);
    if (DRY_RUN) {
        console.log("Mode:        DRY RUN (no requests will be sent)");
    }
    console.log(
        "\n⚠️  This always CREATEs new collections/variables. Running it twice\n" +
        "   against the same target file duplicates everything rather than\n" +
        "   updating it - only run it against a file you intend to (re)seed.\n"
    );

    try {
        const { variables, variableCollections } = loadSourceVariables();

        console.log(
            `Loaded ${Object.keys(variableCollections).length} collection(s), ${Object.keys(variables).length} variable(s)\n`
        );

        if (Object.keys(variableCollections).length === 0) {
            console.log("Nothing to push - source has no variable collections.");
            return;
        }

        const collectionsPayload = buildCollectionsPayload(variableCollections);

        let realCollectionIds;
        let defaultModeIds;

        if (DRY_RUN) {
            // Stand in for real IDs so the rest of the payload can still be
            // previewed in full, without actually creating anything.
            realCollectionIds = {};
            for (const sourceId of Object.keys(variableCollections)) {
                realCollectionIds[sourceId] = tempCollectionId(sourceId);
            }
            defaultModeIds = {};
            for (const realId of Object.values(realCollectionIds)) {
                defaultModeIds[realId] = `<auto-default-mode:${realId}>`;
            }
        } else {
            console.log(`Creating ${collectionsPayload.length} variable collection(s)...`);
            const collectionsResponse = await figmaRequest("POST", `/files/${FIGMA_FILE_KEY}/variables`, {
                variableCollections: collectionsPayload
            });

            const tempIdToRealId = collectionsResponse?.meta?.tempIdToRealId || {};
            realCollectionIds = {};
            for (const sourceId of Object.keys(variableCollections)) {
                realCollectionIds[sourceId] = tempIdToRealId[tempCollectionId(sourceId)];
            }

            console.log("Fetching auto-created default modes...");
            const localData = await figmaRequest("GET", `/files/${FIGMA_FILE_KEY}/variables/local`);
            const remoteCollections = localData?.meta?.variableCollections || {};

            defaultModeIds = {};
            for (const realId of Object.values(realCollectionIds)) {
                defaultModeIds[realId] = remoteCollections[realId]?.modes?.[0]?.modeId || null;
            }
        }

        const modesPayload = buildModesPayload(variableCollections, realCollectionIds, defaultModeIds);
        const variablesPayload = buildVariablesPayload(variables, realCollectionIds);
        const modeValuesPayload = buildModeValuesPayload(variables, variableCollections, realCollectionIds, defaultModeIds);

        if (DRY_RUN) {
            console.log("--- variableCollections ---");
            console.log(JSON.stringify(collectionsPayload, null, 2));
            console.log("\n--- variableModes ---");
            console.log(JSON.stringify(modesPayload, null, 2));
            console.log("\n--- variables ---");
            console.log(JSON.stringify(variablesPayload, null, 2));
            console.log("\n--- variableModeValues ---");
            console.log(JSON.stringify(modeValuesPayload, null, 2));
            console.log("\nDry run complete - no requests were sent.");
            return;
        }

        console.log(
            `Creating ${modesPayload.length} additional mode(s), ${variablesPayload.length} variable(s), ${modeValuesPayload.length} value(s)...`
        );

        await figmaRequest("POST", `/files/${FIGMA_FILE_KEY}/variables`, {
            variableModes: modesPayload,
            variables: variablesPayload,
            variableModeValues: modeValuesPayload
        });

        console.log("\n=========================================");
        console.log("Push completed successfully");
        console.log("=========================================\n");
    } catch (error) {
        console.error("\nError:", error.message);
        process.exit(1);
    }
}

main();


import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ==================================================
// Configuration
// ==================================================

const FIGMA_TOKEN = process.env.FIGMA_TOKEN?.trim();
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY?.trim();

const OUTPUT_DIR = "./tokens";
const SNAPSHOT_DIR = "./tokens/snapshots";
const LATEST_JSON = "./tokens/variables-latest.json";

// ==================================================
// Validate Environment
// ==================================================

if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) {
    console.error(
        "Missing FIGMA_TOKEN or FIGMA_FILE_KEY in .env"
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

    const name =
        variable.name.toLowerCase();

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

    const url =
        `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/variables/local`;

    console.log(
        "Fetching Figma variables..."
    );

    const response =
        await fetch(
            url,
            {
                method: "GET",

                headers: {
                    "X-Figma-Token":
                        FIGMA_TOKEN
                }
            }
        );

    if (!response.ok) {

        const errorText =
            await response.text();

        throw new Error(
            `Figma API request failed: ${response.status}\n${errorText}`
        );
    }

    return await response.json();
}


// ==================================================
// Save JSON Snapshot
// ==================================================

function saveJSONSnapshots(
    variables,
    variableCollections
) {

    // Create directories
    fs.mkdirSync(
        OUTPUT_DIR,
        {
            recursive: true
        }
    );

    fs.mkdirSync(
        SNAPSHOT_DIR,
        {
            recursive: true
        }
    );


    // ----------------------------------------------
    // JSON content
    // ----------------------------------------------

    const jsonData = {

        fileKey:
            FIGMA_FILE_KEY,

        fetchedAt:
            new Date().toISOString(),

        variables,

        variableCollections

    };


    const formattedJSON =
        JSON.stringify(
            jsonData,
            null,
            2
        );


    // ----------------------------------------------
    // Save latest JSON
    // ----------------------------------------------

    fs.writeFileSync(

        LATEST_JSON,

        formattedJSON,

        "utf-8"
    );

    console.log(
        "Updated tokens/variables-latest.json"
    );


    // ----------------------------------------------
    // Save timestamped snapshot
    // ----------------------------------------------

    const timestamp =
        new Date()
            .toISOString()
            .replace(/:/g, "-")
            .replace(/\..+/, "");


    const snapshotPath =
        path.join(
            SNAPSHOT_DIR,
            `variables-${timestamp}.json`
        );


    fs.writeFileSync(

        snapshotPath,

        formattedJSON,

        "utf-8"
    );


    console.log(
        `Created snapshot: ${snapshotPath}`
    );
}


// ==================================================
// Generate CSS File
// ==================================================

function generateCSSFile(
    variables,
    fileName
) {

    let css =
`/* =========================================
   ${fileName.toUpperCase()}
   Generated from Figma Variables
   ========================================= */

`;


    // ----------------------------------------------
    // Group variables by mode
    // ----------------------------------------------

    const modes = {};


    for (
        const variable
        of variables
    ) {

        if (
            !modes[variable.modeName]
        ) {

            modes[
                variable.modeName
            ] = [];

        }


        modes[
            variable.modeName
        ].push(variable);
    }


    // ----------------------------------------------
    // Generate CSS per mode
    // ----------------------------------------------

    for (
        const [
            modeName,
            modeVariables
        ]
        of Object.entries(modes)
    ) {

        const normalizedMode =
            modeName
                .toLowerCase()
                .replace(
                    /\s+/g,
                    "-"
                );


        // Default / Light mode
        if (
            normalizedMode === "default" ||
            normalizedMode === "light"
        ) {

            css +=
                `:root {\n`;

        } else {

            css +=
                `\n[data-theme="${normalizedMode}"] {\n`;
        }


        for (
            const variable
            of modeVariables
        ) {

            css +=
                `  ${variable.cssName}: ${variable.cssValue};\n`;
        }


        css +=
            `}\n`;
    }


    // ----------------------------------------------
    // Write CSS file
    // ----------------------------------------------

    const filePath =
        path.join(
            OUTPUT_DIR,
            `${fileName}.css`
        );


    fs.writeFileSync(

        filePath,

        css,

        "utf-8"
    );


    console.log(
        `Updated ${filePath}`
    );
}


// ==================================================
// Generate CSS Tokens
// ==================================================

function generateCSSTokens(
    variables,
    variableCollections
) {

    // ----------------------------------------------
    // CSS categories
    // ----------------------------------------------

    const cssFiles = {

        colors: [],

        spacing: [],

        radius: [],

        typography: [],

        shadows: [],

        other: []

    };


    // ----------------------------------------------
    // Process each Figma variable
    // ----------------------------------------------

    for (
        const variable
        of Object.values(
            variables
        )
    ) {

        const category =
            getCategory(
                variable
            );


        // ------------------------------------------
        // Find variable collection
        // ------------------------------------------

        const collection =
            variableCollections[
                variable.variableCollectionId
            ];


        if (!collection) {

            console.warn(
                `Collection not found for ${variable.name}`
            );

            continue;
        }


        // ------------------------------------------
        // Process modes
        // ------------------------------------------

        const modes =
            collection.modes || [];


        for (
            const mode
            of modes
        ) {

            const modeId =
                mode.modeId;


            const modeName =
                mode.name ||
                "Default";


            const value =
                variable.valuesByMode?.[
                    modeId
                ];


            if (
                value === undefined
            ) {

                continue;
            }


            // --------------------------------------
            // CSS variable name
            // --------------------------------------

            const cssName =
                `--${toKebabCase(
                    variable.name
                )}`;


            // --------------------------------------
            // CSS variable value
            // --------------------------------------

            const cssValue =
                convertValue(
                    value,
                    variable.resolvedType
                );


            cssFiles[
                category
            ].push({

                cssName,

                cssValue,

                modeName

            });
        }
    }


    // ----------------------------------------------
    // Generate individual CSS files
    // ----------------------------------------------

    const generatedFiles = [];


    for (
        const [
            category,
            categoryVariables
        ]
        of Object.entries(
            cssFiles
        )
    ) {

        if (
            categoryVariables.length === 0
        ) {

            continue;
        }


        generateCSSFile(

            categoryVariables,

            category

        );


        generatedFiles.push(
            category
        );
    }


    // ----------------------------------------------
    // Generate index.css
    // ----------------------------------------------

    let indexCSS =
`/* =========================================
   FIGMA DESIGN TOKENS
   Generated automatically
   ========================================= */

`;


    for (
        const file
        of generatedFiles
    ) {

        indexCSS +=
            `@import "./${file}.css";\n`;
    }


    fs.writeFileSync(

        path.join(
            OUTPUT_DIR,
            "index.css"
        ),

        indexCSS,

        "utf-8"
    );


    console.log(
        "Updated tokens/index.css"
    );
}


// ==================================================
// Main
// ==================================================

async function main() {

    console.log(
        "\n========================================="
    );

    console.log(
        "Figma Design Token Sync"
    );

    console.log(
        "=========================================\n"
    );


    // ----------------------------------------------
    // Fetch Figma data
    // ----------------------------------------------

    const data =
        await getLocalVariables();


    const variables =
        data.meta?.variables ||
        {};


    const variableCollections =
        data.meta?.variableCollections ||
        {};


    console.log(
        `Found ${
            Object.keys(
                variables
            ).length
        } variables`
    );


    console.log(
        `Found ${
            Object.keys(
                variableCollections
            ).length
        } variable collections`
    );


    // ----------------------------------------------
    // Save JSON files
    // ----------------------------------------------

    saveJSONSnapshots(

        variables,

        variableCollections

    );


    // ----------------------------------------------
    // Generate CSS
    // ----------------------------------------------

    generateCSSTokens(

        variables,

        variableCollections

    );


    console.log(
        "\n========================================="
    );

    console.log(
        "Figma token sync completed successfully"
    );

    console.log(
        "=========================================\n"
    );
}


// ==================================================
// Execute
// ==================================================

main().catch(
    error => {

        console.error(
            "\nError:",
            error.message
        );

        process.exit(1);
    }
);


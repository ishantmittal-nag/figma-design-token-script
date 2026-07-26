import fs from "fs";
import path from "path";

const INPUT_FILE = "./variables.json";
const OUTPUT_DIR = "./tokens";

// --------------------------------------------------
// Utility Functions
// --------------------------------------------------

function toKebabCase(value) {
    return value
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-zA-Z0-9/-]/g, "")
        .replace(/\/+/g, "-")
        .toLowerCase();
}


// Convert Figma color object to CSS rgba()
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


// Convert Figma variable value to CSS
function convertValue(
    value,
    resolvedType,
    variables
) {

    // ------------------------------------------
    // Figma Variable Alias
    // ------------------------------------------

    if (
        value &&
        typeof value === "object" &&
        value.type === "VARIABLE_ALIAS"
    ) {

        const referencedVariable =
            variables[value.id];

        if (!referencedVariable) {

            console.warn(
                `Referenced variable not found: ${value.id}`
            );

            return "initial";
        }

        const referencedCSSName =
            `--${toKebabCase(
                referencedVariable.name
            )}`;

        return `var(${referencedCSSName})`;
    }


    // ------------------------------------------
    // COLOR
    // ------------------------------------------

    if (resolvedType === "COLOR") {

        return figmaColorToCSS(
            value
        );
    }


    // ------------------------------------------
    // FLOAT
    // ------------------------------------------

    if (resolvedType === "FLOAT") {

        if (
            typeof value === "number"
        ) {

            return `${value}px`;
        }

        return value;
    }


    // ------------------------------------------
    // STRING
    // ------------------------------------------

    if (resolvedType === "STRING") {

        return `"${value}"`;
    }


    // ------------------------------------------
    // BOOLEAN
    // ------------------------------------------

    if (resolvedType === "BOOLEAN") {

        return value
            ? "true"
            : "false";
    }


    // ------------------------------------------
    // FALLBACK
    // ------------------------------------------

    return String(value);
}

// --------------------------------------------------
// Determine CSS File
// --------------------------------------------------

function getCategory(variable) {

    const name = variable.name.toLowerCase();

    // Explicit naming conventions
    if (
        name.startsWith("color/") ||
        name.startsWith("colors/") ||
        name.includes("color")
    ) {
        return "colors";
    }

    if (
        name.startsWith("spacing/") ||
        name.startsWith("space/") ||
        name.includes("spacing")
    ) {
        return "spacing";
    }

    if (
        name.startsWith("radius/") ||
        name.startsWith("border-radius/") ||
        name.includes("radius")
    ) {
        return "radius";
    }

    if (
        name.startsWith("font/") ||
        name.startsWith("font-size/") ||
        name.startsWith("typography/") ||
        name.includes("font")
    ) {
        return "typography";
    }

    if (
        name.startsWith("shadow/") ||
        name.startsWith("elevation/") ||
        name.includes("shadow")
    ) {
        return "shadows";
    }

    // Fallback
    return "other";
}


// --------------------------------------------------
// Create Output Directory
// --------------------------------------------------

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, {
        recursive: true
    });
}


// --------------------------------------------------
// Read Variables JSON
// --------------------------------------------------

if (!fs.existsSync(INPUT_FILE)) {
    console.error(
        `Could not find ${INPUT_FILE}`
    );

    process.exit(1);
}

const data = JSON.parse(
    fs.readFileSync(INPUT_FILE, "utf-8")
);

const variables = data.variables || {};
const collections = data.variableCollections || {};


// --------------------------------------------------
// Store CSS Variables
// --------------------------------------------------

const cssFiles = {
    colors: [],
    spacing: [],
    radius: [],
    typography: [],
    shadows: [],
    other: []
};


// --------------------------------------------------
// Process Variables
// --------------------------------------------------

for (const variable of Object.values(variables)) {

    const category = getCategory(variable);

    const collection =
        collections[variable.variableCollectionId];

    if (!collection) {
        console.warn(
            `Collection not found for ${variable.name}`
        );

        continue;
    }

    const modes = collection.modes || [];

    for (const mode of modes) {

        const modeId = mode.modeId;

        const modeName =
            mode.name || "Default";

        const value =
            variable.valuesByMode?.[modeId];

        if (value === undefined) {
            continue;
        }

        const cssName =
            `--${toKebabCase(variable.name)}`;

        const cssValue =
    convertValue(
        value,
        variable.resolvedType,
        variables
    );

        cssFiles[category].push({
            cssName,
            cssValue,
            modeName
        });
    }
}


// --------------------------------------------------
// Generate CSS File
// --------------------------------------------------

function generateCSSFile(
    variables,
    fileName
) {

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

        modes[variable.modeName].push(
            variable
        );
    }


    // Generate CSS for each mode
    for (const [modeName, modeVariables] of Object.entries(modes)) {

        const normalizedMode =
            modeName
                .toLowerCase()
                .replace(/\s+/g, "-");


        // Default / Light mode
        if (
            normalizedMode === "default" ||
            normalizedMode === "light"
        ) {

            css += `:root {\n`;

        } else {

            css += `\n[data-theme="${normalizedMode}"] {\n`;

        }


        for (const variable of modeVariables) {

            css += `  ${variable.cssName}: ${variable.cssValue};\n`;

        }

        css += `}\n`;
    }

    fs.writeFileSync(
        path.join(
            OUTPUT_DIR,
            `${fileName}.css`
        ),
        css,
        "utf-8"
    );

    console.log(
        `Generated ${fileName}.css`
    );
}


// --------------------------------------------------
// Generate Individual CSS Files
// --------------------------------------------------

for (const [category, variables] of Object.entries(cssFiles)) {

    if (variables.length === 0) {
        continue;
    }

    generateCSSFile(
        variables,
        category
    );
}


// --------------------------------------------------
// Generate index.css
// --------------------------------------------------

const generatedFiles =
    Object.keys(cssFiles)
        .filter(
            category =>
                cssFiles[category].length > 0
        );

let indexCSS =
`/* =========================================
   FIGMA DESIGN TOKENS
   Generated automatically
   ========================================= */

`;

for (const file of generatedFiles) {

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
    "\nGenerated tokens/index.css"
);

console.log(
    `\nTotal variables processed: ${
        Object.keys(variables).length
    }`
);
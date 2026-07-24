import fs from "fs";

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY;

if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) {
    console.error(
        "Missing FIGMA_TOKEN or FIGMA_FILE_KEY in environment"
    );
    process.exit(1);
}

async function getLocalVariables() {
    const url =
        `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}/variables/local`;

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

async function main() {
    console.log("Fetching Figma variables...");

    const data = await getLocalVariables();

    const variables = data.meta?.variables || {};
    const variableCollections =
        data.meta?.variableCollections || {};

    const output = {
        fileKey: FIGMA_FILE_KEY,
        variables,
        variableCollections
    };

    fs.writeFileSync(
        "variables.json",
        JSON.stringify(output, null, 2),
        "utf-8"
    );

    console.log(
        `Found ${Object.keys(variables).length} variables`
    );

    console.log(
        `Found ${Object.keys(variableCollections).length} variable collections`
    );

    console.log(
        "Variables written to variables.json"
    );
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
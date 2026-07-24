import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY;

if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) {
    console.error(
        "Missing FIGMA_TOKEN or FIGMA_FILE_KEY in .env"
    );
    process.exit(1);
}

async function getFigmaFile() {
    const url = `https://api.figma.com/v1/files/${FIGMA_FILE_KEY}`;

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

function findComponents(node, components = []) {
    if (!node) {
        return components;
    }

    // Check if current node is a component
    if (node.type === "COMPONENT") {
        components.push({
            id: node.id,
            name: node.name,
            type: node.type,
            description: node.description || null,
            absoluteBoundingBox: node.absoluteBoundingBox || null,
            size: {
                width: node.size?.x || null,
                height: node.size?.y || null
            },
            fills: node.fills || [],
            strokes: node.strokes || [],
            effects: node.effects || [],
            children: node.children || []
        });
    }

    // Recursively inspect children
    if (node.children) {
        for (const child of node.children) {
            findComponents(child, components);
        }
    }

    return components;
}

async function main() {
    console.log("Fetching Figma file...");

    const figmaFile = await getFigmaFile();

    console.log(`File: ${figmaFile.name}`);

    const components = findComponents(figmaFile.document);

    console.log(`Found ${components.length} components`);

    fs.writeFileSync(
        "components.json",
        JSON.stringify(components, null, 2),
        "utf-8"
    );

    console.log("Components written to components.json");
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
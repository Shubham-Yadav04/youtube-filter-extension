console.log("[ML Worker] Started");
import { pipeline, env } from "@xenova/transformers";

console.log("[ML Worker] Transformers imported");
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MODEL_VERSION = "minilm-l6-v2";

/**
 * Keep model files in the browser cache.
 */
env.useBrowserCache = true;
env.allowLocalModels = false;

let extractorPromise = null;

/**
 * Load and cache the embedding model.
 */

async function getExtractor() {
    if (!extractorPromise) {
        console.log("[ML Worker] loading model", MODEL_ID);

        extractorPromise = pipeline(
            "feature-extraction",
            MODEL_ID
        ).then(extractor => {
            console.log("[ML Worker] model loaded");
            return extractor;
        }).catch(error => {
            console.error("[ML Worker] Model loading failed:", error);
            extractorPromise = null;
            throw error;
        });
    }

    return extractorPromise;
}

/**
 * Generate an embedding for the provided text.
 */
async function generateEmbedding(text) {
    if (!text || !text.trim()) {
        throw new Error("Text is required for embedding");
    }

    const extractor = await getExtractor();

    const output = await extractor(
        text,
        {
            pooling: "mean",
            normalize: true
        }
    );

    return Array.from(output.data);
}

/**
 * Handle embedding requests from classifier.js.
 */
self.onmessage = async event => {
    const {
        type,
        requestId,
        text
    } = event.data;

    if (type !== "EMBED") {
        return;
    }

    console.log("[ML Worker] received EMBED", { requestId });

    try {
        const embedding =
            await generateEmbedding(text);

        console.log("[ML Worker] embedding generated", {
            requestId,
            dimensions: embedding.length
        });
        self.postMessage({
            requestId,
            embedding,
            modelVersion: MODEL_VERSION
        });
    } catch (error) {
        self.postMessage({
            requestId,
            error:
                error instanceof Error
                    ? error.message
                    : String(error)
        });
    }
};

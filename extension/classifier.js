/* eslint-disable no-undef */

import {
    getPolicyEmbedding,
    savePolicyEmbedding,
    getVideoEmbedding,
    saveVideoEmbedding
} from "./db.js";

const EMBEDDING_TIMEOUT = 120_000;
const MODEL_VERSION = "minilm-l6-v2";

const DECISIONS = {
    ALLOWED: "ALLOWED",
    BLOCKED: "BLOCKED"
};

const DEFAULT_THRESHOLD = 0.20;

let offscreenReady = false;
let offscreenCreationPromise = null;
let requestId = 0;

async function ensureOffscreenDocument() {
    console.log("[Classifier] ensureOffscreenDocument called");
    if (offscreenReady) {
        console.log("[Classifier] offscreen already ready");
        return;
    }
    if (offscreenCreationPromise) {
         console.log("[Classifier] waiting for existing creation");
        await offscreenCreationPromise;
        return;
    }

    offscreenCreationPromise = (async () => {
         console.log("[Classifier] checking offscreen contexts");
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
            documentUrls: [
                chrome.runtime.getURL("./offscreen.html")
            ]
        });
 console.log("[Classifier] offscreen contexts:", contexts.length);
        if (contexts.length === 0) {
            console.log("[Classifier] creating offscreen document");
            await chrome.offscreen.createDocument({
                url: "./offscreen.html",
                reasons: ["WORKERS"],
                justification:
                    "Run the local ML model in a dedicated Web Worker."
            });
            console.log("[Classifier] offscreen document created");
        }

        offscreenReady = true;
    })();

    try {
        await offscreenCreationPromise;
    } finally {
        offscreenCreationPromise = null;
    }
}
async function runEmbedding(text) {
    console.log("[Classifier] runEmbedding called");
    await ensureOffscreenDocument();
    console.log("[Classifier] offscreen ready");
    const id = ++requestId;

    console.log("[Classifier] sending embedding request", { requestId: id });
    const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("Embedding timed out after 120 seconds")),
            EMBEDDING_TIMEOUT
        );

        chrome.runtime.sendMessage({
            type: "OFFSCREEN_EMBED",
            requestId: id,
            text
        }).then(result => {
            clearTimeout(timeout);
            resolve(result);
        }).catch(error => {
            clearTimeout(timeout);
            reject(error);
        });
    });

    if (!response?.success || !Array.isArray(response.embedding)) {
        throw new Error(response?.error || "Invalid embedding response");
    }

    console.log("[Classifier] embedding received", {
        requestId: id,
        dimensions: response.embedding.length,
        modelVersion: response.modelVersion
    });

    return {
        embedding: response.embedding,
        modelVersion: response.modelVersion
    };
}

function buildVideoText(video) {
    return `Title: ${video.title || ""}`
        // `Description: ${video.description || ""}`,
        // `Channel: ${video.channelTitle || ""}`
    
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) {
        throw new Error("Invalid embedding vectors");
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }

    return dotProduct /
        (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}


const requirementPromises = new Map();

async function getRequirementEmbedding(settings) {
    const cacheKey = [
        MODEL_VERSION,
        settings.policyHash
    ].join(":");

    // Reuse an in-flight operation for the same policy.
    if (requirementPromises.has(cacheKey)) {
        return requirementPromises.get(cacheKey);
    }

    const promise = (async () => {
        const cached = await getPolicyEmbedding(cacheKey);

        if (cached?.embeddings?.length) {
            return cached.embeddings;
        }

        const anchors = await expandRequirementToAnchors(
            settings.userRequirement
        );

        const embeddings = [];

        // Sequential execution avoids flooding the ML worker.
        for (const anchor of anchors) {
            const result = await runEmbedding(anchor);
            embeddings.push(Array.from(result.embedding));
        }

        await savePolicyEmbedding(cacheKey, {
            anchors,
            embeddings,
            modelVersion: MODEL_VERSION,
            policyHash: settings.policyHash,
            createdAt: Date.now()
        });

        return embeddings;
    })();

    // Store the promise immediately, before other calls can start work.
    requirementPromises.set(cacheKey, promise);

    try {
        return await promise;
    } finally {
        if (requirementPromises.get(cacheKey) === promise) {
            requirementPromises.delete(cacheKey);
        }
    }
}

async function getVideoEmbeddingForVideo(video) {
    const cacheKey = [
        video.videoId,
        MODEL_VERSION
    ].join(":");

    const cachedEmbedding =
        await getVideoEmbedding(cacheKey);

    if (cachedEmbedding) {
        return cachedEmbedding.embedding;
    }

    const text = buildVideoText(video);

    const result =
        await runEmbedding(text);

    const embedding =
        Array.from(result.embedding);

    await saveVideoEmbedding(
        cacheKey,
        {
            videoId: video.videoId,
            embedding,
            modelVersion: MODEL_VERSION,
            createdAt: Date.now()
        }
    );

    return embedding;
}

function evaluateSimilarity(similarity, settings) {
    const threshold =
        Number(settings.relevanceThreshold) ||
        DEFAULT_THRESHOLD;

    if (similarity >= threshold) {
        return {
            decision: DECISIONS.ALLOWED,
            similarity,
            reason:
                `Semantic similarity ${similarity.toFixed(3)} meets the relevance threshold.`
        };
    }

    return {
        decision: DECISIONS.BLOCKED,
        similarity,
        reason:
            `Semantic similarity ${similarity.toFixed(3)} is below the relevance threshold.`
    };
}

export async function classifyVideo(video, settings) {
    if (!video) {
        throw new Error("Video metadata is required");
    }

    if (!settings) {
        throw new Error("Settings are required");
    }

    if (!settings.enabled) {
        return {
            decision: DECISIONS.ALLOWED,
            similarity: 1,
            reason: "Filtering is disabled.",
            modelVersion: MODEL_VERSION,
            classifiedAt: Date.now()
        };
    }

    if (!settings.userRequirement?.trim()) {
        return {
            decision: DECISIONS.ALLOWED,
            similarity: 0,
            reason: "No content requirement is configured.",
            modelVersion: MODEL_VERSION,
            classifiedAt: Date.now()
        };
    }

    const videoText = buildVideoText(video);

    if (!videoText.trim()) {
        return {
            decision: DECISIONS.ALLOWED,
            similarity: 0,
            reason: "Video contains insufficient metadata.",
            modelVersion: MODEL_VERSION,
            classifiedAt: Date.now()
        };
    }
console.log(
    "[Classifier] starting embeddings:",
    video.videoId
);

    const [
        requirementEmbeddings,
        videoEmbedding
    ] = await Promise.all([
        getRequirementEmbedding(settings),
        getVideoEmbeddingForVideo(video)
    ]);
    console.log(
        "[Classifier] embeddings completed:",
        video.videoId,
        "requirementEmbeddings:", requirementEmbeddings,
        "videoEmbedding:", videoEmbedding.length
    );
let maxSimilarity= -Infinity;
    for(const requirementEmbedding of requirementEmbeddings) {

    const similarity =
        cosineSimilarity(
            requirementEmbedding,
            videoEmbedding
        );
    maxSimilarity = Math.max(maxSimilarity, similarity);
    }
console.log(video.title,  video.videoId, "similarity:", maxSimilarity);
    const policyResult =
        evaluateSimilarity(
            maxSimilarity,
            settings
        );

    return {
        ...policyResult,
        modelVersion: MODEL_VERSION,
        classifiedAt: Date.now()
    };
}

export function clearClassifierCaches() {
    offscreenReady = false;
    offscreenCreationPromise = null;
}

let expansionRequestId = 0;

export async function expandRequirementToAnchors(requirement) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_EXPAND_QUERY",
    requestId: ++expansionRequestId,
    requirement,
  });

  if (!response?.success) {
    throw new Error(response?.error || "Query expansion failed");
  }

  return response.anchors;
}
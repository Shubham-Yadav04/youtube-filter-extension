import {
    getPolicyEmbedding,
    savePolicyEmbedding,
    getVideoEmbedding,
    saveVideoEmbedding
} from "./db.js";

const CLASSIFICATION_TIMEOUT = 15_000;

const MODEL_VERSION = "minilm-l6-v2";

const DECISIONS = {
    ALLOWED: "ALLOWED",
    BLOCKED: "BLOCKED"
};

const DEFAULT_THRESHOLD = 0.70;

let worker = null;
let requestId = 0;

const pendingRequests = new Map();

/**
 * Create or reuse the ML worker.
 */
function getWorker() {
    if (worker) {
        return worker;
    }

    worker = new Worker(
        chrome.runtime.getURL("ml-worker.js"),
        { type: "module" }
    );

    worker.onmessage = handleWorkerMessage;

    worker.onerror = error => {
        console.error("[Classifier] Worker error:", error);

        for (const request of pendingRequests.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }

        pendingRequests.clear();
        worker = null;
    };

    return worker;
}

/**
 * Resolve or reject a pending worker request.
 */
function handleWorkerMessage(event) {
    const {
        requestId: id,
        embedding,
        modelVersion,
        error
    } = event.data;

    const request = pendingRequests.get(id);

    if (!request) {
        return;
    }

    clearTimeout(request.timeout);
    pendingRequests.delete(id);

    if (error) {
        request.reject(new Error(error));
        return;
    }

    request.resolve({
        embedding,
        modelVersion
    });
}

/**
 * Request an embedding from the ML worker.
 */
function runEmbedding(text) {
    const id = ++requestId;
    const modelWorker = getWorker();

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error("Embedding timeout"));
        }, CLASSIFICATION_TIMEOUT);

        pendingRequests.set(id, {
            resolve,
            reject,
            timeout
        });

        modelWorker.postMessage({
            type: "EMBED",
            requestId: id,
            text
        });
    });
}

/**
 * Build the text representation used for video embedding.
 */
function buildVideoText(video) {
    return [
        `Title: ${video.title || ""}`,
        `Description: ${video.description || ""}`,
        `Channel: ${video.channelTitle || ""}`
    ].join("\n");
}

/**
 * Calculate cosine similarity between two embedding vectors.
 */
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

/**
 * Get the cached requirement embedding or generate a new one.
 */
async function getRequirementEmbedding(settings) {
    const cacheKey = [
        MODEL_VERSION,
        settings.policyHash
    ].join(":");

    const cachedEmbedding =
        await getPolicyEmbedding(cacheKey);

    if (cachedEmbedding) {
        return cachedEmbedding.embedding;
    }

    const result =
        await runEmbedding(settings.userRequirement);

    const embedding =
        Array.from(result.embedding);

    await savePolicyEmbedding(
        cacheKey,
        {
            embedding,
            modelVersion: MODEL_VERSION,
            policyHash: settings.policyHash,
            createdAt: Date.now()
        }
    );

    return embedding;
}

/**
 * Get the cached video embedding or generate a new one.
 */
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

/**
 * Convert similarity into the final filtering decision.
 */
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

/**
 * Classify one YouTube video against the current user requirement.
 */
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

    const [
        requirementEmbedding,
        videoEmbedding
    ] = await Promise.all([
        getRequirementEmbedding(settings),
        getVideoEmbeddingForVideo(video)
    ]);

    const similarity =
        cosineSimilarity(
            requirementEmbedding,
            videoEmbedding
        );

    const policyResult =
        evaluateSimilarity(
            similarity,
            settings
        );

    return {
        ...policyResult,
        modelVersion: MODEL_VERSION,
        classifiedAt: Date.now()
    };
}

/**
 * Terminate the worker and reject pending inference requests.
 */
export function clearClassifierCaches() {
    for (const request of pendingRequests.values()) {
        clearTimeout(request.timeout);
        request.reject(
            new Error("Classifier reset")
        );
    }

    pendingRequests.clear();

    if (worker) {
        worker.terminate();
        worker = null;
    }
}


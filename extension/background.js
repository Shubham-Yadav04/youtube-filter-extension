/* eslint-disable no-undef */

import {
    classifyVideo,
    clearClassifierCaches
} from "./classifier.js";

import {
    getSettings,
    getVideoDecision,
    saveVideoDecision,
    clearVideoDecisions,
    getStats,
    resetStats,
    updateStats
} from "./db.js";

const MODEL_VERSION = "minilm-l6-v2";

const MESSAGE_TYPES = {
    CLASSIFY_BATCH: "CLASSIFY_BATCH",
    CLASSIFY_VIDEO: "CLASSIFY_VIDEO",
    STATE_CHANGED: "STATE_CHANGED",
    RULE_UPDATED: "RULE_UPDATED",
    CLEAR_DOM_CACHE: "CLEAR_DOM_CACHE",
    TAB_FOCUSED: "TAB_FOCUSED",
    GET_STATS: "GET_STATS",
    RESET_STATS: "RESET_STATS"
};

const inFlightRequests = new Map();

function getDecisionCacheKey(videoId, policyHash) {
    return [
        videoId,
        MODEL_VERSION,
        policyHash
    ].join(":");
}

async function classifySingleVideo(video) {
    if (!video?.videoId) {
        return {
            decision: "ALLOWED",
            similarity: 0,
            reason: "Missing video ID"
        };
    }

    const settings = await getSettings();

    if (settings?.enabled === false) {
        return {
            decision: "ALLOWED",
            similarity: 1,
            reason: "Filter disabled"
        };
    }

    const cacheKey = getDecisionCacheKey(
        video.videoId,
        settings.policyHash
    );

    const cached = await getVideoDecision(cacheKey);

    if (cached) {
        return cached;
    }

    if (inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey);
    }

    const classificationPromise = (async () => {
        try {
            const result = await classifyVideo(
                video,
                settings
            );

            const finalResult = {
                decision:
                    result?.decision === "BLOCKED"
                        ? "BLOCKED"
                        : "ALLOWED",

                similarity:
                    typeof result?.similarity === "number"
                        ? result.similarity
                        : 0,

                reason:
                    result?.reason ||
                    "Classification completed",

                modelVersion: MODEL_VERSION,
                policyHash: settings.policyHash,
                classifiedAt: Date.now()
            };

            await saveVideoDecision(
                cacheKey,
                finalResult
            );

            return finalResult;

        } catch (error) {
            console.error(
                `[Background] Classification failed: ${video.videoId}`,
                error
            );

            return {
                decision: "ALLOWED",
                similarity: 0,
                reason: "Classifier unavailable",
                error: true
            };

        } finally {
            inFlightRequests.delete(cacheKey);
        }
    })();

    inFlightRequests.set(
        cacheKey,
        classificationPromise
    );

    return classificationPromise;
}

async function handleBatchClassification(videos = []) {
    if (!Array.isArray(videos) || !videos.length) {
        return {};
    }

    const results = {};

    const classificationResults =
        await Promise.all(
            videos.map(async video => ({
                videoId: video.videoId,
                result: await classifySingleVideo(video)
            }))
        );

    let blocked = 0;
    let allowed = 0;

    for (const item of classificationResults) {
        results[item.videoId] = item.result;

        if (item.result.decision === "BLOCKED") {
            blocked++;
        } else {
            allowed++;
        }
    }

    await updateStats({
        blocked,
        allowed
    });

    return results;
}

async function wipeDecisionCache() {
    inFlightRequests.clear();

    await clearVideoDecisions();

    clearClassifierCaches();
}

async function reloadActiveYouTubeTab() {
    try {
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        const activeTab = tabs[0];

        if (
            !activeTab?.id ||
            !activeTab.url?.includes("youtube.com")
        ) {
            return;
        }

        try {
            await chrome.tabs.sendMessage(
                activeTab.id,
                {
                    type: MESSAGE_TYPES.CLEAR_DOM_CACHE
                }
            );
        } catch (_) {
            // Content script may not be ready.
        }

        await chrome.tabs.reload(activeTab.id);

    } catch (error) {
        console.error(
            "[Background] Failed to reload YouTube tab:",
            error
        );
    }
}

chrome.tabs.onActivated.addListener(
    async activeInfo => {
        try {
            const tab = await chrome.tabs.get(
                activeInfo.tabId
            );

            if (
                !tab?.id ||
                !tab.url?.includes("youtube.com")
            ) {
                return;
            }

            try {
                await chrome.tabs.sendMessage(
                    tab.id,
                    {
                        type: MESSAGE_TYPES.TAB_FOCUSED
                    }
                );
            } catch (_) {
                // Content script may not exist.
            }

        } catch (_) {
            // Ignore tab errors.
        }
    }
);

chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {

        if (
            message?.type ===
            MESSAGE_TYPES.CLASSIFY_BATCH
        ) {
            (async () => {
                try {
                    const results =
                        await handleBatchClassification(
                            message.videos || []
                        );

                    sendResponse({ results });

                } catch (error) {
                    console.error(
                        "[Background] Batch classification failed:",
                        error
                    );

                    const results = {};

                    for (
                        const video
                        of message.videos || []
                    ) {
                        if (!video?.videoId) {
                            continue;
                        }

                        results[video.videoId] = {
                            decision: "ALLOWED",
                            similarity: 0,
                            reason: "Classifier unavailable",
                            error: true
                        };
                    }

                    sendResponse({ results });
                }
            })();

            return true;
        }

        if (
            message?.type ===
            MESSAGE_TYPES.CLASSIFY_VIDEO
        ) {
            (async () => {
                try {
                    const result =
                        await classifySingleVideo(
                            message.video
                        );

                    sendResponse({ result });

                } catch (error) {
                    console.error(
                        "[Background] Video classification failed:",
                        error
                    );

                    sendResponse({
                        result: {
                            decision: "ALLOWED",
                            similarity: 0,
                            reason: "Classifier unavailable",
                            error: true
                        }
                    });
                }
            })();

            return true;
        }

        if (
            message?.type ===
            MESSAGE_TYPES.STATE_CHANGED ||
            message?.action ===
            MESSAGE_TYPES.STATE_CHANGED
        ) {
            (async () => {
                await wipeDecisionCache();

                if (
                    message.started === true ||
                    message.enabled === true
                ) {
                    await reloadActiveYouTubeTab();
                } else {
                    try {
                        const tabs =
                            await chrome.tabs.query({
                                active: true,
                                currentWindow: true
                            });

                        const tab = tabs[0];

                        if (tab?.id) {
                            await chrome.tabs.sendMessage(
                                tab.id,
                                {
                                    type:
                                        MESSAGE_TYPES.STATE_CHANGED,
                                    started: false
                                }
                            );
                        }
                    } catch (_) {
                        // Ignore messaging errors.
                    }
                }

                sendResponse({ ok: true });
            })();

            return true;
        }

        if (
            message?.type ===
            MESSAGE_TYPES.RULE_UPDATED
        ) {
            (async () => {
                await wipeDecisionCache();
                await reloadActiveYouTubeTab();

                sendResponse({ ok: true });
            })();

            return true;
        }

        if (
            message?.type ===
            MESSAGE_TYPES.GET_STATS
        ) {
            (async () => {
                try {
                    const stats = await getStats();

                    sendResponse({
                        stats: stats || {
                            blocked: 0,
                            allowed: 0
                        }
                    });

                } catch (error) {
                    console.error(
                        "[Background] Failed to get stats:",
                        error
                    );

                    sendResponse({
                        stats: {
                            blocked: 0,
                            allowed: 0
                        }
                    });
                }
            })();

            return true;
        }

        if (
            message?.type ===
            MESSAGE_TYPES.RESET_STATS
        ) {
            (async () => {
                try {
                    await resetStats();
                    sendResponse({ ok: true });

                } catch (error) {
                    console.error(
                        "[Background] Failed to reset stats:",
                        error
                    );

                    sendResponse({ ok: false });
                }
            })();

            return true;
        }

        return false;
    }
);
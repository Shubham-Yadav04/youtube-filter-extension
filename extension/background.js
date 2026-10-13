/* eslint-disable no-undef */

import {
    classifyVideo,
    clearClassifierCaches
} from "./classifier.js";

import {
    getVideoDecision,
    saveVideoDecision,
    clearVideoDecisions,
    getStats,
    resetStats,
    updateStats
} from "./db.js";
import {
    getSettings,
    saveSettings,
    resetSettings
} from "./settings.js";
const MODEL_VERSION = "minilm-l6-v2";

const MESSAGE_TYPES = {
    CLASSIFY_BATCH: "CLASSIFY_BATCH",
    CLASSIFY_VIDEO: "CLASSIFY_VIDEO",
    STATE_CHANGED: "STATE_CHANGED",
    RULE_UPDATED: "RULE_UPDATED",
    CLEAR_DOM_CACHE: "CLEAR_DOM_CACHE",
    TAB_FOCUSED: "TAB_FOCUSED",
    GET_STATS: "GET_STATS",
    RESET_STATS: "RESET_STATS",
    RESET_SETTINGS: "RESET_SETTINGS",
    TOGGLE_ENABLED: "TOGGLE_ENABLED",
    SAVE_SETTINGS: "SAVE_SETTINGS",
    GET_SETTINGS: "GET_SETTINGS"
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
    console.log(
        "[Background] classifySingleVideo:",
        video.videoId
    );
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
            console.log(
                "[Background] calling classifier:",
                video.videoId
            );
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
        const [tabs, settings] = await Promise.all([
            chrome.tabs.query({
                url: ["*://www.youtube.com/*"]
            }),
            getSettings()
        ]);

        await Promise.all(tabs.map(async tab => {
            if (!tab.id) {
                return;
            }

            try {
                await chrome.tabs.sendMessage(tab.id, {
                    type: MESSAGE_TYPES.STATE_CHANGED,
                    enabled: settings.enabled
                });
            } catch {
                // Content script may not be ready.
            }
        }));

        const activeTabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        const activeTab = activeTabs[0];

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
        } catch {
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
            } catch {
                // Content script may not exist.
            }

        } catch {
            // Ignore tab errors.
        }
    }
);
chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {

        // =========================================================
        // CLASSIFY BATCH
        // =========================================================

        if (message?.type === MESSAGE_TYPES.CLASSIFY_BATCH) {
            (async () => {
                try {
                    const results =
                        await handleBatchClassification(
                            message.videos || []
                        );

                    sendResponse({
                        success: true,
                        results
                    });

                } catch (error) {
                    console.error(
                        "[Background] Batch classification failed:",
                        error
                    );

                    const results = {};

                    for (const video of message.videos || []) {
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

                    sendResponse({
                        success: false,
                        results
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // CLASSIFY SINGLE VIDEO
        // =========================================================

        if (message?.type === MESSAGE_TYPES.CLASSIFY_VIDEO) {
            (async () => {
                try {
                    const result =
                        await classifySingleVideo(
                            message.video
                        );

                    sendResponse({
                        success: true,
                        result
                    });

                } catch (error) {
                    console.error(
                        "[Background] Video classification failed:",
                        error
                    );

                    sendResponse({
                        success: false,
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


        // =========================================================
        // GET SETTINGS
        // =========================================================

        if (message?.type === MESSAGE_TYPES.GET_SETTINGS) {
            (async () => {
                try {
                    const settings = await getSettings();

                    sendResponse({
                        success: true,
                        settings
                    });

                } catch (error) {
                    console.error(
                        "[Background] Failed to get settings:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "SETTINGS_READ_FAILED"
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // SAVE SETTINGS
        // =========================================================




        if (message?.type === MESSAGE_TYPES.SAVE_SETTINGS) {
            (async () => {

                try {

                    const currentSettings =
                        await getSettings();
                    const locked =
                        currentSettings.lockUntil &&
                        Date.now() < currentSettings.lockUntil;

                    /*
                     * If locked, don't allow settings changes.
                     *
                     * You can choose to allow changing the
                     * requirement/threshold while locked, but for
                     * the "focus lock" concept I recommend locking
                     * all filter changes.
                     */
                    if (locked) {
                        sendResponse({
                            success: false,
                            error: "FILTER_LOCKED",
                            settings: currentSettings
                        });

                        return;
                    }

                    let lockUntil =
                        currentSettings.lockUntil;

                    if (message.lockDurationMs) {
                        lockUntil =
                            Date.now() +
                            Number(message.lockDurationMs);
                    } else {
                        lockUntil = null;
                    }

                    const updatedSettings =
                        await saveSettings({
                            ...currentSettings,

                            userRequirement:
                                String(
                                    message.userRequirement || ""
                                ).trim(),

                            relevanceThreshold:
                                Number(
                                    message.relevanceThreshold
                                ),

                            enabled: true,

                            lockUntil
                        });

                    // Old decisions belong to the old policy.
                    await clearVideoDecisions();

                    await reloadActiveYouTubeTab();

                    sendResponse({
                        success: true,
                        settings: updatedSettings
                    });

                } catch (error) {
                    console.error(
                        "[Background] Failed to save settings:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "SETTINGS_SAVE_FAILED"
                    });
                }
            })();


            return true;
        }


        // =========================================================
        // TOGGLE ENABLED
        // =========================================================

        if (message?.type === MESSAGE_TYPES.TOGGLE_ENABLED) {
            (async () => {
                try {
                    const settings =
                        await getSettings();

                    const locked =
                        settings.lockUntil &&
                        Date.now() < settings.lockUntil;

                    /*
                     * Background is the authority.
                     * Never rely only on popup UI disabling.
                     */
                    if (locked) {
                        sendResponse({
                            success: false,
                            error: "FILTER_LOCKED",
                            settings
                        });

                        return;
                    }

                    const updatedSettings =
                        await saveSettings({
                            ...settings,
                            enabled:
                                Boolean(message.enabled)
                        });

                    await clearVideoDecisions();

                    await reloadActiveYouTubeTab();

                    sendResponse({
                        success: true,
                        settings: updatedSettings
                    });

                } catch (error) {
                    console.error(
                        "[Background] Failed to toggle filter:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "TOGGLE_FAILED"
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // RESET SETTINGS
        // =========================================================

        if (message?.type === MESSAGE_TYPES.RESET_SETTINGS) {
            (async () => {
                try {
                    const settings =
                        await getSettings();

                    const locked =
                        settings.lockUntil &&
                        Date.now() < settings.lockUntil;

                    if (locked) {
                        sendResponse({
                            success: false,
                            error: "FILTER_LOCKED",
                            settings
                        });

                        return;
                    }

                    const updatedSettings =
                        await resetSettings();

                    await clearVideoDecisions();

                    await reloadActiveYouTubeTab();

                    sendResponse({
                        success: true,
                        settings: updatedSettings
                    });

                } catch (error) {
                    console.error(
                        "[Background] Failed to reset settings:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "RESET_SETTINGS_FAILED"
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // GET STATS
        // =========================================================

        if (message?.type === MESSAGE_TYPES.GET_STATS) {
            (async () => {
                try {
                    const stats = await getStats();

                    sendResponse({
                        success: true,
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
                        success: false,
                        stats: {
                            blocked: 0,
                            allowed: 0
                        }
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // RESET STATS
        // =========================================================

        if (message?.type === MESSAGE_TYPES.RESET_STATS) {
            (async () => {
                try {
                    await resetStats();

                    sendResponse({
                        success: true
                    });

                } catch (error) {
                    console.error(
                        "[Background] Failed to reset stats:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "RESET_STATS_FAILED"
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // LEGACY / EXTERNAL STATE CHANGE
        // =========================================================

        if (
            message?.type === MESSAGE_TYPES.STATE_CHANGED ||
            message?.action === MESSAGE_TYPES.STATE_CHANGED
        ) {
            (async () => {
                try {
                    await wipeDecisionCache();

                    if (
                        message.started === true ||
                        message.enabled === true
                    ) {
                        await reloadActiveYouTubeTab();
                    } else {
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
                                    enabled: false
                                }
                            );
                        }
                    }

                    sendResponse({
                        success: true
                    });

                } catch (error) {
                    console.error(
                        "[Background] State change failed:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "STATE_CHANGE_FAILED"
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // LEGACY RULE UPDATED
        // =========================================================

        if (
            message?.type === MESSAGE_TYPES.RULE_UPDATED
        ) {
            (async () => {
                try {
                    await wipeDecisionCache();

                    await reloadActiveYouTubeTab();

                    sendResponse({
                        success: true
                    });

                } catch (error) {
                    console.error(
                        "[Background] Rule update failed:",
                        error
                    );

                    sendResponse({
                        success: false,
                        error: "RULE_UPDATE_FAILED"
                    });
                }
            })();

            return true;
        }


        // =========================================================
        // UNKNOWN MESSAGE
        // =========================================================

        return false;
    });
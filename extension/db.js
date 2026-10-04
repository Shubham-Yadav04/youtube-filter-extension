/* eslint-disable no-undef */
/**
 * YouTube Focus Filter - IndexedDB Storage Layer
 *
 * This module is the ONLY place where the background layer directly
 * interacts with IndexedDB.
 *
 * Responsibilities:
 *
 * 1. Persist user filter settings.
 * 2. Persist video classification decisions.
 * 3. Persist filtering statistics.
 * 4. Handle IndexedDB initialization/upgrades.
 * 5. Hide all IndexedDB implementation details from background.js.
 *
 *
 * Database:
 *
 *   YTFilterDB
 *
 * Object stores:
 *
 *   settings
 *   videoDecisions
 *   stats
 */


// ─────────────────────────────────────────────────────────────────────────────
// Database Configuration
// ─────────────────────────────────────────────────────────────────────────────
const DB_NAME = "YTFilterDB";
const DB_VERSION = 1;

const STORES = {
    SETTINGS: "settings",
    VIDEO_DECISIONS: "videoDecisions",
    VIDEO_EMBEDDINGS: "videoEmbeddings",
    POLICY_EMBEDDINGS: "policyEmbeddings",
    STATS: "stats"
};

const SETTINGS_KEY = "current";
const STATS_KEY = "current";

const DEFAULT_SETTINGS = {
    enabled: true,
    userRequirement:
        "I want videos related to software engineering and programming.",
    relevanceThreshold: 0.70,
    policyHash: "",
    updatedAt: Date.now()
};

const DEFAULT_STATS = {
    blocked: 0,
    allowed: 0,
    classificationErrors: 0,
    sessionStart: Date.now(),
    updatedAt: Date.now()
};

let dbPromise = null;

/**
 * Normalize policy text before hashing.
 */
function canonicalizePolicy(userRequirement = "") {
    return String(userRequirement)
        .trim()
        .toLowerCase();
}

/**
 * Generate a deterministic hash for the current policy.
 */
export async function generatePolicyHash(
    userRequirement = ""
) {
    const canonicalPolicy =
        canonicalizePolicy(userRequirement);

    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalPolicy);

    const hashBuffer =
        await crypto.subtle.digest("SHA-256", data);

    return Array.from(new Uint8Array(hashBuffer))
        .map(byte =>
            byte.toString(16).padStart(2, "0")
        )
        .join("");
}

/**
 * Open the IndexedDB database.
 */
function openDatabase() {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request =
            indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(
                STORES.SETTINGS
            )) {
                db.createObjectStore(
                    STORES.SETTINGS
                );
            }

            if (!db.objectStoreNames.contains(
                STORES.VIDEO_DECISIONS
            )) {
                const store =
                    db.createObjectStore(
                        STORES.VIDEO_DECISIONS
                    );

                store.createIndex(
                    "videoId",
                    "videoId",
                    { unique: false }
                );

                store.createIndex(
                    "modelVersion",
                    "modelVersion",
                    { unique: false }
                );

                store.createIndex(
                    "policyHash",
                    "policyHash",
                    { unique: false }
                );

                store.createIndex(
                    "classifiedAt",
                    "classifiedAt",
                    { unique: false }
                );
            } else {
                const transaction =
                    event.target.transaction;

                const store =
                    transaction.objectStore(
                        STORES.VIDEO_DECISIONS
                    );

                if (store.indexNames.contains(
                    "policyVersion"
                )) {
                    store.deleteIndex("policyVersion");
                }

                if (!store.indexNames.contains(
                    "policyHash"
                )) {
                    store.createIndex(
                        "policyHash",
                        "policyHash",
                        { unique: false }
                    );
                }
            }

            if (!db.objectStoreNames.contains(
                STORES.VIDEO_EMBEDDINGS
            )) {
                const store =
                    db.createObjectStore(
                        STORES.VIDEO_EMBEDDINGS
                    );

                store.createIndex(
                    "videoId",
                    "videoId",
                    { unique: false }
                );

                store.createIndex(
                    "modelVersion",
                    "modelVersion",
                    { unique: false }
                );

                store.createIndex(
                    "createdAt",
                    "createdAt",
                    { unique: false }
                );
            }

            if (!db.objectStoreNames.contains(
                STORES.POLICY_EMBEDDINGS
            )) {
                const store =
                    db.createObjectStore(
                        STORES.POLICY_EMBEDDINGS
                    );

                store.createIndex(
                    "policyHash",
                    "policyHash",
                    { unique: false }
                );

                store.createIndex(
                    "modelVersion",
                    "modelVersion",
                    { unique: false }
                );

                store.createIndex(
                    "createdAt",
                    "createdAt",
                    { unique: false }
                );
            }

            if (!db.objectStoreNames.contains(
                STORES.STATS
            )) {
                db.createObjectStore(
                    STORES.STATS
                );
            }
        };

        request.onsuccess = () => {
            const db = request.result;

            db.onversionchange = () => {
                db.close();
                dbPromise = null;
            };

            resolve(db);
        };

        request.onerror = () => {
            dbPromise = null;

            console.error(
                "[DB ❌] Failed to open IndexedDB:",
                request.error
            );

            reject(request.error);
        };

        request.onblocked = () => {
            console.warn(
                "[DB ⚠️] IndexedDB upgrade blocked."
            );
        };
    });

    return dbPromise;
}

/**
 * Execute an IndexedDB transaction.
 */
async function executeTransaction(
    storeName,
    mode,
    operation
) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        let transaction;

        try {
            transaction =
                db.transaction(
                    storeName,
                    mode
                );
        } catch (error) {
            reject(error);
            return;
        }

        const store =
            transaction.objectStore(
                storeName
            );

        let result;

        try {
            result = operation(store);
        } catch (error) {
            reject(error);
            return;
        }

        transaction.oncomplete = () => {
            resolve(result);
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };

        transaction.onabort = () => {
            reject(
                transaction.error ||
                new Error(
                    `Transaction aborted: ${storeName}`
                )
            );
        };
    });
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create default settings with a valid policy hash.
 */
async function createDefaultSettings() {
    const policyHash =
        await generatePolicyHash(
            DEFAULT_SETTINGS.userRequirement
        );

    return {
        ...DEFAULT_SETTINGS,
        policyHash,
        updatedAt: Date.now()
    };
}

/**
 * Read current user settings.
 */
export async function getSettings() {
    try {
        const db = await openDatabase();

        return await new Promise(
            (resolve, reject) => {
                const transaction =
                    db.transaction(
                        STORES.SETTINGS,
                        "readonly"
                    );

                const store =
                    transaction.objectStore(
                        STORES.SETTINGS
                    );

                const request =
                    store.get(SETTINGS_KEY);

                request.onsuccess = async () => {
                    try {
                        if (!request.result) {
                            const defaults =
                                await createDefaultSettings();

                            await saveSettingsInternal(
                                defaults
                            );

                            resolve(defaults);
                            return;
                        }

                        resolve({
                            ...DEFAULT_SETTINGS,
                            ...request.result
                        });
                    } catch (error) {
                        reject(error);
                    }
                };

                request.onerror = () => {
                    reject(request.error);
                };
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] getSettings failed:",
            error
        );

        return createDefaultSettings();
    }
}

/**
 * Persist settings without recalculating the policy.
 */
async function saveSettingsInternal(settings) {
    await executeTransaction(
        STORES.SETTINGS,
        "readwrite",
        store => {
            store.put(
                settings,
                SETTINGS_KEY
            );
        }
    );
}

/**
 * Save settings and regenerate the policy hash.
 */
export async function saveSettings(
    settings = {}
) {
    try {
        const current =
            await getSettings();

        const merged = {
            ...DEFAULT_SETTINGS,
            ...current,
            ...settings
        };

        merged.userRequirement =
            String(
                merged.userRequirement || ""
            ).trim();

        merged.policyHash =
            await generatePolicyHash(
                merged.userRequirement
            );

        merged.updatedAt =
            Date.now();

        await saveSettingsInternal(
            merged
        );

        return merged;
    } catch (error) {
        console.error(
            "[DB ❌] saveSettings failed:",
            error
        );

        throw error;
    }
}

/* -------------------------------------------------------------------------- */
/* Video Decisions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Read a cached video decision.
 *
 * Key:
 * videoId:modelVersion:policyHash
 */
export async function getVideoDecision(
    cacheKey
) {
    if (!cacheKey) {
        return null;
    }

    try {
        const db = await openDatabase();

        return await new Promise(
            (resolve, reject) => {
                const transaction =
                    db.transaction(
                        STORES.VIDEO_DECISIONS,
                        "readonly"
                    );

                const store =
                    transaction.objectStore(
                        STORES.VIDEO_DECISIONS
                    );

                const request =
                    store.get(cacheKey);

                request.onsuccess = () => {
                    resolve(
                        request.result || null
                    );
                };

                request.onerror = () => {
                    reject(request.error);
                };
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] getVideoDecision failed:",
            error
        );

        return null;
    }
}

/**
 * Save a successful video decision.
 */
export async function saveVideoDecision(
    cacheKey,
    result
) {
    if (!cacheKey || !result) {
        return;
    }

    try {
        const record = {
            ...result,
            cacheKey,
            savedAt: Date.now()
        };

        await executeTransaction(
            STORES.VIDEO_DECISIONS,
            "readwrite",
            store => {
                store.put(
                    record,
                    cacheKey
                );
            }
        );
    } catch (error) {
        console.error(
            "[DB ⚠️] Failed to save video decision:",
            error
        );
    }
}

/**
 * Remove all cached decisions.
 */
export async function clearVideoDecisions() {
    try {
        await executeTransaction(
            STORES.VIDEO_DECISIONS,
            "readwrite",
            store => {
                store.clear();
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] Failed to clear video decisions:",
            error
        );

        throw error;
    }
}

/* -------------------------------------------------------------------------- */
/* Video Embeddings                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Read a cached video embedding.
 *
 * Key:
 * videoId:modelVersion
 */
export async function getVideoEmbedding(
    cacheKey
) {
    if (!cacheKey) {
        return null;
    }

    try {
        return await executeTransaction(
            STORES.VIDEO_EMBEDDINGS,
            "readonly",
            store => {
                return new Promise(
                    (resolve, reject) => {
                        const request =
                            store.get(cacheKey);

                        request.onsuccess = () => {
                            resolve(
                                request.result ||
                                null
                            );
                        };

                        request.onerror = () => {
                            reject(
                                request.error
                            );
                        };
                    }
                );
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] getVideoEmbedding failed:",
            error
        );

        return null;
    }
}

/**
 * Save a generated video embedding.
 */
export async function saveVideoEmbedding(
    cacheKey,
    embedding
) {
    if (!cacheKey || !embedding) {
        return;
    }

    try {
        await executeTransaction(
            STORES.VIDEO_EMBEDDINGS,
            "readwrite",
            store => {
                store.put(
                    {
                        ...embedding,
                        cacheKey
                    },
                    cacheKey
                );
            }
        );
    } catch (error) {
        console.error(
            "[DB ⚠️] Failed to save video embedding:",
            error
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Policy Embeddings                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Read a cached policy embedding.
 *
 * Key:
 * policyHash:modelVersion
 */
export async function getPolicyEmbedding(
    cacheKey
) {
    if (!cacheKey) {
        return null;
    }

    try {
        return await executeTransaction(
            STORES.POLICY_EMBEDDINGS,
            "readonly",
            store => {
                return new Promise(
                    (resolve, reject) => {
                        const request =
                            store.get(cacheKey);

                        request.onsuccess = () => {
                            resolve(
                                request.result ||
                                null
                            );
                        };

                        request.onerror = () => {
                            reject(
                                request.error
                            );
                        };
                    }
                );
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] getPolicyEmbedding failed:",
            error
        );

        return null;
    }
}

/**
 * Save a generated policy embedding.
 */
export async function savePolicyEmbedding(
    cacheKey,
    embedding
) {
    if (!cacheKey || !embedding) {
        return;
    }

    try {
        await executeTransaction(
            STORES.POLICY_EMBEDDINGS,
            "readwrite",
            store => {
                store.put(
                    {
                        ...embedding,
                        cacheKey
                    },
                    cacheKey
                );
            }
        );
    } catch (error) {
        console.error(
            "[DB ⚠️] Failed to save policy embedding:",
            error
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read filtering statistics.
 */
export async function getStats() {
    try {
        const db = await openDatabase();

        return await new Promise(
            (resolve, reject) => {
                const transaction =
                    db.transaction(
                        STORES.STATS,
                        "readonly"
                    );

                const store =
                    transaction.objectStore(
                        STORES.STATS
                    );

                const request =
                    store.get(STATS_KEY);

                request.onsuccess = () => {
                    resolve(
                        request.result
                            ? {
                                ...DEFAULT_STATS,
                                ...request.result
                            }
                            : {
                                ...DEFAULT_STATS
                            }
                    );
                };

                request.onerror = () => {
                    reject(request.error);
                };
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] getStats failed:",
            error
        );

        return {
            ...DEFAULT_STATS
        };
    }
}

/**
 * Apply statistics deltas.
 */
export async function updateStats(
    delta = {}
) {
    try {
        const db =
            await openDatabase();

        return await new Promise(
            (resolve, reject) => {
                const transaction =
                    db.transaction(
                        STORES.STATS,
                        "readwrite"
                    );

                const store =
                    transaction.objectStore(
                        STORES.STATS
                    );

                const request =
                    store.get(STATS_KEY);

                request.onsuccess = () => {
                    const current =
                        request.result || {
                            ...DEFAULT_STATS,
                            sessionStart:
                                Date.now()
                        };

                    const updated = {
                        ...current,

                        blocked: Math.max(
                            0,
                            (current.blocked || 0) +
                            (delta.blocked || 0)
                        ),

                        allowed: Math.max(
                            0,
                            (current.allowed || 0) +
                            (delta.allowed || 0)
                        ),

                        classificationErrors:
                            Math.max(
                                0,
                                (current.classificationErrors || 0) +
                                (delta.classificationErrors || 0)
                            ),

                        updatedAt: Date.now()
                    };

                    store.put(
                        updated,
                        STATS_KEY
                    );

                    transaction.oncomplete =
                        () => {
                            resolve(updated);
                        };
                };

                request.onerror = () => {
                    reject(request.error);
                };

                transaction.onerror = () => {
                    reject(transaction.error);
                };

                transaction.onabort = () => {
                    reject(transaction.error);
                };
            }
        );
    } catch (error) {
        console.error(
            "[DB ❌] updateStats failed:",
            error
        );

        return null;
    }
}

/**
 * Reset filtering statistics.
 */
export async function resetStats() {
    try {
        const stats = {
            ...DEFAULT_STATS,
            blocked: 0,
            allowed: 0,
            classificationErrors: 0,
            sessionStart: Date.now(),
            updatedAt: Date.now()
        };

        await executeTransaction(
            STORES.STATS,
            "readwrite",
            store => {
                store.put(
                    stats,
                    STATS_KEY
                );
            }
        );

        return stats;
    } catch (error) {
        console.error(
            "[DB ❌] resetStats failed:",
            error
        );

        throw error;
    }
}
function canonicalizePolicy({ userRequirement = ""}) {
    return String(userRequirement).trim().toLowerCase(); 
}

export async function generatePolicyHash({ userRequirement = ""}) {
    const canonicalPolicy = canonicalizePolicy({ userRequirement });
    
    const encoder = new TextEncoder(); 
    const data = encoder.encode(canonicalPolicy); 
    const hashBuffer = await crypto.subtle.digest("SHA-256", data); 
    const hashArray = Array.from(new Uint8Array(hashBuffer)); 
    return hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function saveSettings(settings = {}) {
    try {
        const current = await getSettings();
        const merged = { ...DEFAULT_SETTINGS, ...current, ...settings };
      
        merged.userRequirement = String(merged.userRequirement || "").trim();
        /* * Normalize domains. * * This prevents duplicate domains and makes * policy hashing deterministic. */

        merged.policyHash = await generatePolicyHash({ userRequirement: merged.userRequirement });
        merged.updatedAt = Date.now();
        /* * Persist settings. */
        await saveSettingsInternal(merged);
        console.log("[DB 💾] Settings saved:", { enabled: merged.enabled, policyHash: merged.policyHash, updatedAt: merged.updatedAt });
        return merged;
    }
    catch (error) { 
        console.error("[DB ❌] saveSettings failed:", error);
         throw error; 
        }
     }
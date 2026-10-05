const DEFAULT_SETTINGS = {
    enabled: true,
    userRequirement: "",
    relevanceThreshold: 0.70,
    policyHash: "",
     lockUntil: null,
    updatedAt: 0
};

function canonicalizePolicy(requirement) {
    return String(requirement || "")
        .trim()
        .toLowerCase();
}

async function generatePolicyHash(requirement) {
    const canonical = canonicalizePolicy(requirement);

    const data = new TextEncoder().encode(canonical);

    const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        data
    );

    return Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

export async function getSettings() {
    const result = await chrome.storage.local.get("settings");

    return {
        ...DEFAULT_SETTINGS,
        ...(result.settings || {})
    };
}

export async function saveSettings(settings) {
    const policyHash = await generatePolicyHash(
        settings.userRequirement
    );

    const updatedSettings = {
        ...DEFAULT_SETTINGS,
        ...settings,
        policyHash,
        updatedAt: Date.now()
    };

    await chrome.storage.local.set({
        settings: updatedSettings
    });

    return updatedSettings;
}

export async function resetSettings() {
    await chrome.storage.local.set({
        settings: DEFAULT_SETTINGS
    });

    return DEFAULT_SETTINGS;
}

export function isSettingsLocked(settings) {
    return (
        settings.lockUntil !== null &&
        Date.now() < settings.lockUntil
    );
}

export function getLockRemainingMs(settings) {
    if (!settings.lockUntil) {
        return 0;
    }

    return Math.max(
        0,
        settings.lockUntil - Date.now()
    );
}
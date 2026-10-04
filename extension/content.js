/* eslint-disable no-undef */

const CARD_SELECTOR =
    "ytd-rich-item-renderer, " +
    "ytd-video-renderer, " +
    "ytd-compact-video-renderer, " +
    "ytd-grid-video-renderer, " +
    "ytd-reel-item-renderer, " +
    "yt-lockup-view-model";

const MESSAGE_TYPES = {
    CLASSIFY_BATCH: "CLASSIFY_BATCH",
    CLASSIFY_VIDEO: "CLASSIFY_VIDEO",
    STATE_CHANGED: "STATE_CHANGED",
    CLEAR_DOM_CACHE: "CLEAR_DOM_CACHE",
    TAB_FOCUSED: "TAB_FOCUSED"
};

const CLASS_NAMES = {
    PENDING: "yt-pending",
    ALLOWED: "yt-allowed",
    BLOCKED: "yt-blocked"
};

let scanScheduled = false;
let scanDebounceTimer = null;
let scrollTimer = null;

function extractVideoId(href) {
    if (!href) return null;

    try {
        const url = new URL(
            href,
            "https://www.youtube.com"
        );

        const videoId =
            url.searchParams.get("v");

        if (videoId) {
            return videoId;
        }

        const parts = url.pathname.split("/");
        const shortsIndex = parts.indexOf("shorts");

        if (
            shortsIndex !== -1 &&
            parts[shortsIndex + 1]
        ) {
            return parts[shortsIndex + 1];
        }

    } catch (_) {
        // Ignore invalid URLs.
    }

    return null;
}

function getAnchor(card) {
    const links = Array.from(
        card.querySelectorAll("a[href]")
    );

    return (
        links.find(anchor => {
            const href =
                anchor.getAttribute("href") || "";

            return (
                href.includes("/watch?v=") ||
                href.includes("/shorts/")
            );
        }) ||
        card.querySelector("a#video-title-link") ||
        card.querySelector("a#video-title") ||
        card.querySelector("a#thumbnail")
    );
}

function getVideoId(card) {
    const anchor = getAnchor(card);

    if (!anchor) {
        return null;
    }

    return extractVideoId(
        anchor.getAttribute("href")
    );
}

function getTitle(card) {
    const titleElement =
        card.querySelector("#video-title") ||
        card.querySelector("#video-title-link") ||
        card.querySelector(
            ".yt-lockup-metadata-view-model__heading-reset"
        ) ||
        card.querySelector("h3 a") ||
        card.querySelector(
            "yt-formatted-string#video-title"
        );

    if (titleElement) {
        return (
            titleElement.textContent ||
            titleElement.getAttribute("title") ||
            titleElement.getAttribute("aria-label") ||
            ""
        ).trim();
    }

    const anchor = getAnchor(card);

    if (!anchor) {
        return "";
    }

    return (
        anchor.getAttribute("title") ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        ""
    ).trim();
}

function getDescription(card) {
    return (
        card.querySelector("#description-text")
            ?.textContent ||
        card.querySelector(
            ".metadata-snippet-container"
        )?.textContent ||
        ""
    ).trim();
}

function getChannel(card) {
    return (
        card.querySelector(
            ".yt-lockup-metadata-view-model__metadata a"
        )?.textContent ||
        card.querySelector(
            "#channel-name a"
        )?.textContent ||
        card.querySelector(
            "ytd-channel-name a"
        )?.textContent ||
        card.querySelector(
            "#byline a"
        )?.textContent ||
        ""
    ).trim();
}

function setCardState(card, state) {
    card.classList.remove(
        CLASS_NAMES.PENDING,
        CLASS_NAMES.ALLOWED,
        CLASS_NAMES.BLOCKED
    );

    card.classList.add(
        CLASS_NAMES[state]
    );
}

function applyDecision(card, result) {
    const decision =
        result?.decision === "BLOCKED"
            ? "BLOCKED"
            : "ALLOWED";

    setCardState(card, decision);

    if (
        decision === "BLOCKED" &&
        result?.reason
    ) {
        const similarity =
            typeof result.similarity === "number"
                ? ` (${result.similarity.toFixed(2)})`
                : "";

        card.setAttribute(
            "title",
            `Blocked${similarity}: ${result.reason}`
        );
    } else {
        card.removeAttribute("title");
    }
}

function markPending(card) {
    setCardState(card, "PENDING");
}

function getVideoData(card) {
    const videoId = getVideoId(card);

    if (!videoId) {
        return null;
    }

    return {
        videoId,
        title: getTitle(card),
        description: getDescription(card),
        channelTitle: getChannel(card)
    };
}

async function scanVisibleCards() {
    scanScheduled = false;

    const cards = Array.from(
        document.querySelectorAll(CARD_SELECTOR)
    );

    if (!cards.length) {
        return;
    }

    const items = [];

    for (const card of cards) {
        if (card.dataset.ytfChecked) {
            continue;
        }

        const video = getVideoData(card);

        if (!video) {
            setCardState(card, "ALLOWED");
            card.dataset.ytfChecked = "1";
            continue;
        }

        markPending(card);

        items.push({
            card,
            video
        });
    }

    if (!items.length) {
        return;
    }

    try {
        const response =
            await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.CLASSIFY_BATCH,
                videos: items.map(item => item.video)
            });

        const results =
            response?.results || {};

        for (const item of items) {
            const result =
                results[item.video.videoId] || {
                    decision: "ALLOWED",
                    similarity: 0,
                    reason: "No classification result"
                };

            applyDecision(
                item.card,
                result
            );

            item.card.dataset.ytfChecked = "1";
        }

    } catch (error) {
        console.error(
            "[YTFilter] Batch classification failed:",
            error
        );

        for (const item of items) {
            setCardState(
                item.card,
                "ALLOWED"
            );

            item.card.dataset.ytfChecked = "1";
        }
    }
}

function scheduleScan() {
    if (scanScheduled) {
        return;
    }

    scanScheduled = true;

    clearTimeout(scanDebounceTimer);

    scanDebounceTimer = setTimeout(
        scanVisibleCards,
        150
    );
}

function clearDOMCache() {
    document
        .querySelectorAll(CARD_SELECTOR)
        .forEach(card => {
            delete card.dataset.ytfChecked;

            card.classList.remove(
                CLASS_NAMES.PENDING,
                CLASS_NAMES.ALLOWED,
                CLASS_NAMES.BLOCKED
            );

            card.removeAttribute("title");
        });
}

function isWatchPage() {
    return location.pathname === "/watch";
}

function getWatchPageTitle() {
    const title =
        document.querySelector(
            "h1.ytd-watch-metadata"
        )?.textContent ||
        document.querySelector(
            "h1.ytd-video-primary-info-renderer"
        )?.textContent ||
        document.title;

    return title
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .trim();
}

function getWatchPageDescription() {
    return (
        document.querySelector(
            "#description-inline-expander"
        )?.textContent ||
        document.querySelector(
            "#description"
        )?.textContent ||
        ""
    ).trim();
}

function getWatchPageChannel() {
    return (
        document.querySelector(
            "#owner #channel-name a"
        )?.textContent ||
        document.querySelector(
            "ytd-channel-name a"
        )?.textContent ||
        ""
    ).trim();
}

async function checkWatchPage() {
    const url = new URL(
        location.href
    );

    const videoId =
        url.searchParams.get("v");

    if (!videoId) {
        return;
    }

    try {
        const response =
            await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.CLASSIFY_VIDEO,
                video: {
                    videoId,
                    title: getWatchPageTitle(),
                    description:
                        getWatchPageDescription(),
                    channelTitle:
                        getWatchPageChannel()
                }
            });

        const result =
            response?.result;

        if (
            result?.decision === "BLOCKED"
        ) {
            showBlockOverlay(
                result.reason ||
                "This video does not match your content requirement."
            );
        } else {
            removeBlockOverlay();
        }

    } catch (error) {
        console.error(
            "[YTFilter] Watch page classification failed:",
            error
        );

        removeBlockOverlay();
    }
}

function showBlockOverlay(reason) {
    let overlay =
        document.getElementById(
            "yt-block-overlay"
        );

    if (overlay) {
        const reasonElement =
            overlay.querySelector(
                ".ytf-overlay-reason"
            );

        if (reasonElement) {
            reasonElement.textContent = reason;
        }

        return;
    }

    overlay =
        document.createElement("div");

    overlay.id = "yt-block-overlay";

    const card =
        document.createElement("div");

    card.className =
        "ytf-overlay-card";

    const icon =
        document.createElement("div");

    icon.className =
        "ytf-overlay-icon";

    icon.textContent = "🚫";

    const heading =
        document.createElement("h2");

    heading.textContent =
        "Content Blocked";

    const reasonElement =
        document.createElement("p");

    reasonElement.className =
        "ytf-overlay-reason";

    reasonElement.textContent =
        reason;

    const actions =
        document.createElement("div");

    actions.className =
        "ytf-overlay-actions";

    const backButton =
        document.createElement("button");

    backButton.id =
        "yt-go-back";

    backButton.className =
        "ytf-btn ytf-btn-secondary";

    backButton.textContent =
        "← Go Back";

    const homeButton =
        document.createElement("button");

    homeButton.id =
        "yt-go-home";

    homeButton.className =
        "ytf-btn ytf-btn-primary";

    homeButton.textContent =
        "Go to YouTube Home";

    actions.append(
        backButton,
        homeButton
    );

    const hint =
        document.createElement("p");

    hint.className =
        "ytf-overlay-hint";

    hint.textContent =
        "Blocked by YouTube Focus Filter";

    card.append(
        icon,
        heading,
        reasonElement,
        actions,
        hint
    );

    overlay.appendChild(card);

    (
        document.body ||
        document.documentElement
    ).appendChild(overlay);

    homeButton.addEventListener(
        "click",
        () => {
            location.href =
                "https://www.youtube.com/";
        }
    );

    backButton.addEventListener(
        "click",
        () => {
            if (history.length > 1) {
                history.back();
            } else {
                location.href =
                    "https://www.youtube.com/";
            }
        }
    );
}

function removeBlockOverlay() {
    document
        .getElementById("yt-block-overlay")
        ?.remove();
}

async function handleNavigation() {
    removeBlockOverlay();

    if (isWatchPage()) {
        await checkWatchPage();
    } else {
        scheduleScan();
    }
}

function onScroll() {
    clearTimeout(scrollTimer);

    scrollTimer = setTimeout(() => {
        const unchecked =
            document.querySelector(
                `${CARD_SELECTOR}:not([data-ytf-checked])`
            );

        if (unchecked) {
            scheduleScan();
        }
    }, 250);
}

const observer =
    new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (
                mutation.type !== "childList" ||
                !mutation.addedNodes.length
            ) {
                continue;
            }

            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) {
                    continue;
                }

                if (
                    node.matches?.(CARD_SELECTOR) ||
                    node.querySelector?.(
                        CARD_SELECTOR
                    )
                ) {
                    scheduleScan();
                    return;
                }
            }
        }
    });

function init() {
    const target =
        document.documentElement ||
        document.body;

    if (target) {
        observer.observe(target, {
            childList: true,
            subtree: true
        });
    }

    window.addEventListener(
        "scroll",
        onScroll,
        { passive: true }
    );

    document.addEventListener(
        "visibilitychange",
        () => {
            if (
                document.visibilityState ===
                "visible"
            ) {
                scheduleScan();
            }
        }
    );

    window.addEventListener(
        "yt-navigate-finish",
        handleNavigation
    );

    chrome.runtime.onMessage.addListener(
        message => {
            if (
                message?.type ===
                    MESSAGE_TYPES.CLEAR_DOM_CACHE ||
                message?.type ===
                    MESSAGE_TYPES.TAB_FOCUSED
            ) {
                clearDOMCache();
                scheduleScan();
            }

            if (
                (
                    message?.type ===
                    MESSAGE_TYPES.STATE_CHANGED ||
                    message?.action ===
                    MESSAGE_TYPES.STATE_CHANGED
                ) &&
                message.started === false
            ) {
                clearDOMCache();

                document
                    .querySelectorAll(CARD_SELECTOR)
                    .forEach(card => {
                        setCardState(
                            card,
                            "ALLOWED"
                        );
                    });

                removeBlockOverlay();
            }
        }
    );

    handleNavigation();
}

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        init,
        { once: true }
    );
} else {
    init();
}

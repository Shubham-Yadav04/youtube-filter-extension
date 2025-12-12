/* eslint-disable no-undef */
console.log("content script loaded");
let isActive = false;

let observer;
let storageData;
function filterVideos(constraints) {
    if (!isActive) {
        console.log("Scheduler is not active, skipping filtering");
        return;
    }
    

    const grid = document.querySelector("#contents");
    if (!grid) {
        console.log("Grid not found");
        return;
    }

    const videoChannels = grid.querySelectorAll("ytd-rich-item-renderer");

    let videoIdCounter = 0;
    let videoMetadata = [];

    videoChannels.forEach(video => {
        video.dataset.aiId = (++videoIdCounter).toString();

       const channelElement = video.querySelector(
            ".yt-core-attributed-string__link, .ytd-channel-name .yt-simple-endpoint"
        );

        const titleElement = video.querySelector(".yt-core-attributed-string, ytd-video-renderer"); 
        if (!channelElement && !titleElement) {
            return;
        }

        const channel = channelElement?.textContent.trim().toLowerCase() || "";
        const title = titleElement?.textContent.trim().toLowerCase() || "";

        videoMetadata.push({
            id: videoIdCounter.toString(),
            channelName: channel,
            title: title
        });
    });

    console.log(videoMetadata)
    console.log(constraints)
    // Send request to background script
    chrome.runtime.sendMessage(
        { 
            type: "CALL_AGENT", 
            data: {
                description: constraints, // You can replace dynamically
                videos: videoMetadata
            }
        },
        (response) => {
            console.log("Agent response:", response);

            if (!response || response.error) return;

            response.forEach(({ id, block }) => {
                if (block) {
                    const element = document.querySelector(`[data-ai-id="${id}"]`);
                    if (element) element.remove();
                }
            });
        }
    );
}

async function getStorageData() {
    try {
        if (!chrome.runtime?.id) {
            console.log("Extension context invalidated, stopping script");
            return null;
        }
        
        const result = await chrome.storage.local.get(["constraints", "started"]);
        if(result===undefined) return 
        // Update local isActive flag
        isActive = result.started || false;
        
        if (!isActive) {
            console.log("Scheduler is inactive");
            return null;
        }
        
        console.log(result)
        
        return {
            constraints: result?.constraints || ""
        };
    } catch (error) {
        console.log("Storage access error:", error);
        return null;
    }
}

// // Message listener
// if (chrome.runtime?.id) {
//     chrome.runtime.onMessage.addListener(async (message) => {
//         console.log("Received message:", message);
        
//         if (message.type === "APPLY_FILTERS") {
//             const data = await getStorageData();
//             if (data) {
//                 filterVideos(data.constraints);
//                 // location.reload()
//             }
//         }
        
//         if (message.type === "STOP_FILTERS") {
//             isActive = false;
//             console.log("stop the filter call activated ")
//            location.reload()
//             // showAllVideos();
//             console.log("Showing all videos");
//         }
//     });
// }

// MutationObserver with error handling and debouncing

async function handleMutation() {
    try {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
            console.log("Extension context invalidated, disconnecting observer");
            if (observer) {
                observer.disconnect();
            }
            return;
        }
        if(!storageData){
            storageData=await getStorageData();
        }
        filterVideos(storageData.constraints);
        
    } catch (error) {
        console.log("Filter error:", error);
        if (observer) {
            observer.disconnect();
        }
    }
}
if (chrome.runtime?.id)
{

    const target = document.body;

    observer = new MutationObserver(handleMutation);

    observer.observe(target, {
        childList: true,
        subtree: true
    });
}

// Initialize - check state on load
(async () => {
    if (storageData && isActive) {
        filterVideos(storageData.constraints);
    }
})();

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    console.log("detected storage change", changes, namespace)
    if (namespace === 'local' && changes.started) {
        isActive = changes.started.newValue;
        
        if (!isActive) {
            return 
        } else {
            location.reload();
            // // Reapply filters when scheduler is started
            // getStorageData().then(data => {
            //     if (data) {
            //         storageData=data;
            //         // location.reload()
            //         filterVideos(data.constraints);
            //     }
            // });
        }
    }
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    if (observer) {
        observer.disconnect();
    }
});
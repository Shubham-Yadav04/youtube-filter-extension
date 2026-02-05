/* eslint-disable no-undef */
let userConstraints = null;
let userVector = null;
let scanning=false
async function ensureUserVector() {
  const res = await chrome.storage.local.get("constraints");
  const latestConstraints = res.constraints;

  // Case 1: Nothing stored
  if (!latestConstraints) return;
console.log("have to embedd babby... ")
  // Case 2: First time OR constraint changed
  if (userConstraints !== latestConstraints || !userVector) {
    console.log("Embedding new user constraints...");

    const result = await chrome.runtime.sendMessage({
      type: "EMBED-USER",
      data: [latestConstraints]
    });
console.log(result);
    if (result?.embedding) {
      userVector = result.embedding;
      userConstraints = latestConstraints; // update userConstraints after successful emmbedding
    }
  }
}
ensureUserVector();
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg.action==="STATE_CHANGED" ){
    if(msg?.started){
      console.log(msg.started,"state changes ");
      scanVideos();
    } 
    
  }
})

// checking up the similarity between the user prompt and the current video
export function cosineSimilarity(vecA, vecB) {
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  return dot / (normA * normB);
}
async function scanVideos() {
  console.log("Scanning videos...");
  if (scanning) return;
  scanning = true;

  if (!userVector) {
    scanning = false;
    return;
  }
console.log("User vector ready, processing videos...");
  const videos = Array.from(document.querySelectorAll(
    "ytd-rich-item-renderer, ytd-video-renderer"
  ));

  // Only process new videos
  console.log(videos);
  const unprocessed = videos.filter(v => !v.dataset.checked);

  const texts = unprocessed.map(v => {
    const title = v.querySelector(".yt-lockup-metadata-view-model__heading-reset")?.textContent ?? "";
    const channel = v.querySelector(".yt-lockup-metadata-view-model__metadata a")?.textContent ?? "";
    // console.log("title and channel ",title,channel);
    return `title ${title}  channel name ${channel}`;

  });

  if (texts.length === 0) {
    scanning = false;
    return;
  }

  const { embeddings } = await chrome.runtime.sendMessage({
    type: "EMBED",
    data: texts
  });

  //  loop the embeddings and hide based on the similarty score
  console.log("Embeddings received, evaluating similarity...",embeddings);
  embeddings.forEach((vec, i) => {
    const videoEl = unprocessed[i];   // ← SAME INDEX
    const sim = cosineSimilarity(vec, userVector);

    if (sim < 0.25) {
      console.log(videoEl,"hiding with similarity ",sim);
      videoEl.style.display = "none";  // hide only videos with low similarity 
    }

    videoEl.dataset.checked = "true";
  });

  scanning = false;
}

let scanTimer;

function startObserver(feed) {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;

      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        if (
          node.matches?.("ytd-rich-item-renderer, ytd-video-renderer") ||
          node.querySelector?.("ytd-rich-item-renderer, ytd-video-renderer")
        ) {
          shouldScan = true;
          break;
        }
      }

      if (shouldScan) break;
    }

    if (shouldScan) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scanVideos, 700);
    }
  });

  observer.observe(feed, { childList: true, subtree: true });
}

function waitForFeed() {
  const feed = document.querySelector("ytd-rich-grid-renderer");
  if (feed) startObserver(feed);
  else setTimeout(waitForFeed, 500);
}

waitForFeed();

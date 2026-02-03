/* eslint-disable no-undef */
import { pipeline } from "@xenova/transformers";
let userConstraints = null;
const cache = new Map();
let scanning = false;
let userVector;
const newConstraints= await chrome.storage.local.get(
    "constraints",
  );

if(newConstraints!==userConstraints || userVector){
  userConstraints=newConstraints;
  userVector=  await chrome.runtime.sendMessage({
  type: "EMBED",
  text: userConstraints
});
}
await chrome.runtime.sendMessage({ type: "INIT_EMBEDDER" });

async function embedText(text) {
  if (cache.has(text)) return cache.get(text);

  const output = await embedder(text, {
    pooling: "mean",
    normalize: true,
  });

  const vec = Array.from(output.data);
  cache.set(text, vec);
  return vec;
}

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
  
  if (scanning ) return;
  scanning = true;
 console.log("scanning sdsd");
console.log(userVector);
  if (!userVector) {
    scanning = false;
    return;
  }
 console.log("loaded sdsd");
  const videos = document.querySelectorAll(
    "ytd-rich-item-renderer, ytd-video-renderer"
  );
 
console.log(videos);
  for (const video of videos) {
    if (video.dataset.checked) continue;
    const titleEl = video.querySelector("#video-title");
    const channelEl = video.querySelector("ytd-channel-name");
    if (!titleEl || !channelEl) continue;

    const text = `${titleEl.textContent} ${channelEl.textContent}`;
    const videoVec = await embedText(text);
    const sim = cosineSimilarity(videoVec, ruleVector);

    if (sim < 0.6){
        console.log("hiding ", titleEl.textContent)
video.style.display = "none";
    } 

    video.dataset.checked = "true";
  }
  scanning = false;
}
let timer;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(scanVideos, 800);
});
observer.observe(document.body, { childList: true, subtree: true });

/* eslint-disable no-undef */
import { pipeline, env } from "@xenova/transformers";
env.backends.onnx.wasm.wasmPaths =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = true;
env.allowLocalModels = false;
env.useBrowserCache = true;

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  console.log("reached back")
  if(msg.action==="STATE_CHANGED"){
    // send the event to the current active tab 
    chrome.tabs.query({active:true,currentWindow:true},(tabs)=>{
      console.log(tabs)
      const tabsId= tabs[0].id;
       // reload the tabs so that the content script is loaded in it 
      chrome.tabs.sendMessage(tabsId,msg);
    })
  }
})

let embedder;

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type === "INIT_EMBEDDER") {
  try{
 if (!embedder) {
 embedder = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2",
  { quantized: true }
);
    }
    sendResponse({ status: "ready" });
  }
   catch(error){
    console.log("error while embedding ", error.message);
  }
  }
  

  if (msg.type === "EMBED") {
    const output = await embedder(msg.text, { pooling: "mean", normalize: true });
    sendResponse({ embedding: Array.from(output.data) });
  }

  return true; // keep channel open for async
});

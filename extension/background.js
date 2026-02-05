/* eslint-disable no-undef */
import { pipeline, env } from "@xenova/transformers";
import axios from "axios";
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
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "EMBED-USER") {
    axios.post(`${import.meta.env.VITE_BACKEND_URI}embed-user`, { input: msg.data })
      .then(res => sendResponse({ embedding: res.data.embedding }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === "EMBED") {
    axios.post(`${import.meta.env.VITE_BACKEND_URI}embed`, { input: msg.data })
      .then(res => sendResponse({ embeddings: res.data.embeddings }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
import axios from 'axios'
/* eslint-disable no-undef */
// chrome.runtime.onMessage.addListener((message) => {
//   if (message.type === "START_FILTERING") {
//     console.log("start message recieved ")
//     chrome.tabs.query({ url: "*://www.youtube.com/*" }, (tabs) => {
      
//       tabs.forEach(tab => {
//         console.log(tab.id)
//         console.log("sending message to content ")
//           chrome.tabs.sendMessage(tab.id, { type:"APPLY_FILTERS" });
//       });
//     });
//   }
//   if (message.type ==="STOP_FILTERING") {
//     console.log("stop message recieved ")
//     chrome.tabs.sendMessage(tab.id,{type:"STOP_FILTERS"})
//   }
// });

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  
  if (message.type === "CALL_AGENT") {
    (async () => {
      try {
        const result = await axios.post("http://localhost:5000/filter-videos", message.data);
        console.log(result.data)
        sendResponse(result.data);  // send ONLY data, not axios object
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true; 
  }

})

/* eslint-disable no-undef */

let mlWorker = null;
let qwenWorker = null;
let requestId = 0;

const pendingML = new Map();
const pendingQwen = new Map();

console.log("[Offscreen] Loaded");

function rejectPending(pending, error) {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }

  pending.clear();
}

function createRequest(pending, worker, payload, timeoutMs = 120000) {
  const id = ++requestId;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Worker request ${id} timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve,
      reject,
      timeout,
    });

    try {
      worker().postMessage({
        ...payload,
        requestId: id,
      });
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(error);
    }
  });
}

function attachWorkerHandlers(instance, pending, name, onSuccess) {
  instance.onmessage = (event) => {
    const data = event.data ?? {};
    const request = pending.get(data.requestId);

    if (!request) return;

    pending.delete(data.requestId);
    clearTimeout(request.timeout);

    if (data.error || data.success === false) {
      request.reject(new Error(data.error || `${name} request failed`));
      return;
    }

    try {
      request.resolve(onSuccess(data));
    } catch (error) {
      request.reject(error);
    }
  };

  instance.onerror = (event) => {
    const error = new Error(
      `${name} worker failed: ${event.message || "Unknown worker error"}`
    );

    console.error(`[Offscreen] ${name} worker error`, event);

    rejectPending(pending, error);
    instance.terminate();

    if (name === "ML") mlWorker = null;
    if (name === "Qwen") qwenWorker = null;
  };
}

function getMLWorker() {
  if (!mlWorker) {
    console.log("[Offscreen] Creating MiniLM worker");

    mlWorker = new Worker(
      new URL("./ml-worker.js", import.meta.url),
      { type: "module" }
    );

    attachWorkerHandlers(mlWorker, pendingML, "ML", (data) => {
      if (!Array.isArray(data.embedding)) {
        throw new Error("MiniLM returned an invalid embedding");
      }

      return {
        embedding: data.embedding,
        modelVersion: data.modelVersion,
      };
    });
  }

  return mlWorker;
}

function getQwenWorker() {
  if (!qwenWorker) {
    console.log("[Offscreen] Creating Qwen worker");

    qwenWorker = new Worker(
      new URL("./qwen-worker.js", import.meta.url),
      { type: "module" }
    );

    attachWorkerHandlers(qwenWorker, pendingQwen, "Qwen", (data) => {
      if (!Array.isArray(data.anchors)) {
        throw new Error("Qwen returned an invalid anchors array");
      }

      return { anchors: data.anchors };
    });
  }

  return qwenWorker;
}

function runEmbedding(text) {
  return createRequest(
    pendingML,
    getMLWorker,
    { type: "EMBED", text }
  );
}

function runQueryExpansion(requirement) {
  return createRequest(
    pendingQwen,
    getQwenWorker,
    { requirement ,wasmPaths: chrome.runtime.getURL("ort-qwen/") },
    180000
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_EMBED") {
    runEmbedding(message.text)
      .then((result) => {
        sendResponse({
          success: true,
          requestId: message.requestId,
          ...result,
        });
      })
      .catch((error) => {
        console.error("[Offscreen] MiniLM request failed", error);

        sendResponse({
          success: false,
          requestId: message.requestId,
          error: error.message,
        });
      });

    return true;
  }

  if (message.type === "OFFSCREEN_EXPAND_QUERY") {
    runQueryExpansion(message.requirement)
      .then((result) => {
        console.log("[Offscreen] Qwen generated anchors", result.anchors);

        sendResponse({
          success: true,
          requestId: message.requestId,
          ...result,
        });
      })
      .catch((error) => {
        console.error("[Offscreen] Qwen request failed", error);

        sendResponse({
          success: false,
          requestId: message.requestId,
          error: error.message,
        });
      });

    return true;
  }
});
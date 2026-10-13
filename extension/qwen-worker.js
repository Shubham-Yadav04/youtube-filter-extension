
import { pipeline, env } from "@huggingface/transformers";
import {
  StructuredOutputProcessor,
} from "@huggingface/transformers-structured-output";
env.allowLocalModels = false;
env.useBrowserCache = true;
const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
let generatorPromise;
// env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort-qwen/");
function getGenerator() {
  if (!generatorPromise) {
    generatorPromise = pipeline("text-generation", MODEL_ID, {
      dtype: "q4",
    }).catch((error) => {
      generatorPromise = null;
      throw error;
    });
  }

  return generatorPromise;
}

function extractText(output) {
  const generated = output?.[0]?.generated_text;

  if (typeof generated === "string") {
    return generated;
  }

  if (Array.isArray(generated)) {
    const assistantMessage = [...generated]
      .reverse()
      .find((message) => message.role === "assistant");

    if (typeof assistantMessage?.content === "string") {
      return assistantMessage.content;
    }
  }
  if (typeof generated === "string") {
    return generated;
  }

  throw new Error("Unexpected Qwen output format");
}

function parseAnchors(text) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end <= start) {
    throw new Error("Qwen did not return valid JSON");
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1));

  if (
    !Array.isArray(parsed.anchors) ||
    parsed.anchors.length < 5 ||
    parsed.anchors.length > 8 ||
    !parsed.anchors.every(
      (item) => typeof item === "string" && item.trim().length > 0
    )
  ) {
    throw new Error("Qwen returned invalid anchors");
  }

  return [...new Set(parsed.anchors.map((item) => item.trim()))];
}

async function expandQuery(requirement) {
  if (!requirement?.trim()) {
    throw new Error("Viewing requirement cannot be empty");
  }

  const model = await getGenerator();
const processor = new StructuredOutputProcessor(
  model.tokenizer,
  {
    type: "json_schema",
    json_schema: {
      type: "object",
      properties: {
        anchors: {
          type: "array",
          items: {
            type: "string",
          },
          minItems: 7,
          maxItems: 8,
        },
      },
      required: ["anchors"],
      additionalProperties: false,
    },
  }
);
  const messages = [
    {
      role: "system",
      content: `You expand user viewing requirements into semantic
search queries for a YouTube content filter.

Return only valid JSON with this schema:
{"anchors":["query 1","query 2"]}

Generate 7 or 8 distinct, useful queries.
Preserve the user's intended scope.
Cover relevant subtopics without adding unrelated topics.
Use concise natural-language descriptions of video content.
Do not include explanations outside the JSON.`,
    },
    {
      role: "user",
      content: `Expand this viewing requirement:\n${requirement}`,
    },
  ];

  const output = await model(messages, {
    do_sample: false,
    logits_processor: processor,
  });
console.log("[Qwen] Raw output:", output);
const text= extractText(output);
console.log("[Qwen] Extracted text:", text);
  return parseAnchors(text);
}

self.addEventListener("message", async (event) => {
  const { requestId, requirement ,wasmPaths} = event.data ?? {};

  try {
    if (wasmPaths) { env.backends.onnx.wasm.wasmPaths = wasmPaths; }
    const anchors = await expandQuery(requirement);

    self.postMessage({
      requestId,
      success: true,
      anchors,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
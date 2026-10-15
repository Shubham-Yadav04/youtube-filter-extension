# Focus Filter --- YouTube Semantic Content Filter

> Focus Filter is a local-first Chrome Manifest V3 extension that
> estimates whether YouTube videos match a user's natural-language
> viewing requirement. It expands the requirement into semantic anchors,
> embeds the anchors and video titles, compares them using cosine
> similarity, and caches reusable results.

## Table of contents

1.  [Project goal](#1-project-goal)
2.  [Architecture decisions](#2-architecture-decisions)
3.  [Final architecture](#3-final-architecture)
4.  [Chrome extension concepts](#4-chrome-extension-concepts)
5.  [Offscreen document](#5-offscreen-document)
6.  [Chrome APIs by context](#6-chrome-apis-by-context)
7.  [ML pipeline](#7-ml-pipeline)
8.  [Classification logic](#8-classification-logic)
9.  [Storage and cache design](#9-storage-and-cache-design)
10. [Message flow and lifecycle](#10-message-flow-and-lifecycle)
11. [Concurrency and performance](#11-concurrency-and-performance)
12. [Manifest, CSP, Vite and ONNX
    Runtime](#12-manifest-csp-vite-and-onnx-runtime)
13. [Errors and debugging](#13-errors-and-debugging)
14. [Development workflow](#14-development-workflow)
15. [Limitations and stability
    checklist](#15-limitations-and-stability-checklist)
16. [Glossary](#16-glossary)

------------------------------------------------------------------------

## 1. Project goal

The extension lets a user enter a broad requirement such as:

> Only show coding-related videos: DSA, system design, Spring Boot,
> Python, Tailwind, load balancing and AWS.

Exact keyword matching is insufficient: a relevant video can use
different wording, while an irrelevant video can mention a keyword.
Focus Filter therefore uses semantic embeddings to estimate textual
relevance.

### Goals

-   Accept natural-language requirements.
-   Expand broad requirements into multiple short semantic anchors.
-   Run inference locally in the browser rather than calling a paid
    inference API for every classification.
-   Cache embeddings and decisions to reduce repeated work.
-   Keep settings local and avoid requiring a user account.
-   Integrate with YouTube through a content script.

**Scope note:** the implementation documented here embeds video titles
formatted like `Title: ...`. Transcript extraction/classification is not
confirmed as implemented and should not be assumed to be part of the
current pipeline.

## 2. Architecture decisions

  -----------------------------------------------------------------------
  Decision                            Reason
  ----------------------------------- -----------------------------------
  Manifest V3                         Uses Chrome's modern extension
                                      architecture and event-driven
                                      background service worker.

  Local inference                     Avoids per-classification hosted
                                      inference costs and can keep text
                                      processing on-device.

  Semantic embeddings                 Better suited than exact keywords
                                      for matching related wording.

  `Xenova/all-MiniLM-L6-v2`           Compact embedding model producing
                                      384-dimensional vectors, practical
                                      for CPU-oriented text matching.

  Separate Qwen worker                Uses a language model to expand the
                                      user's broad requirement into
                                      several semantic anchors.

  Offscreen document                  Provides an extension-owned
                                      document context to manage
                                      inference workers separately from
                                      the service worker and YouTube
                                      page.

  Web Workers                         Keeps expensive model inference off
                                      the main JavaScript thread.

  `chrome.storage.local` for settings Appropriate for small persistent
                                      configuration.

  IndexedDB for caches                Better for structured records such
                                      as many video embeddings and
                                      decisions.

  Cache reuse                         Avoids recomputing embeddings and
                                      classifications for unchanged
                                      inputs.

  Preserve strict CSP                 Avoids weakening extension security
                                      just to hide worker-loading
                                      problems.
  -----------------------------------------------------------------------

Why not ask a generative model to classify every video? Repeated
generative inference can be expensive and slow on a CPU-only laptop. The
chosen split uses Qwen for requirement expansion, MiniLM for embeddings,
and inexpensive cosine similarity for repeated comparisons. This is a
trade-off, not a guarantee that embeddings are always more accurate than
a cross-encoder.

## 3. Final architecture

``` mermaid
flowchart TD
    U[User] --> P[React Popup]
    P -->|chrome.runtime messaging| B[Background Service Worker]
    Y[YouTube page] --> C[Content Script]
    C -->|chrome.runtime messaging| B
    B --> S[chrome.storage.local]
    B --> DB[(IndexedDB: YTFilterDB)]
    B --> O[Offscreen Document]
    O --> Q[Qwen Web Worker]
    O --> M[MiniLM Web Worker]
    Q -->|semantic anchors| O
    M -->|384-D embeddings| O
    O --> B
    B --> C
    C -->|apply decision| Y
```

This is the logical architecture; exact message names and function
boundaries may evolve.

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  React popup                         User interface for filtering state,
                                      requirement and settings.

  Content script                      Runs on YouTube, observes
                                      video/page changes, requests
                                      classifications and applies
                                      decisions to the DOM.

  Background service worker           Coordinates extension messages,
                                      reads settings, orchestrates
                                      classification, storage and
                                      offscreen-document setup.

  Offscreen document                  Hidden extension-owned page that
                                      starts/manages ML workers and
                                      bridges messages between the
                                      background and workers.

  Qwen worker                         Expands the natural-language
                                      requirement into roughly 7--8
                                      semantic anchor phrases.

  MiniLM worker                       Embeds anchor phrases and video
                                      titles into 384-dimensional
                                      vectors.

  `classifier.js`                     Retrieves/computes embeddings,
                                      calculates similarity and applies
                                      decision logic.

  `setting.js`                        Encapsulates settings operations in
                                      `chrome.storage.local`.

  `db.js`                             Encapsulates IndexedDB operations
                                      for video decisions, statistics and
                                      embedding caches.
  -----------------------------------------------------------------------

### Typical classification path

1.  The popup saves a requirement and settings through extension
    messaging.
2.  The content script detects a video that needs a decision and asks
    the background worker to classify it.
3.  The classifier checks the policy/anchor embedding cache.
4.  On a cache miss, the requirement is sent to Qwen for expansion into
    anchors.
5.  Each anchor is sent to MiniLM for embedding.
6.  The video title is embedded unless its vector is already cached.
7.  The classifier compares the title vector with each anchor vector.
8.  It derives a score and applies the configured decision policy.
9.  Embeddings and decisions are cached in IndexedDB.
10. The decision returns to the content script, which applies the
    appropriate YouTube UI behavior.

## 4. Chrome extension concepts

### 4.1 Manifest V3

`manifest.json` declares the extension's name, permissions, popup,
background service worker, content scripts, host access and Content
Security Policy. MV3 uses an event-driven service worker rather than a
permanently running background page.

Request only the permissions actually needed. For example, `scripting`
is relevant if the extension programmatically injects scripts; a
statically declared content script does not need it merely because it
exists.

### 4.2 Background service worker

The service worker is the extension's coordinator. It handles events and
messages, reads settings and invokes classification. It is **not** a
permanently running Node.js process: Chrome can stop it while idle and
start it again later.

Consequences: - Persistent state belongs in storage/IndexedDB, not only
global variables. - Message handlers must tolerate worker restarts. -
Long-running model inference is a poor fit for the service worker. -
In-memory caches may disappear when the worker stops.

The worker can access supported extension APIs such as `chrome.runtime`
and `chrome.storage`, subject to API-specific restrictions and manifest
permissions. It has no DOM.

### 4.3 Content script

A content script runs on matching web pages---in this case, YouTube. It
can inspect and modify the DOM, observe page changes and communicate
with extension contexts using `chrome.runtime` messaging.

It has an isolated JavaScript world, so its variables are separated from
YouTube's page-script variables, but it can still interact with the page
DOM. Use it for page integration, not heavy inference.

### 4.4 Popup

The popup is the React UI opened from the extension toolbar. It is
short-lived and can close when the user clicks elsewhere. Important
settings should not live only in React state; persist them in
`chrome.storage.local`.

### 4.5 Extension pages and origin

The popup and offscreen document are extension-owned pages, typically
served from a `chrome-extension://...` origin. They differ from content
scripts running on a YouTube page. This matters for resource paths, CSP
and API availability.

### 4.6 Web Workers

A Web Worker executes JavaScript in a separate worker context, keeping
expensive computation off the main thread. Workers communicate with
their owner using `postMessage()` and message events.

Workers do not have DOM access. Do not assume that every `chrome.*`
extension API is exposed inside a worker. In this design, the worker
performs inference while the offscreen document/background handles
extension coordination.

### 4.7 Message passing

Different extension contexts do not share ordinary JavaScript variables.
They communicate through explicit messages: -
`chrome.runtime.sendMessage(...)` / `chrome.runtime.onMessage`; -
`postMessage(...)` between a worker and its owner.

Treat messages as a protocol: define a type, payload, response shape and
error behavior. Long-running requests need timeouts, but timeouts must
be realistic for cold model initialization.

## 5. Offscreen document

### What is it?

An **offscreen document** is a hidden extension document created through
Chrome's Offscreen API. It loads an extension HTML page without opening
a normal visible tab/window. The project uses an
`offscreen.html`/`offscreen.js` page as the inference bridge.

The background worker can create it with
`chrome.offscreen.createDocument(...)`, specifying a supported reason
such as `WORKERS` and a justification for the work. The exact reason
must be valid for the Chrome API version targeted.

### Why it is needed here

The background service worker is event-driven and may be terminated
while idle. The content script is coupled to the YouTube page. The
offscreen document provides a dedicated extension-owned document context
to initialize and manage the inference workers without placing model
execution directly in either of those contexts.

Its role is to: 1. Receive inference requests from the background. 2.
Forward requirement-expansion requests to Qwen. 3. Forward embedding
requests to MiniLM. 4. Match worker responses to pending requests. 5.
Return results or useful errors to the background.

### Why two workers?

-   Qwen handles natural-language expansion.
-   MiniLM handles embeddings.

This separates model responsibilities and runtime configuration. It does
not eliminate memory or CPU costs: both model runtimes may consume
resources, so avoid loading duplicate instances.

### Lifecycle concerns

The offscreen document is not a magic permanent process. Check whether
it already exists before creating it, wait until its message
handlers/workers are ready, handle worker crashes and timeouts, and
avoid duplicate documents. Chrome still manages document and worker
lifetimes.

## 6. Chrome APIs by context

Availability depends on the exact API, Chrome version, permissions and
execution context.

  -----------------------------------------------------------------------
  Context                 Typical capabilities    Limitations
  ----------------------- ----------------------- -----------------------
  Popup / extension page  Supported extension     UI is temporary.
                          APIs such as            
                          `chrome.runtime` and    
                          `chrome.storage`        

  Background service      Extension events and    No DOM; can be stopped
  worker                  permitted `chrome.*`    and restarted.
                          APIs                    

  Content script          Runtime messaging,      Not every extension API
                          limited extension APIs  is exposed directly.
                          and page DOM access     

  Offscreen document      DOM APIs and supported  Hidden document with
                          extension APIs needed   restricted API
                          for its purpose         availability; not a
                                                  universal replacement
                                                  for other contexts.

  Web Worker              Standard worker APIs    No DOM; do not assume
                          and model/runtime code  `chrome.*` access.

  YouTube page scripts    Normal web APIs for the Not an extension
                          page                    context; do not treat
                                                  page scripts as trusted
                                                  extension code.
  -----------------------------------------------------------------------

Rule of thumb: - YouTube DOM → content script. - Extension
events/settings/coordination → service worker and storage. - Hidden
document to manage inference workers → offscreen document. - CPU-heavy
inference → Web Workers. - Small configuration →
`chrome.storage.local`. - Larger structured caches → IndexedDB.

## 7. ML pipeline

### 7.1 Qwen requirement expansion

A broad requirement can be represented by multiple short semantic
anchors. The Qwen worker produces approximately 7--8 phrases that cover
different aspects of the user's intent.

Illustrative output:

``` json
{
  "anchors": [
    "Java and Spring Boot backend development",
    "data structures and algorithm problem solving",
    "distributed systems and system design",
    "cloud infrastructure and AWS"
  ]
}
```

This is an example, not a promise of exact output. Validate the model
response: require an array of non-empty strings, cap the count/length,
and handle malformed JSON or an empty response.

### 7.2 MiniLM embeddings

The project uses `Xenova/all-MiniLM-L6-v2` through
`@xenova/transformers@2.17.2` in `ml-worker.js`.

An embedding is a numeric vector representing text such that
semantically related text tends to have similar vector directions. This
model produces **384-dimensional vectors**. It does not directly return
a relevant/irrelevant label.

### 7.3 Model responsibilities

  Stage               Input                       Output
  ------------------- --------------------------- -------------------------
  Qwen                User requirement            Anchor strings
  MiniLM              One text string             384-dimensional vector
  Cosine similarity   Two vectors                 Scalar similarity score
  Classifier          Similarity score + policy   Application decision

Qwen need not run for every video if anchors are cached. MiniLM embeds
anchors on a cache miss and embeds uncached video titles.

### 7.4 Local inference

Local inference means the model runs on the user's device rather than
sending each classification to a hosted inference API. Model files may
still need to be downloaded or packaged. Local inference does not by
itself guarantee offline operation: model downloads and other extension
resources may use the network.

## 8. Classification logic

### 8.1 Cache requirement embeddings

The classifier uses a key based on model version and policy hash,
conceptually:

``` js
const cacheKey = [MODEL_VERSION, settings.policyHash].join(":");
```

On a hit, it returns the stored anchor embeddings. On a miss, it expands
the requirement, embeds each anchor, stores the result and returns it.
The writer and reader must agree on the property name---for example,
`record.embeddings`.

A cache record can contain:

``` js
{
  embeddings,
  modelVersion,
  policyHash,
  createdAt
}
```

### 8.2 Embed the video title

The current text format is similar to:

``` js
const text = `Title: ${video.title || ""}`;
```

The resulting vector can be cached by video ID and model version. If
title metadata can change, invalidate the cached vector or include a
normalized title hash in the key.

### 8.3 Cosine similarity

For vectors (a) and (b):

\[ `\operatorname{cosine}`{=tex}(a,b)=
`\frac{a\cdot b}{\|a\|\|b\|}`{=tex} \]

Validate that vectors are non-empty, have equal dimensions and contain
valid numeric values. Handle zero-magnitude vectors to avoid division by
zero.

Cosine similarity is **not a calibrated probability**. A score of 0.4
does not mean a 40% probability of relevance.

### 8.4 Maximum-anchor score

The current approach uses the maximum similarity between a title vector
and all anchor vectors:

\[
`\operatorname{score}`{=tex}(v)=`\max`{=tex}\_{a`\in `{=tex}A}`\operatorname{cosine}`{=tex}(E(v),E(a))
\]

Here (v) is a video title, (A) is the anchor set and (E) is the
embedding function.

This is useful when any one anchor can express relevance, but a weakly
related anchor can also create false positives. Evaluate it on
representative examples.

### 8.5 Thresholds

The current classifier discussion has used a threshold around `0.2`;
earlier experiments also used separate allow/block thresholds. These are
tunable settings, not universal MiniLM values. The correct threshold
depends on the text format, anchors, model version and desired
false-positive/false-negative trade-off.

Create a small labelled test set of relevant and irrelevant titles and
tune the threshold. If the product supports an uncertain state, use it
for borderline scores instead of treating every score as definitive.

## 9. Storage and cache design

### 9.1 `chrome.storage.local` --- settings

Use it for small persistent configuration, such as: - enabled/disabled
state; - natural-language requirement; - filtering mode and
thresholds; - allow/deny lists, if enabled; - policy/version metadata.

`setting.js` encapsulates settings operations. The popup should
communicate changes through messages rather than assuming it shares
variables with the background worker.

### 9.2 IndexedDB --- application records

The project has used an IndexedDB database named `YTFilterDB`, with
operations wrapped in `db.js`. It is suitable for: - video embeddings; -
classification decisions; - policy/anchor embedding records; - filter
statistics.

IndexedDB is asynchronous and supports object stores/indexes, making it
more suitable than one settings object for many cache records.

### 9.3 Why split storage?

Settings are small configuration. IndexedDB stores potentially many
structured records. This separation also makes it possible to clear
video caches without accidentally resetting user settings.

### 9.4 Cache invalidation

A cached result is only valid for the model and policy that created it.
The design has used cache-key components such as video ID, model version
(for example, `minilm-l6-v2`) and policy hash/version.

A policy hash must change when any setting that affects classification
changes. If thresholds or allow/deny lists affect decisions but are not
included in the hash, invalidate decisions separately or include those
settings in the appropriate key. Never compare vectors generated by
incompatible models.

### 9.5 IndexedDB deletion during development

Manually deleting a database while a connection is open can cause errors
such as:

`InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.`

Recovery: 1. Close/reload the YouTube tab and extension pages using the
database. 2. Reload the extension. 3. Reopen the page and let
initialization run again. 4. Ensure `db.js` closes connections on
`versionchange` and does not reuse a cached promise for a closed
connection. 5. Avoid deleting the database while active code is using
it.

## 10. Message flow and lifecycle

### Popup → background

The popup sends messages to save settings, toggle filtering, request
stats or reset stats. The background validates the request and calls
`setting.js` or `db.js`.

### Content script → background

The content script detects videos and asks for classification. The
background reads current settings, checks cached decisions and invokes
the classifier if necessary.

### Background → offscreen document

The background ensures the offscreen document exists and sends inference
requests. Message types used in the project include
`OFFSCREEN_EXPAND_QUERY` and `OFFSCREEN_EMBED`.

### Offscreen document ↔ workers

The bridge should correlate each request with a request ID and pending
promise. It should remove pending entries on success, failure or
timeout, and reject pending work if a worker crashes. Include worker
name, operation and error details in logs.

Model initialization/cold downloads can take longer than ordinary
embedding requests, so use realistic timeouts and distinguish
initialization from inference where practical.

## 11. Concurrency and performance

### Cache embeddings as well as decisions

Two separate results are reusable: 1. Requirement anchor embeddings,
reused while the policy is unchanged. 2. Video title
embeddings/decisions, reused when the same video appears again.

### Deduplicate requirement expansion

When a page contains many videos, concurrent classifications can all
miss the same policy cache and start Qwen expansion independently. A
per-cache-key in-flight promise map can ensure only one
expansion/embedding operation runs for a given policy at a time:

``` js
const requirementPromises = new Map();

async function getRequirementEmbedding(settings) {
  const key = [MODEL_VERSION, settings.policyHash].join(":");
  const cached = await getPolicyEmbedding(key);
  if (cached) return cached.embeddings;

  if (requirementPromises.has(key)) {
    return requirementPromises.get(key);
  }

  const promise = (async () => {
    const anchors = await expandRequirementToAnchors(settings.userRequirement);
    const embeddings = [];

    for (const anchor of anchors) {
      const result = await runEmbedding(anchor);
      embeddings.push(Array.from(result.embedding));
    }

    await savePolicyEmbedding(key, {
      embeddings,
      modelVersion: MODEL_VERSION,
      policyHash: settings.policyHash,
      createdAt: Date.now()
    });

    return embeddings;
  })();

  requirementPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    requirementPromises.delete(key);
  }
}
```

Adapt this pattern to the actual code. It is a recommended pattern, not
a claim that every line is already implemented.

### Limit concurrent classifications

`Promise.all(videos.map(classifyVideo))` can overload a CPU-only device
or queue too many requests against one worker. Use a small concurrency
limit and measure performance. More simultaneous inference requests do
not necessarily mean faster inference.

Recommended principles: - expand each policy once; - embed anchors once
per policy; - reuse video vectors; - limit parallel classifications; -
ensure failed requests do not leave pending promises.

## 12. Manifest, CSP, Vite and ONNX Runtime

### 12.1 Content Security Policy

CSP restricts which scripts/resources may execute. Chrome extension
pages have stricter policies than ordinary websites.

The project has used a policy similar to:

``` json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Check the actual manifest against the targeted Chrome version.
`'wasm-unsafe-eval'` permits WebAssembly compilation in applicable
contexts; it does **not** permit arbitrary JavaScript execution from
`blob:` URLs.

Do not add `unsafe-eval` or relax CSP blindly to hide worker errors.
Identify the exact script that fails and fix the bundler/runtime asset
path or worker configuration.

### 12.2 Vite worker bundling

Vite can transform worker imports into generated chunks or blob-backed
workers. A worker setup that works in a regular web app can behave
differently under an extension's CSP and URL rules.

When debugging: 1. Inspect the built extension output, not only source
files. 2. Identify the exact URL passed to `importScripts()`. 3.
Determine whether it originates from Vite, ONNX Runtime or another
dependency. 4. Verify referenced JS and WASM files exist in the packaged
output. 5. Verify the runtime asset paths point to the right folder. 6.
Keep each ML stack paired with its compatible ONNX Runtime.

### 12.3 Two ONNX Runtime dependency trees

The project has two ML stacks: - `@xenova/transformers@2.17.2` for
MiniLM, with an older ONNX Runtime dependency; -
`@huggingface/transformers@4.3.1` for Qwen, with a separate newer ONNX
Runtime dependency.

Do not accidentally make one worker load the other stack's runtime
files. Their APIs, runtime versions and WASM assets may differ.

The project has used separate public asset folders such as `public/ort/`
and `public/ort-qwen/`. If retained, verify that each worker's
`wasmPaths` points to the matching directory and that copied assets
match the installed package version. Copying files alone does not
guarantee compatibility.

### 12.4 `importScripts(blob:...)` failure

An error like:

`Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'blob:chrome-extension://...' failed to load`

means a worker tried to load another script and the browser could not
load it. Possible causes include CSP restrictions, an unavailable
generated blob URL, bundler transformation or runtime worker
configuration. The message alone does not identify which cause is
responsible.

One diagnostic to test in the Xenova worker, before pipeline
initialization, is:

``` js
import { pipeline, env } from "@xenova/transformers";

env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;
```

Verify these settings against the exact installed version. This is a
diagnostic, not a guaranteed fix. If the error remains, inspect the
built worker and dependency code to locate the failing `importScripts()`
call.

### 12.5 WASM assets

ONNX Runtime Web may need WebAssembly files. Verify: - file names and
versions match the runtime package; - paths resolve to packaged
extension resources; - the build includes the files; - the extension was
reloaded after rebuilding; - logs show the first failure, not only
downstream errors.

## 13. Errors and debugging

### `Uncaught [object ErrorEvent]`

This is a low-detail worker error report, not a root-cause explanation.
Log the worker name, operation, `message`, `filename`, `lineno`, `colno`
and `error` fields where available.

### `Extension context invalidated`

This often happens when a content script continues running after the
extension was reloaded or updated. Its old extension context is no
longer valid.

Development recovery: 1. Rebuild if needed. 2. Open
`chrome://extensions`. 3. Reload the extension. 4. Reload the YouTube
tab to replace its old content script. 5. Reproduce and inspect fresh
logs.

If it happens without a reload, inspect navigation, message lifecycle
and async work that outlives its context.

### Worker request timeout

Possible causes include slow model initialization, missing assets, a
crashed worker, queued requests or incorrect request/response ID
handling. A timeout is a symptom, not a root cause. Log request type/ID,
worker readiness, elapsed time and the underlying error. Remove
timed-out pending entries and handle late responses safely.

### IndexedDB connection closing

If the database was manually deleted while open, reload extension pages
and the YouTube tab, then allow the DB wrapper to initialize it again.
Ensure closed connections are not reused.

### Debug checklist

-   [ ] Test after a clean extension reload and YouTube tab reload.
-   [ ] Inspect service worker and offscreen document consoles
    separately.
-   [ ] Listen for worker `error` and `messageerror`.
-   [ ] Find the first error in time; later messages may be
    consequences.
-   [ ] Verify model and WASM assets exist in the built extension.
-   [ ] Confirm each model uses the correct ONNX Runtime assets.
-   [ ] Test a single video, then a batch.
-   [ ] Test cold start separately from cache-hit/warm inference.
-   [ ] Ensure inference failure cannot silently become an incorrect
    "allow" decision.

## 14. Development workflow

1.  Install dependencies using the repository's package manager and
    lockfile.
2.  Run the build/development script defined in `package.json`.
3.  Open `chrome://extensions`, enable Developer mode and choose **Load
    unpacked** for the built extension directory.
4.  After code changes, rebuild if needed and reload the extension.
5.  Reload the YouTube tab so its content script uses the current
    extension.
6.  Inspect popup, service worker, offscreen document and worker logs
    independently.

Use the scripts actually declared in `package.json`; names can differ by
repository. Avoid editing generated build files as a permanent fix. Make
changes in source/configuration, rebuild and verify the output. If
runtime assets live under `public/`, confirm they appear in the built
extension.

## 15. Limitations and stability checklist

### Limitations

-   The documented classifier currently operates on titles; transcript
    classification is not confirmed.
-   Similarity scores are not calibrated probabilities.
-   Anchor quality depends on Qwen output and validation.
-   Maximum-over-anchors can produce false positives from a loosely
    related anchor.
-   Local inference can still use significant CPU and memory.
-   MV3 service workers/offscreen documents have lifecycle constraints.
-   CSP, Vite worker bundling and ONNX Runtime paths must be tested in
    the built extension.
-   A worker `importScripts(blob:...)` error is a reliability issue
    until its cause and impact are understood.

### Before calling it stable

-   [ ] Settings persist after closing/reopening the popup.
-   [ ] Filtering state persists as intended.
-   [ ] Policy changes invalidate affected embeddings/decisions.
-   [ ] Repeated videos reuse cached data.
-   [ ] Cold model initialization succeeds.
-   [ ] Warm inference succeeds repeatedly.
-   [ ] Batch classification does not duplicate requirement expansion.
-   [ ] Worker failures reject pending requests cleanly.
-   [ ] Failures cannot silently produce misleading decisions.
-   [ ] The extension works after a browser restart.
-   [ ] No stale context-invalidated errors occur after a clean reload.
-   [ ] Both model stacks load compatible, separate ONNX Runtime assets.
-   [ ] CSP remains valid without unsafe relaxations.
-   [ ] Accuracy has been checked against labelled relevant/irrelevant
    titles.

## 16. Glossary

  -----------------------------------------------------------------------
  Term                                Meaning
  ----------------------------------- -----------------------------------
  Manifest V3                         Chrome extension platform model
                                      used by the project.

  Service worker                      Event-driven background context
                                      that coordinates extension work.

  Content script                      Script running on YouTube pages
                                      that observes/modifies the DOM.

  Popup                               React interface opened from the
                                      extension toolbar.

  Offscreen document                  Hidden extension-owned document
                                      used here to manage inference
                                      workers.

  Web Worker                          Separate JavaScript context for
                                      inference, without DOM access.

  `chrome.runtime`                    Extension API used for messaging
                                      and lifecycle-related
                                      functionality.

  `chrome.storage.local`              Persistent local storage for
                                      settings.

  IndexedDB                           Browser database for structured
                                      local records and caches.

  Embedding                           Numeric vector representation of
                                      text for semantic comparison.

  384-dimensional vector              Embedding with 384 numeric
                                      components.

  Semantic anchor                     Short phrase representing one
                                      aspect of the user's requirement.

  Cosine similarity                   Vector similarity measure used to
                                      estimate semantic closeness.

  Threshold                           Configurable score boundary used to
                                      make a decision.

  Cache key                           Identifier for looking up a stored
                                      result.

  Policy hash                         Fingerprint of settings affecting
                                      classification; it must change when
                                      relevant inputs change.

  CSP                                 Content Security Policy restricting
                                      script/resource execution.

  WASM                                WebAssembly, used by ONNX Runtime
                                      Web for model inference.

  ONNX Runtime Web                    Runtime that executes ONNX models
                                      in browser environments.

  Vite                                Build tool that bundles source code
                                      and assets.

  Cold start                          First run requiring model/runtime
                                      initialization and asset loading.

  Cache hit/miss                      Whether a requested result is
                                      already stored.

  In-flight promise deduplication     Sharing one pending computation
                                      among callers requesting the same
                                      result.

  False positive                      Irrelevant video classified as
                                      relevant.

  False negative                      Relevant video classified as
                                      irrelevant.
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## Final architecture summary

Focus Filter separates page integration, extension coordination,
inference and persistence:

-   **Content script:** works with the YouTube DOM.
-   **Popup:** captures user settings.
-   **Background service worker:** coordinates messages, settings and
    classification.
-   **Offscreen document:** bridges extension messaging and inference
    workers.
-   **Qwen worker:** expands the requirement into semantic anchors.
-   **MiniLM worker:** embeds anchors and video titles into
    384-dimensional vectors.
-   **Classifier:** computes cosine similarity and applies decision
    logic.
-   **`chrome.storage.local`:** persists settings.
-   **IndexedDB:** caches embeddings, decisions and statistics.

The central design principle is to put each job in the browser context
suited to it, and to treat worker lifecycle, model loading, CSP, storage
and cache invalidation as core parts of the architecture.

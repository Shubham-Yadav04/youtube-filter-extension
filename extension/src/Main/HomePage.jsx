import { useState, useEffect } from "react";
import {
  validateIntent,
  normalizeIntent,
  parseUserTopicIntent
} from "../../classifier.js";

export default function HomePage() {
  const [started, setStarted] = useState(true);
  const [mode, setMode] = useState("RESTRICTED"); // RESTRICTED (BLOCK) vs FOCUS (ALLOW_ONLY)
  const [topicsInput, setTopicsInput] = useState("");
  const [allowThreshold, setAllowThreshold] = useState(0.35);
  const [blockThreshold, setBlockThreshold] = useState(0.40);
  const [semanticWeight, setSemanticWeight] = useState(0.75);

  const [allowlist, setAllowlist] = useState("");
  const [denylist, setDenylist] = useState("");

  const [stats, setStats] = useState({ blocked: 0, allowed: 0, uncertain: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    // Load stored settings & stats
    chrome.storage.local.get([
      "started", "mode", "topics", "constraints",
      "allowThreshold", "blockThreshold", "semanticWeight",
      "allowlist", "denylist", "yt_filter_stats"
    ], (res) => {
      if (res.started !== undefined) setStarted(!!res.started);
      if (res.mode) setMode(res.mode);

      const rawTopics = res.topics ?? res.constraints;
      if (rawTopics) {
        setTopicsInput(Array.isArray(rawTopics) ? rawTopics.join("\n") : rawTopics);
      } else {
        setTopicsInput("want only coding related videos either DSA , system design or other coding related videos");
        setMode("FOCUS");
      }

      if (res.allowThreshold !== undefined) setAllowThreshold(res.allowThreshold);
      if (res.blockThreshold !== undefined) setBlockThreshold(res.blockThreshold);
      if (res.semanticWeight !== undefined) setSemanticWeight(res.semanticWeight);

      if (res.allowlist) setAllowlist(Array.isArray(res.allowlist) ? res.allowlist.join("\n") : res.allowlist);
      if (res.denylist) setDenylist(Array.isArray(res.denylist) ? res.denylist.join("\n") : res.denylist);

      if (res.yt_filter_stats) setStats(res.yt_filter_stats);
    });

    // Fetch stats periodically
    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: "GET_STATS" }, (res) => {
        if (res?.stats) setStats(res.stats);
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const showToast = (msg, type = "success") => {
    setToastMessage({ text: msg, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleTopicsTextChange = (text) => {
    setTopicsInput(text);
    const lower = text.toLowerCase();
    if (
      lower.includes("want only") ||
      lower.includes("only allow") ||
      lower.includes("only show") ||
      lower.includes("allow only") ||
      lower.includes("show only") ||
      lower.includes("only want")
    ) {
      setMode("FOCUS");
    }
  };

  // Master switch toggle: NO INTENT COMPILATION ON TOGGLE!
  const handleToggle = () => {
    const nextStarted = !started;
    setStarted(nextStarted);
    chrome.storage.local.set({ started: nextStarted });
    chrome.runtime.sendMessage({ action: "STATE_CHANGED", started: nextStarted });
  };

  // Owns Intent Compilation on Save
  const handleSave = async () => {
    setIsCompiling(true);

    const topicsArr = topicsInput.split("\n").map(s => s.trim()).filter(Boolean);
    const allowArr = allowlist.split("\n").map(s => s.trim().toLowerCase()).filter(Boolean);
    const denyArr = denylist.split("\n").map(s => s.trim().toLowerCase()).filter(Boolean);
    const effectiveMode = mode === "FOCUS" ? "ALLOW_ONLY" : "BLOCK";

    let finalCompiledIntent = null;
    let compilationSuccess = false;

    try {
      const response = await fetch("http://localhost:8000/compile-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: topicsInput, mode: effectiveMode }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && validateIntent(data.compiledIntent)) {
          finalCompiledIntent = normalizeIntent(data.compiledIntent);
          compilationSuccess = true;
        }
      }
    } catch (err) {
      console.warn("[HomePage ⚠️] LLM intent compiler backend unreachable:", err);
    }

    // Atomic Intent Preservation: Read existing storage if backend compilation failed
    const existing = await chrome.storage.local.get(["compiledIntent"]);

    if (!compilationSuccess) {
      if (existing.compiledIntent && validateIntent(existing.compiledIntent)) {
        finalCompiledIntent = existing.compiledIntent;
        showToast("⚠️ LLM compiler offline. Retained previous active rules.", "warning");
      } else {
        // Fallback to deterministic parser if no previous valid intent exists
        finalCompiledIntent = parseUserTopicIntent(topicsInput, mode);
        showToast("⚠️ LLM compiler offline. Applied deterministic fallback intent.", "warning");
      }
    } else {
      showToast("✓ Intent Compiled & Rules Saved!", "success");
    }

    await chrome.storage.local.set({
      started,
      mode,
      topics: topicsArr,
      compiledIntent: finalCompiledIntent,
      allowThreshold: parseFloat(allowThreshold),
      blockThreshold: parseFloat(blockThreshold),
      semanticWeight: parseFloat(semanticWeight),
      keywordWeight: parseFloat((1 - semanticWeight).toFixed(2)),
      allowlist: allowArr,
      denylist: denyArr,
    });

    // Notify background worker to wipe decision cache and reload tab
    chrome.runtime.sendMessage({ type: "RULE_UPDATED" });
    setIsCompiling(false);
  };

  const handleResetStats = () => {
    chrome.runtime.sendMessage({ type: "RESET_STATS" }, () => {
      setStats({ blocked: 0, allowed: 0, uncertain: 0 });
    });
  };

  return (
    <div className="w-[380px] p-5 bg-gradient-to-b from-gray-900 to-gray-950 text-white font-sans rounded-xl border border-gray-800 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="font-bold text-base bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              YouTube Focus Filter
            </h1>
            <p className="text-[10px] text-gray-400">Semantic AI • Intent Compiler v4.0</p>
          </div>
        </div>

        {/* Master Switch */}
        <button
          onClick={handleToggle}
          className={`px-3 py-1.5 rounded-full font-semibold text-xs transition-all shadow-md ${
            started
              ? "bg-emerald-500 text-white shadow-emerald-900/40 hover:bg-emerald-600"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {started ? "● Active" : "○ Disabled"}
        </button>
      </div>

      {/* Save Toast Notification */}
      {toastMessage && (
        <div
          className={`mt-3 p-2 border rounded-lg text-center text-xs font-semibold animate-fade-in ${
            toastMessage.type === "success"
              ? "bg-emerald-900/80 border-emerald-500/50 text-emerald-200"
              : "bg-amber-900/80 border-amber-500/50 text-amber-200"
          }`}
        >
          {toastMessage.text}
        </div>
      )}

      {/* Stats Display */}
      <div className="my-4 grid grid-cols-3 gap-2 bg-gray-800/50 p-2.5 rounded-lg border border-gray-800/80 text-center">
        <div>
          <div className="text-xs font-semibold text-emerald-400">{stats.allowed || 0}</div>
          <div className="text-[9px] text-gray-400 uppercase tracking-wider">Allowed</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-rose-400">{stats.blocked || 0}</div>
          <div className="text-[9px] text-gray-400 uppercase tracking-wider">Blocked</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-amber-400">{stats.uncertain || 0}</div>
          <div className="text-[9px] text-gray-400 uppercase tracking-wider">Uncertain</div>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-300 mb-1.5">Filtering Strategy Mode</label>
        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-800/70 rounded-lg border border-gray-700/50">
          <button
            onClick={() => setMode("RESTRICTED")}
            className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
              mode === "RESTRICTED"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            🚫 Block Topics
          </button>
          <button
            onClick={() => setMode("FOCUS")}
            className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
              mode === "FOCUS"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            🎯 Allow Only Topics
          </button>
        </div>
      </div>

      {/* Natural Language Topics Input */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-300 mb-1">
          {mode === "RESTRICTED" ? "Restricted Topics / Intent Sentence:" : "Allowed Focus Topics / Intent Sentence:"}
        </label>
        <textarea
          rows={3}
          value={topicsInput}
          onChange={(e) => handleTopicsTextChange(e.target.value)}
          placeholder={
            mode === "RESTRICTED"
              ? "e.g. I don't want gaming, vlog or lifestyle content"
              : "e.g. want only coding related videos either DSA , system design or other coding related videos"
          }
          className="w-full p-2.5 bg-gray-800/90 border border-gray-700/70 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors resize-none"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          Compiled by LLM intent compiler on Save. Zero latency during video classification.
        </p>
      </div>

      {/* Settings Toggle */}
      <div className="mb-4">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-medium"
        >
          ⚙️ {showSettings ? "Hide Advanced Settings" : "Configure Thresholds & Weights"}
        </button>

        {showSettings && (
          <div className="mt-3 p-3 bg-gray-800/60 rounded-lg border border-gray-700/60 space-y-3 text-xs">
            <div>
              <div className="flex justify-between mb-1 text-gray-300">
                <span>Allow Threshold (Focus):</span>
                <span className="font-mono text-purple-400">{allowThreshold}</span>
              </div>
              <input
                type="range"
                min="0.20"
                max="0.60"
                step="0.01"
                value={allowThreshold}
                onChange={(e) => setAllowThreshold(e.target.value)}
                className="w-full accent-purple-500 h-1 bg-gray-700 rounded-lg"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1 text-gray-300">
                <span>Block Threshold (Restriction):</span>
                <span className="font-mono text-purple-400">{blockThreshold}</span>
              </div>
              <input
                type="range"
                min="0.25"
                max="0.65"
                step="0.01"
                value={blockThreshold}
                onChange={(e) => setBlockThreshold(e.target.value)}
                className="w-full accent-purple-500 h-1 bg-gray-700 rounded-lg"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1 text-gray-300">
                <span>Semantic Weight (vs Keyword):</span>
                <span className="font-mono text-purple-400">{semanticWeight}</span>
              </div>
              <input
                type="range"
                min="0.50"
                max="0.95"
                step="0.05"
                value={semanticWeight}
                onChange={(e) => setSemanticWeight(e.target.value)}
                className="w-full accent-purple-500 h-1 bg-gray-700 rounded-lg"
              />
            </div>

            {/* Allowlist & Denylist */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-700">
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Channel Allowlist</label>
                <textarea
                  rows={2}
                  value={allowlist}
                  onChange={(e) => setAllowlist(e.target.value)}
                  placeholder="Channel names..."
                  className="w-full p-1.5 bg-gray-900 border border-gray-700 rounded text-[11px] text-gray-200 resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Channel Denylist</label>
                <textarea
                  rows={2}
                  value={denylist}
                  onChange={(e) => setDenylist(e.target.value)}
                  placeholder="Channel names..."
                  className="w-full p-1.5 bg-gray-900 border border-gray-700 rounded text-[11px] text-gray-200 resize-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isCompiling}
          className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold text-xs rounded-lg shadow-lg shadow-purple-900/30 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {isCompiling ? "Compiling Intent..." : "Save & Apply Rules"}
        </button>
        <button
          onClick={handleResetStats}
          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-xs rounded-lg transition-colors"
          title="Reset filter counters"
        >
          Reset Stats
        </button>
      </div>
    </div>
  );
}

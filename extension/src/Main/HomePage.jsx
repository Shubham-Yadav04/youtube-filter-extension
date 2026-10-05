import { useState, useEffect } from "react";
export default function HomePage() {
 const [settings, setSettings] = useState({
    enabled: true,
    userRequirement: "",
    relevanceThreshold: 0.70,
    lockUntil: null
});
const handleResetSettings = () => {
    if (isLocked) {
        showToast(
            "Focus lock is active.",
            "warning"
        );
        return;
    }

    chrome.runtime.sendMessage(
        { type: "RESET_SETTINGS" },
        (response) => {
            if (!response?.success) {
                showToast(
                    "Settings are currently locked.",
                    "warning"
                );
                return;
            }

            setSettings(response.settings);
            setDraftRequirement(
                response.settings.userRequirement || ""
            );
            setDraftThreshold(
                response.settings.relevanceThreshold
            );

            setLockDuration(null);

            showToast("Settings reset.");
        }
    );
};
const [draftRequirement, setDraftRequirement] = useState("");
const [draftThreshold, setDraftThreshold] = useState(0.70);

const [lockDuration, setLockDuration] = useState(null);
const isLocked = remainingMs > 0;
const [stats, setStats] = useState({
    allowed: 0,
    blocked: 0
});
const [remainingMs, setRemainingMs] = useState(0);
const [saving, setSaving] = useState(false);
const [toast, setToast] = useState(null);
useEffect(() => {
    const update = () => {
        if (!settings.lockUntil) {
            setRemainingMs(0);
            return;
        }

        setRemainingMs(
            Math.max(0, settings.lockUntil - Date.now())
        );
    };

    update();

    const interval = setInterval(update, 1000);

    return () => clearInterval(interval);
}, [settings.lockUntil]);
 useEffect(() => {
    chrome.runtime.sendMessage(
        { type: "GET_SETTINGS" },
        (response) => {
            if (!response?.success) return;

            const s = response.settings;

            setSettings(s);
            setDraftRequirement(s.userRequirement || "");
            setDraftThreshold(s.relevanceThreshold ?? 0.70);
        }
    );

    loadStats();
}, []);
const loadStats = () => {
    chrome.runtime.sendMessage(
        { type: "GET_STATS" },
        (response) => {
            if (response?.stats) {
                setStats(response.stats);
            }
        }
    );
};
function formatRemaining(ms) {
    const totalSeconds = Math.ceil(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
}
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

 const handleToggle = () => {
    if (isLocked) return;

    chrome.runtime.sendMessage(
        {
            type: "TOGGLE_ENABLED",
            enabled: !settings.enabled
        },
        (response) => {
            if (!response?.success) {
                showToast("Filter is currently locked.", "warning");
                return;
            }

            setSettings(response.settings);
        }
    );
};

const handleSave = () => {
    if (!draftRequirement.trim()) {
        showToast("Tell Focus Filter what you want to watch.", "warning");
        return;
    }

    setSaving(true);

    const lockDurationMs = lockDuration
        ? lockDuration * 60 * 1000
        : null;

    chrome.runtime.sendMessage(
        {
            type: "SAVE_SETTINGS",
            userRequirement: draftRequirement.trim(),
            relevanceThreshold: Number(draftThreshold),
            lockDurationMs
        },
        (response) => {
            setSaving(false);

            if (!response?.success) {
                showToast("Could not save settings.", "error");
                return;
            }

            setSettings(response.settings);

            showToast(
                lockDuration
                    ? "Filter applied & locked."
                    : "Filter applied successfully."
            );
        }
    );
};

  const handleResetStats = () => {
    chrome.runtime.sendMessage({ type: "RESET_STATS" }, () => {
      setStats({ blocked: 0, allowed: 0, uncertain: 0 });
    });
  };

  return (
    <div className="w-[380px] min-h-[500px]  bg-[#09090b] text-white p-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
    <div>
        <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.8)]" />

            <h1 className="text-[15px] font-semibold tracking-tight">
                Focus Filter
            </h1>
        </div>

        <p className="text-[10px] text-zinc-500 mt-1">
            Local semantic filtering for YouTube
        </p>
    </div>

    <button
        onClick={handleToggle}
        disabled={isLocked}
        className={`
            relative px-3 py-1.5 rounded-full text-[11px]
            font-medium transition-all
            ${settings.enabled
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            }
            ${isLocked ? "opacity-50 cursor-not-allowed" : ""}
        `}
    >
        {settings.enabled ? "● Active" : "○ Paused"}
    </button>
</div>
{/* --- TEXT INPUT BLOCK --- */}
<div className="mb-5">
    <label className="block text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
        Your focus
    </label>

    <div className="relative">
        <textarea
            value={draftRequirement}
            onChange={(e) => setDraftRequirement(e.target.value)}
            rows={4}
            placeholder="e.g. I want videos about Java, Spring Boot, system design and backend engineering."
            className="
                w-full
                bg-zinc-900
                border border-zinc-800
                focus:border-violet-500/60
                focus:ring-1 focus:ring-violet-500/20
                rounded-xl
                p-3
                text-[12px]
                leading-relaxed
                text-zinc-200
                placeholder:text-zinc-600
                outline-none
                resize-none
                transition
            "
        />

        <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600">
            Semantic
        </div>
    </div>

    <p className="mt-2 text-[10px] text-zinc-600">
        Describe what you want naturally. Focus Filter understands the meaning,
        not just keywords.
    </p>
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
      {/* --- SLIDER BLOCK --- */}
<div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 mb-4">
    <div className="flex items-center justify-between mb-2">
        <div>
            <p className="text-[11px] font-medium text-zinc-300">
                Relevance
            </p>

            <p className="text-[9px] text-zinc-600">
                How closely a video should match your focus
            </p>
        </div>

        <span className="text-[11px] font-mono text-violet-400">
            {Math.round(draftThreshold * 100)}%
        </span>
    </div>

    <input
        type="range"
        min="0.50"
        max="0.90"
        step="0.01"
        value={draftThreshold}
        onChange={(e) => setDraftThreshold(e.target.value)}
        className="w-full accent-violet-500"
    />

    <div className="flex justify-between mt-1 text-[8px] text-zinc-600">
        <span>Broader</span>
        <span>Stricter</span>
    </div>
</div>
      {/* Stats Display */}
     <div className="grid grid-cols-2 gap-2 mb-4">
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
        <p className="text-[9px] text-zinc-600 uppercase tracking-wider">
            Allowed
        </p>
        <p className="text-xl font-semibold text-zinc-200 mt-1">
            {stats.allowed || 0}
        </p>
    </div>

    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
        <p className="text-[9px] text-zinc-600 uppercase tracking-wider">
            Blocked
        </p>

        <p className="text-xl font-semibold text-zinc-200 mt-1">
            {stats.blocked || 0}
        </p>
    </div>
</div>
{/* --- LOCK BLOCK --- */}
 <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 mb-4">
    <div className="flex items-center justify-between mb-3">
        <div>
            <p className="text-[11px] font-medium text-zinc-300">
                Focus lock
            </p>

            <p className="text-[9px] text-zinc-600">
                Prevent yourself from turning the filter off
            </p>
        </div>

        {isLocked && (
            <span className="text-[10px] text-amber-400 font-mono">
                🔒 {formatRemaining(remainingMs)}
            </span>
        )}
    </div>

    {!isLocked && (
        <div className="grid grid-cols-4 gap-1.5">
            {[30, 60, 120, 240].map((minutes) => (
                <button
                    key={minutes}
                    onClick={() =>
                        setLockDuration(
                            lockDuration === minutes ? null : minutes
                        )
                    }
                    className={`
                        py-1.5 rounded-lg text-[10px]
                        border transition
                        ${
                            lockDuration === minutes
                                ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                                : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                        }
                    `}
                >
                    {minutes < 60
                        ? `${minutes}m`
                        : `${minutes / 60}h`}
                </button>
            ))}
        </div>
    )}

    {isLocked && (
        <div className="text-[10px] text-zinc-500">
            Focus Filter cannot be disabled until the lock expires.
        </div>
    )}
</div>
      {/* Action Buttons */}
      <div className="flex gap-2">
       <button
    onClick={handleSave}
    disabled={saving || !draftRequirement.trim()}
    className="
        w-full
        py-2.5
        rounded-xl
        bg-violet-600
        hover:bg-violet-500
        disabled:bg-zinc-800
        disabled:text-zinc-600
        text-white
        text-[11px]
        font-semibold
        transition
        shadow-lg
        shadow-violet-950/30
    "
>
    {saving
        ? "Applying..."
        : lockDuration
            ? "Apply & Start Focus Lock"
            : "Save & Apply"}
</button>
        <div className="flex items-center justify-center gap-3 mt-3">
    <button
        onClick={handleResetStats}
        className="text-[9px] text-zinc-600 hover:text-zinc-400 transition"
    >
        Reset statistics
    </button>

    <span className="text-zinc-800">•</span>

    <button
        onClick={handleResetSettings}
        disabled={isLocked}
        className="text-[9px] text-zinc-600 hover:text-zinc-400 transition disabled:opacity-30"
    >
        Reset settings
    </button>
</div>
      </div>
    </div>
  );
}

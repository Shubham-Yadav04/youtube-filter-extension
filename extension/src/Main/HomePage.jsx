/* eslint-disable no-undef */
import React, { useState, useEffect } from "react";

function HomePage() {
  const [started, setStarted] = useState(false);
  const [constraints, setConstraints] = useState("");
  
  const [edit, setEdit] = useState(0);
useEffect(() => {
  (async () => {
    const { constraints = "", started = false } =
      await chrome.storage.local.get(["constraints", "started"]);
    setConstraints(constraints);
    setStarted(started);
  })();
}, []);

const handleSave = async () => {
  await chrome.storage.local.set({ constraints });
  chrome.runtime.sendMessage({ type: "RULE_UPDATED" });
  setEdit(0);
};


const handleStartAndStop = async () => {
  const newState = !started;
  setStarted(newState);
  await chrome.storage.local.set({ started: newState });
  console.log("sending state change ")
  chrome.runtime.sendMessage({ action: "STATE_CHANGED", started: newState });
};


  return (
    <div className="w-[320px] min-h-[420px] bg-gradient-to-b from-gray-900 to-gray-800 text-white p-4 flex flex-col gap-5 font-sans">
     <h1 className="text-xl font-semibold tracking-wide text-center">
  Focus Filter
</h1>
      <button
  className={`w-36 h-36 rounded-full mx-auto text-lg font-bold shadow-xl transition-all duration-300 ${
    started
      ? "bg-red-500 hover:bg-red-600 shadow-red-800"
      : "bg-green-500 hover:bg-green-600 shadow-green-800"
  }`}
  onClick={handleStartAndStop}
>
  {started ? "STOP" : "START"}
</button>

      <div className="bg-gray-700 rounded-xl p-3 shadow-inner flex flex-col gap-2">
  <div className="flex justify-between items-center">
    <span className="text-sm font-semibold opacity-80">Constraints</span>
    <button onClick={() => setEdit(2)} className="text-xs opacity-70 hover:opacity-100">Edit</button>
  </div>

  {edit === 2 ? (
    <textarea
      value={constraints}
      onChange={(e) => setConstraints(e.target.value)}
      placeholder="Describe allowed content..."
      className="bg-gray-800 border border-gray-600 rounded-md p-2 text-xs h-20 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
    />
  ) : (
    <p className="text-xs text-gray-200 min-h-[60px]">
      {constraints || "No constraints set"}
    </p>
  )}

  {edit === 2 && (
    <button
      onClick={handleSave}
      className="self-end bg-purple-600 hover:bg-purple-700 text-xs px-3 py-1 rounded-md"
    >
      Save
    </button>
  )}
</div>

    </div>
  );
}

export default HomePage;

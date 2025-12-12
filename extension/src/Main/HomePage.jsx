/* eslint-disable no-undef */
import React, { useState, useEffect, useRef } from "react";

function HomePage() {
  const [started, setStarted] = useState(false);
  const [constraints, setConstraints] = useState("");
  
  const [edit, setEdit] = useState(0);

  const editRef = useRef(null);
  useEffect(() => {
    (async () => {
   const data = await chrome.storage.local.get(["constraints","started"]);
      setConstraints(data.constraints);
      setStarted(data.started || false)
    })();
  }, []);
const handleSave=async()=>{
  await chrome.storage.local.set({constraints:constraints|| ""},()=>{
    console.log("data ,saved");
  })
      setEdit(0);
}

  const handleStartAndStop = async () => {
    if (!started) {
      console.log("starting....")
      await chrome.storage.local.set({started:true});
      // chrome.runtime.sendMessage({ type: "START_FILTERING", constraints });
    } else {
      await chrome.storage.local.set({started:false})
      // chrome.runtime.sendMessage({type:"STOP_FILTERING"})
    }
  };

  return (
    <div className="w-[300px] min-h-[400px] flex flex-col items-center gap-4">
      <h1 className="text-lg font-bold w-full text-left px-3 capitalize italic">
        extnsn
      </h1>

      <button
        className={`w-[150px] h-[150px] rounded-full text-black text-2xl uppercase tracking-wide font-bold shadow-xl ${
          !started
            ? "bg-green-300 shadow-green-500 hover:bg-green-400"
            : "bg-red-300 shadow-red-500 hover:bg-red-400"
        }`}
        onClick={() => {
          setStarted((prev) => !prev);
          handleStartAndStop();
        }}
      >
        {started ? "stop" : "start"}
      </button>

      <div className="flex flex-col items-center relative w-full">
        <h1 className="text-base font-semibold mb-2">
          describe your constraints 
        </h1>

        <div
          ref={editRef}
          className="w-[250px] h-[150px] bg-white border-2 border-black rounded-lg gap-1 flex flex-col p-1 relative"
        >
          <h1 className="text-sm font-bold w-full text-left px-2 relative">
            constraints
            <button
              aria-label="Edit constraints"
              onClick={(e) =>{
                e.stopPropagation();
                setEdit(2)
              }}
              className="absolute top-1 right-2 p-1"
              title="Edit"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="currentColor"
              >
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path>
                <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path>
              </svg>
            </button>
          </h1>

          {edit === 2 ? (
            <textarea
              placeholder="Enter constraints separated by commas"
              value={constraints}
              onChange={(e) =>
                setConstraints(
                  e.target.value
                )
              }
              className="border p-1 text-xs rounded w-full h-[25px] mb-4"
            />
          ) : (
            <p className="w-full h-[50px] overflow-y-auto px-2 text-xs font-semibold text-left">
              {constraints ==="" ? "No constraints set" : constraints}
            </p>
          )}

          {
            edit!=0 && <button className="absolute bottom-0 right-1 p-1 text-xs font-bold mt-2 z-10 bg-purple-500 rounded-md" onClick={handleSave}>Save</button>
          }
        </div>
      </div>
    </div>
  );
}

export default HomePage;

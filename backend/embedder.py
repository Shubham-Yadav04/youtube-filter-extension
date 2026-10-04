from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from agent import call_agent
import hashlib
import json
import re
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CompileIntentRequest(BaseModel):
    query: str
    mode: str = "RESTRICTED"

def compute_query_hash(raw_text: str, mode: str) -> str:
    combined = f"{mode}_{raw_text.strip().lower()}"
    return "qh_" + hashlib.md5(combined.encode("utf-8")).hexdigest()[:12]

def validate_intent_data(data: dict) -> bool:
    if not isinstance(data, dict):
        return False
    mode = data.get("mode")
    if mode not in ["ALLOW_ONLY", "BLOCK"]:
        return False
    for field, max_len in [("include", 20), ("exclude", 20), ("hardExcludePhrases", 10), ("hardIncludePhrases", 10)]:
        arr = data.get(field)
        if not isinstance(arr, list) or len(arr) > max_len:
            return False
        if not all(isinstance(x, str) for x in arr):
            return False
    return True

@app.get("/health")
def healthCheck():
    return "everything OK"

@app.post("/compile-intent")
async def compile_intent_endpoint(req: CompileIntentRequest):
    raw_query = req.query or ""
    mode = req.mode or "RESTRICTED"
    q_hash = compute_query_hash(raw_query, mode)

    prompt = f"User mode: {mode}\nUser topic preference query: {raw_query}"
    raw_response = await call_agent(prompt)

    clean_json_str = re.sub(r"^```json\s*", "", (raw_response or "").strip(), flags=re.IGNORECASE)
    clean_json_str = re.sub(r"^```\s*", "", clean_json_str).strip()

    try:
        parsed = json.loads(clean_json_str)
        if validate_intent_data(parsed):
            compiled = {
                "version": "v4.0",
                "mode": parsed["mode"],
                "queryHash": q_hash,
                "include": [str(x).strip().lower() for x in parsed.get("include", []) if str(x).strip()][:20],
                "exclude": [str(x).strip().lower() for x in parsed.get("exclude", []) if str(x).strip()][:20],
                "hardExcludePhrases": [str(x).strip().lower() for x in parsed.get("hardExcludePhrases", []) if str(x).strip()][:10],
                "hardIncludePhrases": [str(x).strip().lower() for x in parsed.get("hardIncludePhrases", []) if str(x).strip()][:10],
            }
            return {"ok": True, "compiledIntent": compiled}
        else:
            return {"ok": False, "error": "Validation failed on LLM output schema", "queryHash": q_hash}
    except Exception as err:
        return {"ok": False, "error": f"Failed to parse LLM JSON: {str(err)}", "queryHash": q_hash}

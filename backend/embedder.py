from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from fastapi.middleware.cors import CORSMiddleware
from agent import call_agent
app = FastAPI()
model = SentenceTransformer("all-MiniLM-L6-v2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins (dev only)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class TextRequest(BaseModel):
    input: list[str]

@app.get("/health")
def healthCheck():
    print("heelo")
    return "everything OK"

@app.post("/embed")
def embed_text(req: TextRequest):
    embeddings = [model.encode(q).tolist() for q in req.input]
    return {"embeddings": embeddings}
@app.post("/embed-user")
async def embed_text(req: TextRequest):
    # convert the user query into an effective query
    call_agent_response = await call_agent(req.input[0])
    if call_agent_response is not None and call_agent_response != "":
        embedding =await model.encode(call_agent_response)
        return {"embedding": embedding}
    else:
        return {"error":"failed save constraint and refresh the tab"}
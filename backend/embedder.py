from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI()

model = SentenceTransformer("all-MiniLM-L6-v2")

class TextRequest(BaseModel):
    text: str

@app.get("/health")
def healthCheck():
    print("heelo")
    return "everything OK"
@app.get("/embed")
def embed_text(query:str):
    embedding = model.encode(query).tolist()
    return {"embedding": embedding}

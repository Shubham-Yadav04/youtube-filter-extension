from google.adk.agents.llm_agent import Agent
from pydantic import BaseModel
class Video(BaseModel):
    id: str
    title: str
    channelName: str

class FilterRequest(BaseModel):
    description: str
    videos: list[Video]

class FilterResponse(BaseModel):
    id: str
    block: bool

filter_Agent = Agent(
    model='gemini-2.5-flash',
    name='video_filter',
    description=(
        "You are a YouTube video filtering agent. "
        "You receive an array of videos, each containing: id, title, and channel name. "
        "You must analyze the user's requirement/description and decide whether each video "
        "should be blocked or allowed."
    ),
    instruction=(
        "Return the videos **in the same order**. For each video, output:\n"
        "- id\n"
        "- block: true/false\n"
        "Use ONLY the video title and the channel name for evaluation. "
        "Do not generate extra fields. Do not reorder items."
    ),
    input_schema=FilterRequest,     
    output_schema=FilterResponse,
)



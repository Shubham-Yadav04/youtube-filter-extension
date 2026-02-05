
from google.adk.agents.llm_agent import Agent
from google.adk.runners import Runner

USER_ID = "user_123"
root_agent = Agent(
    model='gemini-3-flash-preview',

    name='root_agent',
    description="Provide's a well defined and effective query for embedding the user query",
    instruction = """
Rewrite the user's topic preference into a rich semantic description
that represents the types of video content they want to see.

Expand with:
- related topics
- synonyms
- subfields
- tools, technologies
- educational phrasing

Output only a single paragraph describing the topic domain.
No explanation. No conversation.
"""
)


runner= Runner(
    agent=root_agent,
    session_service=None,
    app_name="YT_extension",
)
async def call_agent(user_content):
    final_response_content = ""

    async for event in runner.run_async(
        user_id=USER_ID,
        session_id="yt_semantic_expansion",
        new_message=user_content
    ):
        try:
            if event.is_final_response() and event.content and event.content.parts:
                final_response_content = event.content.parts[0].text
        except Exception as e:
            print(f"Error: {e}")

    return final_response_content

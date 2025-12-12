from agent import filter_Agent
from flask import Flask, request, jsonify
import json
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from google.genai.types import Part
from flask_cors import CORS

# runner setup

session_service = InMemorySessionService()
runner = Runner(agent=filter_Agent, app_name="video_filter_app", session_service=session_service)

app = Flask(__name__)
CORS(app,origins=["chrome-extension://dfembchlflljncinkchiblcfeopedjlm"])
@app.route("/filter-videos", methods=["POST"])
async def filter_videos():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON body provided"}), 400

        # create a session
        session = await session_service.create_session(app_name="video_filter_app",user_id="user")
        # run the agent
        print(session)
        user_message = types.Content(role="user", parts=[Part(text=json.dumps(data))])
        print(user_message)
        events = list(  runner.run(
                    user_id="user",
                    session_id=session.id,
                    new_message=user_message
        ))
        print(events)
        
        final_text = events[-1].content.parts[0].text

        return jsonify({"response": final_text}), 200
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000,threaded=False)

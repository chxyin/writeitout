from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import json
import re
import os
import random
from pathlib import Path
from dotenv import load_dotenv

# Load the .env file
load_dotenv()

app = FastAPI()

# Allow React to talk to the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

# Print a warning if the key isn't found
if not DEEPSEEK_API_KEY:
    print("WARNING: DEEPSEEK_API_KEY not found in .env file!")

class POIRequest(BaseModel):
    speech: str
    poi: str

@app.get("/api/random-speech")
async def random_speech():
    speech_file = Path("generated_speeches_batch.json")

    if not speech_file.exists():
        raise HTTPException(status_code=404, detail=f"Speech dataset not found at {speech_file}")

    try:
        with speech_file.open("r", encoding="utf-8") as file:
            speeches = json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=500, detail=f"Unable to read speech dataset: {error}") from error

    if not isinstance(speeches, list) or not speeches:
        raise HTTPException(status_code=500, detail="Speech dataset must be a non-empty JSON array")

    speech = random.choice(speeches)
    text = str(speech.get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=500, detail="Selected speech has no text")

    sentences = re.split(r"(?<=[.!?]) +", text)
    claim_keywords = ("propose", "fund", "establish", "resolution", "calls for")
    single_claim = next(
        (
            sentence.strip()
            for sentence in sentences[2:]
            if any(keyword in sentence.lower() for keyword in claim_keywords)
            or re.search(r"\d", sentence)
        ),
        next((sentence.strip() for sentence in sentences[2:4] if sentence.strip()), text),
    )
    return {**speech, "single_claim": single_claim}

@app.post("/api/grade")
async def grade_poi(request: POIRequest):
    print(f"\n--- NEW REQUEST ---")
    print(f"POI: {request.poi}")

    system_prompt = """
    You are an expert Model UN Chair. Review and rate the user's Point of Information (POI) on a scale of 1 to 10.
    Return ONLY a valid JSON object. Do NOT wrap it in markdown. Do NOT use any emojis.

    RATING RUBRIC:
    - 1-3 (Weak/Miss): Statement, softball, vague request, or off-topic.
    - 4-6 (Average): Relevant question, but generic or slightly wordy.
    - 7-8 (Strong Hit): Directly attacks a specific mechanism with simple logic.
    - 9-10 (Exceptional): Brilliant logical trap using the speaker's own words against them.

    TASK:
    Rewrite the user's POI so it scores a 9 or 10/10.
    REWRITE RULES: Single question, under 35 words. Simple, blunt HMUN language.

    Format as JSON:
    {
      "score": 1-10, 
      "grade_label": "Weak/Miss" | "Average" | "Strong Hit" | "Exceptional", 
      "reasoning": "1-2 sentences", 
      "constructive_feedback": "1 sentence", 
      "rewritten_poi": "The 10/10 version",
      "rewrite_explanation": "1 sentence"
    }
    """

    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Content-Type": "application/json", 
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Speech:\n{request.speech}\n\nPOI:\n{request.poi}"}
        ],
        "temperature": 0.1, 
        "response_format": {"type": "json_object"}
    }

    try:
        response = requests.post(url, headers=headers, json=payload)
        
        # If DeepSeek returns a 400/500 error, this will catch it
        if response.status_code != 200:
            print(f"API HTTP ERROR {response.status_code}: {response.text}")
            raise HTTPException(status_code=500, detail=f"API returned status {response.status_code}")
            
        result = response.json()
        
        # Check if the API returned a valid choices array
        if 'choices' not in result:
            print(f"API ERROR (No choices): {result}")
            raise HTTPException(status_code=500, detail="DeepSeek API Error")
            
        raw_content = result['choices'][0]['message']['content']
        print(f"RAW DEEPSEEK RESPONSE: {raw_content}")
        
        # Extract the JSON block robustly
        json_match = re.search(r'\{[\s\S]*\}', raw_content)
        
        if json_match:
            parsed_json = json.loads(json_match.group(0))
            print("SUCCESSFULLY PARSED JSON")
            return parsed_json
        else:
            print("FAILED TO EXTRACT JSON")
            raise HTTPException(status_code=500, detail="Failed to parse JSON")
            
    except Exception as e:
        print(f"EXCEPTION: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

import os
import json
import httpx
import urllib.request
import re
import traceback
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

load_dotenv()
app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerateRepliesRequest(BaseModel):
    post_text: Optional[str] = ""
    post_url: Optional[str] = ""
    tone: str
    num_variations: int = 3
    length: str
    custom_instructions: Optional[str] = ""
    emoji: bool = True

class GenerateRepliesResponse(BaseModel):
    replies: List[str]

@app.post("/generate-replies", response_model=GenerateRepliesResponse)
async def generate_replies(request: GenerateRepliesRequest):
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="NVIDIA_API_KEY environment variable not set")

    post_content = request.post_text

    if request.post_url:
        try:
            # Extract tweet ID from URL
            match = re.search(r'status/(\d+)', request.post_url)
            if not match:
                raise ValueError("Could not find a valid tweet ID in the URL")
            tweet_id = match.group(1)
            
            api_url = f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&token=1"
            
            req = urllib.request.Request(
                api_url, 
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
            )
            
            with urllib.request.urlopen(req, timeout=10.0) as response:
                data = json.loads(response.read().decode())
                
            # Extract the actual text of the tweet
            post_content = data.get("text", "")
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=400, detail=f"Failed to fetch X post context: {str(e)}")

    if not post_content:
        raise HTTPException(status_code=400, detail="Must provide either post_text or a valid post_url")

    # Construct the prompt
    system_prompt = (
        f"You are an expert social media assistant. Generate exactly {request.num_variations} variations of a reply to the user's post.\n"
        f"Tone: {request.tone}\n"
        f"Length: {request.length}\n"
        f"{'Include relevant emojis.' if request.emoji else 'Do NOT include any emojis.'}\n"
        f"{f'Custom Instructions: {request.custom_instructions}' if request.custom_instructions else ''}\n"
        "Return the response EXACTLY as a valid JSON list of strings, with no additional text or markdown formatting. Example: [\"reply 1\", \"reply 2\"]"
    )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "meta/llama-3.1-70b-instruct",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Post: {post_content}"}
        ],
        "temperature": 0.7,
        "max_tokens": 1024,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            
            # Extract content from the LLM response
            content = data["choices"][0]["message"]["content"].strip()
            
            # Clean up the output in case it includes markdown json blocks
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            
            # Parse the JSON list
            try:
                replies = json.loads(content)
                if not isinstance(replies, list):
                    replies = [str(replies)]
            except json.JSONDecodeError:
                # Fallback: simple line split if JSON parsing fails
                replies = [line.strip(' -*1234567890."\'') for line in content.split('\n') if line.strip()]
            
            # Ensure we return exactly the requested number of variations
            return GenerateRepliesResponse(replies=replies[:request.num_variations])

    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"NVIDIA API Error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)

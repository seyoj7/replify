import os
import re
import json
import asyncio
import httpx
import uvicorn
import traceback
from contextlib import asynccontextmanager
from pydantic import BaseModel
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional

load_dotenv()

# Persistent HTTP client — reuses TCP/TLS connections across requests
http_client: httpx.AsyncClient | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        timeout=httpx.Timeout(60.0, connect=10.0),
    )
    yield
    await http_client.aclose()

app = FastAPI(lifespan=lifespan)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
            
            # Async fetch — doesn't block the event loop
            tweet_response = await http_client.get(
                api_url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'},
                timeout=10.0,
            )
            tweet_response.raise_for_status()
            data = tweet_response.json()
                
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
        "max_tokens": 512,
    }

    # Retry up to 3 times for transient failures (timeouts, DNS, rate limits)
    max_retries = 3
    last_error = None
    for attempt in range(max_retries):
        try:
            response = await http_client.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            # Handle 429 rate limit with retry
            if response.status_code == 429 and attempt < max_retries - 1:
                wait = (attempt + 1) * 1  # 1s, 2s backoff
                print(f"[WARN] Rate limited (429), retrying in {wait}s (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(wait)
                continue
            response.raise_for_status()
            data = response.json()
            break  # Success — exit retry loop
        except (httpx.ReadTimeout, httpx.ConnectError, httpx.ConnectTimeout) as e:
            last_error = e
            if attempt < max_retries - 1:
                wait = (attempt + 1) * 2  # 2s, 4s backoff
                print(f"[WARN] {type(e).__name__}, retrying in {wait}s (attempt {attempt + 2}/{max_retries})")
                await asyncio.sleep(wait)
                continue
            print(f"[ERROR] {type(e).__name__} after {max_retries} attempts: {str(e)}")
            raise HTTPException(status_code=504, detail=f"Could not reach NVIDIA API after {max_retries} attempts: {type(e).__name__}")
        except httpx.HTTPStatusError as e:
            print(f"[ERROR] NVIDIA API returned {e.response.status_code}: {e.response.text}")
            raise HTTPException(status_code=e.response.status_code, detail=f"NVIDIA API Error: {e.response.text}")

    try:
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

    except Exception as e:
        traceback.print_exc()
        print(f"[ERROR] Unexpected error: {type(e).__name__}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)

"""
Umayal's Study Coach — FastAPI Backend
CBSE Class 9 AI-powered study assistant.
Supports Groq (free, fast) and Google Gemini as AI backends.
"""
import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# --- AI Backend Configuration ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

ai_backend = None
ai_backend_name = "none"

# Prefer Groq (free, fast), fall back to Gemini
if GROQ_API_KEY and GROQ_API_KEY != "your-key-here":
    from groq import Groq
    groq_client = Groq(api_key=GROQ_API_KEY)
    ai_backend = "groq"
    ai_backend_name = "Groq (Llama 3.3 70B)"
    print(f"[OK] AI Backend: Groq (Llama 3.3 70B)")
elif GEMINI_API_KEY and GEMINI_API_KEY != "your-key-here":
    from google import genai
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    ai_backend = "gemini"
    ai_backend_name = "Google Gemini 2.5 Flash"
    print(f"[OK] AI Backend: Gemini 2.5 Flash")
else:
    print("[WARN]  No AI API key configured. Set GROQ_API_KEY or GEMINI_API_KEY in .env")

DATA_DIR = Path(__file__).parent / "data"
STATIC_DIR = Path(__file__).parent / "static"
USAGE_FILE = Path(__file__).parent / "usage.json"

# --- Usage Tracking ---
DAILY_LIMIT = 50

def load_usage() -> dict:
    if USAGE_FILE.exists():
        try:
            with open(USAGE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"date": str(date.today()), "count": 0, "total_all_time": 0}

def save_usage(usage: dict):
    with open(USAGE_FILE, "w") as f:
        json.dump(usage, f, indent=2)

def get_today_usage() -> dict:
    usage = load_usage()
    today = str(date.today())
    if usage.get("date") != today:
        usage["date"] = today
        usage["count"] = 0
    return usage

def increment_usage() -> dict:
    usage = get_today_usage()
    usage["count"] += 1
    usage["total_all_time"] = usage.get("total_all_time", 0) + 1
    save_usage(usage)
    return usage


app = FastAPI(title="Umayal's Study Coach", version="2.1.0")

# Thread pool for running synchronous AI calls without blocking the event loop
_ai_executor = ThreadPoolExecutor(max_workers=3)

# Timeout for AI calls (seconds)
AI_CALL_TIMEOUT = 45

SYSTEM_PROMPT = """You are Umayal's personal study coach for CBSE Class 9 at DPS Nacharam.

Your role:
- Explain concepts simply with real-world examples that a 14-year-old can relate to
- Use NCERT textbook content as your primary reference
- For Maths and Physics problems, ALWAYS show step-by-step working
- Guide the student to understand — don't just give answers
- Be concise and exam-focused (mention important points for exams)
- You can use Hindi or Telugu words occasionally to help explain difficult concepts
- Be encouraging and friendly — use phrases like "Great question!", "You're on the right track!"
- Always reference the chapter and topic in your answers
- Use bullet points and numbered steps for clarity
- If a question is outside Class 9 CBSE syllabus, mention that and still try to help

Format your responses using markdown for clarity (bold, bullets, numbered lists).
"""


def load_subject_data(subject_key: str) -> Optional[dict]:
    filepath = DATA_DIR / f"{subject_key}.json"
    if filepath.exists():
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def load_index() -> dict:
    filepath = DATA_DIR / "index.json"
    if filepath.exists():
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def find_relevant_context(subject_key: str, question: str) -> str:
    data = load_subject_data(subject_key)
    if not data or not data.get("chapters"):
        return ""

    question_lower = question.lower()
    scored_chapters = []

    for chapter in data["chapters"]:
        chapter_text_lower = chapter.get("text", "").lower()
        chapter_name_lower = chapter.get("chapter_name", "").lower()

        score = 0
        words = set(question_lower.split())
        for word in words:
            if len(word) > 3:
                if word in chapter_name_lower:
                    score += 10
                if word in chapter_text_lower:
                    score += 1

        if score > 0:
            scored_chapters.append((score, chapter))

    scored_chapters.sort(key=lambda x: x[0], reverse=True)

    context_parts = []
    for _, chapter in scored_chapters[:2]:
        text = chapter.get("text", "")
        if len(text) > 4000:
            text = text[:4000] + "..."
        context_parts.append(
            f"--- Chapter {chapter['chapter_number']}: {chapter['chapter_name']} ---\n{text}"
        )

    return "\n\n".join(context_parts)


def _call_ai_sync(system_prompt: str, user_prompt: str) -> str:
    """Synchronous AI call — runs in thread pool, do not call directly from async code."""
    if ai_backend == "groq":
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=2048,
        )
        return response.choices[0].message.content
    elif ai_backend == "gemini":
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=system_prompt + "\n\n" + user_prompt,
        )
        return response.text
    else:
        raise Exception("No AI backend configured")


async def call_ai(system_prompt: str, user_prompt: str) -> str:
    """Async wrapper: runs the blocking AI call in a thread pool with a timeout."""
    loop = asyncio.get_event_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(_ai_executor, _call_ai_sync, system_prompt, user_prompt),
            timeout=AI_CALL_TIMEOUT,
        )
        return result
    except asyncio.TimeoutError:
        raise Exception(f"AI response timed out after {AI_CALL_TIMEOUT} seconds. Please try again.")


class QuestionRequest(BaseModel):
    subject: str
    question: str
    chapter: Optional[str] = None

class AnswerResponse(BaseModel):
    answer: str
    subject: str
    context_used: bool
    usage_today: int
    usage_limit: int
    usage_remaining: int
    ai_backend: str


@app.get("/api/health")
async def health_check():
    """Lightweight health/ping endpoint for keep-alive. Returns instantly."""
    return {"status": "ok"}


@app.get("/api/subjects")
async def get_subjects():
    index = load_index()
    return {"subjects": index}

CHAPTER_FORMAT_PROMPT = """You are a study-notes formatter for a Class 9 CBSE student.
Convert the raw textbook content below into structured, study-friendly HTML.

RULES:
- Use these EXACT HTML structures (no other tags):
  <div class="study-section"><h3>Section Title</h3><p>Content...</p></div>
  <div class="key-points"><h4>📌 Key Points</h4><ul><li>point 1</li><li>point 2</li></ul></div>
  <div class="formula-box"><h4>📐 Formula</h4><div class="formula">formula here</div><p class="formula-note">What it means...</p></div>
  <div class="remember-box"><h4>💡 Remember This!</h4><p>Important thing to remember</p></div>
  <div class="extra-note"><h4>📝 Extra Note</h4><p>Additional insight or exam tip</p></div>
  <div class="definition"><strong>Term:</strong> Definition here</div>
  <div class="example-box"><h4>✏️ Example</h4><p>Worked example here</p></div>
- Bold important terms with <strong>
- Keep it concise and exam-focused
- Extract ALL formulas into formula-box divs
- Add 2-3 "Remember This" boxes per chapter for the most important concepts
- Add at least 1 "Extra Note" with exam tips
- End with a "Key Points" summary of the whole chapter
- Use simple language a 14-year-old can understand
- Do NOT use markdown — output raw HTML only
- Do NOT wrap in code blocks or backticks
"""

CACHE_DIR = Path(__file__).parent / "cache"

def get_cached_chapter(subject: str, chapter_num: str) -> Optional[str]:
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{subject}_{chapter_num}.html"
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8")
    return None

def save_cached_chapter(subject: str, chapter_num: str, html: str):
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{subject}_{chapter_num}.html"
    cache_file.write_text(html, encoding="utf-8")

async def format_chapter_with_ai(text: str, chapter_name: str, subject_name: str) -> str:
    """Use AI to format raw chapter text into study-friendly HTML."""
    if not ai_backend:
        return None
    prompt = f"Subject: {subject_name}\nChapter: {chapter_name}\n\n--- Raw Textbook Content ---\n{text[:12000]}"
    try:
        return await call_ai(CHAPTER_FORMAT_PROMPT, prompt)
    except Exception as e:
        print(f"[WARN] AI formatting failed: {e}")
        return None


@app.get("/api/chapter/{subject}/{chapter_num}")
async def get_chapter(subject: str, chapter_num: str):
    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    for chapter in data.get("chapters", []):
        if chapter["chapter_number"] == chapter_num:
            text = chapter.get("text", "")

            # Check cache first
            formatted = get_cached_chapter(subject, chapter_num)

            # If no cache, format with AI
            if not formatted and ai_backend:
                formatted = await format_chapter_with_ai(text, chapter["chapter_name"], data["subject"])
                if formatted:
                    # Clean up any markdown code fences the AI might add
                    formatted = formatted.strip()
                    if formatted.startswith("```"):
                        formatted = "\n".join(formatted.split("\n")[1:])
                    if formatted.endswith("```"):
                        formatted = "\n".join(formatted.split("\n")[:-1])
                    save_cached_chapter(subject, chapter_num, formatted)

            return {
                "subject": data["subject"],
                "chapter_number": chapter["chapter_number"],
                "chapter_name": chapter["chapter_name"],
                "word_count": chapter.get("word_count", 0),
                "summary": text,
                "formatted_html": formatted,
            }

    raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found")

@app.get("/api/usage")
async def get_usage():
    usage = get_today_usage()
    return {
        "today": usage["count"],
        "limit": DAILY_LIMIT,
        "remaining": max(0, DAILY_LIMIT - usage["count"]),
        "total_all_time": usage.get("total_all_time", 0),
        "ai_backend": ai_backend_name,
    }

@app.get("/api/status")
async def get_status():
    """Health check + backend info."""
    return {
        "status": "ok",
        "ai_backend": ai_backend_name,
        "ai_configured": ai_backend is not None,
    }

@app.post("/api/ask")
async def ask_doubt(request: QuestionRequest):
    if not ai_backend:
        raise HTTPException(
            status_code=500,
            detail="No AI API key configured. Add GROQ_API_KEY or GEMINI_API_KEY to .env file.",
        )

    # Check daily limit
    usage = get_today_usage()
    if usage["count"] >= DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily question limit reached ({DAILY_LIMIT} questions). Come back tomorrow! 📚",
        )

    # Find relevant NCERT content
    context = ""
    if request.chapter:
        data = load_subject_data(request.subject)
        if data:
            for ch in data.get("chapters", []):
                if ch["chapter_number"] == request.chapter:
                    text = ch.get("text", "")
                    context = text[:6000] if len(text) > 6000 else text
                    break
    if not context:
        context = find_relevant_context(request.subject, request.question)

    # Build the prompt
    index = load_index()
    subject_name = index.get(request.subject, {}).get("name", request.subject)

    user_prompt = f"Subject: {subject_name}\n"
    if request.chapter:
        user_prompt += f"Chapter: {request.chapter}\n"
    user_prompt += f"\nStudent's Question: {request.question}"

    if context:
        user_prompt += f"\n\n--- Relevant NCERT Content ---\n{context}"

    try:
        answer = await call_ai(SYSTEM_PROMPT, user_prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    # Increment usage AFTER successful response
    updated_usage = increment_usage()

    return AnswerResponse(
        answer=answer,
        subject=subject_name,
        context_used=bool(context),
        usage_today=updated_usage["count"],
        usage_limit=DAILY_LIMIT,
        usage_remaining=max(0, DAILY_LIMIT - updated_usage["count"]),
        ai_backend=ai_backend_name,
    )


# Serve static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def serve_frontend():
    return FileResponse(str(STATIC_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

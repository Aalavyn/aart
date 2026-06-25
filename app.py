"""
Umayal's Study Coach — FastAPI Backend
CBSE Class 9 AI-powered study assistant.
Supports Groq (free, fast) and Google Gemini as AI backends.
"""
import asyncio
import hashlib
import json
import logging
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from math import floor
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# --- Logging & Guardrails ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("ai_calls.log"),
        logging.StreamHandler()
    ]
)
ai_logger = logging.getLogger("guardrails")

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
    ai_backend_name = "Google Gemini 2.0 Flash Lite"
    print(f"[OK] AI Backend: Gemini 2.0 Flash Lite")
else:
    print("[WARN]  No AI API key configured. Set GROQ_API_KEY or GEMINI_API_KEY in .env")

DATA_DIR = Path(__file__).parent / "data"
STATIC_DIR = Path(__file__).parent / "static"
USAGE_FILE = Path(__file__).parent / "usage.json"
PROGRESS_FILE = Path(__file__).parent / "progress.json"
PLANNER_FILE = Path(__file__).parent / "planner.json"

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


app = FastAPI(title="Umayal's Study Coach", version="2.2.0")

# Thread pool for running synchronous AI calls without blocking the event loop
_ai_executor = ThreadPoolExecutor(max_workers=3)

# Timeout for AI calls (seconds)
AI_CALL_TIMEOUT = 120

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

Occasionally use cat puns in your explanations to keep it fun (but don't overdo it — learning comes first).
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


# --- Content Validation Guardrails ---

def extract_significant_words(text: str, n: int = 10) -> list:
    """Extract first N significant words (skip stop words and short tokens)."""
    STOP_WORDS = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
        "for", "of", "with", "is", "are", "was", "were", "it", "its",
        "this", "that", "be", "as", "by", "from", "have", "has", "had",
        "not", "can", "will", "also", "more", "than", "which", "what",
    }
    clean = re.sub(r'<[^>]+>', '', text)
    tokens = re.findall(r'\b[a-zA-Z]{4,}\b', clean)
    significant = [t.lower() for t in tokens if t.lower() not in STOP_WORDS]
    return significant[:n]


def validate_formatted_content(raw_text: str, formatted_html: str) -> dict:
    """
    Verify formatted HTML contains key terms from raw text.
    Returns validation result with matched/missing terms.
    """
    key_terms = extract_significant_words(raw_text, n=10)
    formatted_lower = formatted_html.lower()

    matched = [term for term in key_terms if term in formatted_lower]
    missing = [term for term in key_terms if term not in formatted_lower]

    valid = len(matched) >= 3
    return {
        "valid": valid,
        "matched_terms": matched,
        "missing_terms": missing,
        "key_terms_checked": key_terms,
        "match_count": len(matched),
        "confidence": "high" if len(matched) >= 7 else ("medium" if len(matched) >= 3 else "low"),
    }


GEMINI_MODELS = ["gemini-2.0-flash-lite", "gemini-2.0-flash"]

def _call_ai_sync(system_prompt: str, user_prompt: str) -> str:
    """Synchronous AI call with retry + model fallback for 503 errors."""
    import time

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
        last_error = None
        for model_name in GEMINI_MODELS:
            for attempt in range(3):
                try:
                    response = gemini_client.models.generate_content(
                        model=model_name,
                        contents=system_prompt + "\n\n" + user_prompt,
                    )
                    return response.text
                except Exception as e:
                    last_error = e
                    err_str = str(e)
                    if "503" in err_str or "UNAVAILABLE" in err_str or "overloaded" in err_str.lower():
                        wait = (attempt + 1) * 2  # 2s, 4s, 6s
                        ai_logger.warning(f"Gemini {model_name} attempt {attempt+1} failed (503), retrying in {wait}s...")
                        time.sleep(wait)
                    elif "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                        wait = (attempt + 1) * 5  # 5s, 10s, 15s — reduced backoff for faster recovery
                        ai_logger.warning(f"Gemini {model_name} attempt {attempt+1} rate-limited (429), retrying in {wait}s...")
                        time.sleep(wait)
                    else:
                        raise  # Non-retryable error
            ai_logger.warning(f"All retries exhausted for {model_name}, trying next model...")
        raise Exception(f"All Gemini models unavailable after retries. Last error: {last_error}")
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

# Keep cache across restarts — chapter names are now correct
# Only clear via /api/cache/clear if needed
CACHE_DIR.mkdir(exist_ok=True)
print(f"[OK] Cache dir ready: {sum(1 for f in CACHE_DIR.glob('*.html'))} cached chapters")

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

async def format_chapter_with_ai(text: str, chapter_name: str, subject_name: str) -> Optional[str]:
    """Use AI to format raw chapter text into study-friendly HTML. Validates output."""
    if not ai_backend:
        return None
    prompt = f"Subject: {subject_name}\nChapter: {chapter_name}\n\n--- Raw Textbook Content ---\n{text[:12000]}"
    try:
        ai_logger.info(f"AI_FORMAT_START | subject={subject_name} | chapter={chapter_name} | input_chars={len(text)}")
        result = await call_ai(CHAPTER_FORMAT_PROMPT, prompt)

        # Validate: does the formatted output actually contain content from the source?
        validation = validate_formatted_content(text, result)
        ai_logger.info(
            f"AI_FORMAT_RESULT | subject={subject_name} | chapter={chapter_name} | "
            f"valid={validation['valid']} | confidence={validation['confidence']} | "
            f"matched={validation['matched_terms']} | missing={validation['missing_terms']}"
        )

        if not validation["valid"]:
            ai_logger.warning(
                f"AI_FORMAT_VALIDATION_FAIL | {subject_name} / {chapter_name} | "
                f"Only {validation['match_count']}/10 key terms found. "
                f"Returning raw text to avoid wrong content."
            )
            return None  # Will fall back to raw text display

        return result
    except Exception as e:
        ai_logger.error(f"AI_FORMAT_ERROR | {subject_name} / {chapter_name} | {e}")
        return None


@app.get("/api/precache/status")
async def precache_status():
    """Check pre-cache progress — how many chapters are formatted and ready."""
    cached_count = sum(1 for _ in CACHE_DIR.glob("*.html"))
    return {
        **_precache_status,
        "cached_files": cached_count,
        "message": (
            "Pre-caching complete! All chapters ready." if _precache_status["complete"]
            else f"Pre-caching in progress... {_precache_status['done']}/{_precache_status['total']} done"
            if _precache_status["running"]
            else "Pre-cache not started yet (server just woke up)"
        ),
    }


@app.get("/api/cache/clear")
async def clear_cache():
    """Clear all cached formatted chapters."""
    import shutil
    if CACHE_DIR.exists():
        shutil.rmtree(CACHE_DIR, ignore_errors=True)
    CACHE_DIR.mkdir(exist_ok=True)
    return {"status": "ok", "message": "Cache cleared"}


def basic_html_format(text: str) -> str:
    """Fast local formatting — no AI needed. Produces readable HTML from raw text."""
    import html as html_mod
    escaped = html_mod.escape(text)
    lines = escaped.split('\n')
    result_parts = []
    in_paragraph = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_paragraph:
                result_parts.append('</p>')
                in_paragraph = False
            continue

        # Detect headings (lines that are short, possibly numbered like "1.1 Introduction")
        is_heading = (
            len(stripped) < 100
            and not stripped.endswith('.')
            and (
                re.match(r'^\d+(\.\d+)*\s+', stripped)  # numbered heading
                or stripped.isupper()  # ALL CAPS heading
                or (len(stripped) < 60 and stripped[0].isupper() and not any(c in stripped for c in '.,:;'))
            )
        )

        if is_heading:
            if in_paragraph:
                result_parts.append('</p>')
                in_paragraph = False
            level = 'h3' if re.match(r'^\d+\s', stripped) or stripped.isupper() else 'h4'
            result_parts.append(f'<{level}>{stripped}</{level}>')
        else:
            if not in_paragraph:
                result_parts.append('<p>')
                in_paragraph = True
            else:
                result_parts.append(' ')
            result_parts.append(stripped)

    if in_paragraph:
        result_parts.append('</p>')

    return '\n'.join(result_parts)


@app.get("/api/chapter/{subject}/{chapter_num}")
async def get_chapter(subject: str, chapter_num: str):
    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    for chapter in data.get("chapters", []):
        if chapter["chapter_number"] == chapter_num:
            text = chapter.get("text", "")

            # Check AI-formatted cache first
            formatted = get_cached_chapter(subject, chapter_num)

            if not formatted:
                # Return basic HTML formatting instantly — no AI wait
                formatted = basic_html_format(text)

                # Kick off AI formatting in the background for next time
                if ai_backend:
                    asyncio.ensure_future(_background_format(subject, chapter_num, text, chapter["chapter_name"], data["subject"]))

            return {
                "subject": data["subject"],
                "subject_key": subject,
                "chapter_number": chapter["chapter_number"],
                "chapter_name": chapter["chapter_name"],
                "word_count": chapter.get("word_count", 0),
                "summary": text,
                "formatted_html": formatted,
            }

    raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found")


async def _background_format(subject: str, chapter_num: str, text: str, chapter_name: str, subject_name: str):
    """Format chapter with AI in the background and cache the result."""
    try:
        formatted = await format_chapter_with_ai(text, chapter_name, subject_name)
        if formatted:
            formatted = formatted.strip()
            if formatted.startswith("```"):
                formatted = "\n".join(formatted.split("\n")[1:])
            if formatted.endswith("```"):
                formatted = "\n".join(formatted.split("\n")[:-1])
            save_cached_chapter(subject, chapter_num, formatted)
            ai_logger.info(f"BG_FORMAT_DONE | {subject_name} / {chapter_name} — cached for next view")
    except Exception as e:
        ai_logger.error(f"BG_FORMAT_FAIL | {subject_name} / {chapter_name} | {e}")


# --- Pre-cache status tracker ---
_precache_status = {
    "running": False,
    "total": 0,
    "done": 0,
    "skipped": 0,
    "failed": 0,
    "current": "",
    "complete": False,
}


async def _precache_all_chapters():
    """On startup: format ALL chapters with AI and cache them. Rate-limited to avoid hammering Gemini."""
    global _precache_status
    if not ai_backend:
        ai_logger.info("PRECACHE: No AI backend — skipping")
        return

    _precache_status["running"] = True
    _precache_status["complete"] = False

    DATA_DIR = Path(__file__).parent / "data"
    all_chapters = []

    # Collect all chapters across all subjects
    for json_file in DATA_DIR.glob("*.json"):
        if json_file.name == "index.json":
            continue
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            subject_key = json_file.stem
            subject_name = data.get("subject", subject_key)
            for ch in data.get("chapters", []):
                all_chapters.append((subject_key, subject_name, ch))
        except Exception as e:
            ai_logger.error(f"PRECACHE: Failed to read {json_file.name}: {e}")

    _precache_status["total"] = len(all_chapters)
    ai_logger.info(f"PRECACHE: Starting — {len(all_chapters)} chapters to process")

    for subject_key, subject_name, chapter in all_chapters:
        ch_num = chapter.get("chapter_number", "")
        ch_name = chapter.get("chapter_name", "")
        text = chapter.get("text", "")
        _precache_status["current"] = f"{subject_name} / {ch_name}"

        # Skip if already cached
        if get_cached_chapter(subject_key, ch_num):
            ai_logger.info(f"PRECACHE: SKIP (already cached) {subject_name} / {ch_name}")
            _precache_status["skipped"] += 1
            _precache_status["done"] += 1
            continue

        if not text:
            ai_logger.warning(f"PRECACHE: SKIP (no text) {subject_name} / {ch_name}")
            _precache_status["skipped"] += 1
            _precache_status["done"] += 1
            continue

        try:
            ai_logger.info(f"PRECACHE: Formatting {subject_name} / {ch_name}...")
            formatted = await format_chapter_with_ai(text, ch_name, subject_name)
            if formatted:
                formatted = formatted.strip()
                if formatted.startswith("```"):
                    formatted = "\n".join(formatted.split("\n")[1:])
                if formatted.endswith("```"):
                    formatted = "\n".join(formatted.split("\n")[:-1])
                save_cached_chapter(subject_key, ch_num, formatted)
                ai_logger.info(f"PRECACHE: DONE {subject_name} / {ch_name}")
            else:
                ai_logger.warning(f"PRECACHE: FAILED (validation rejected) {subject_name} / {ch_name}")
                _precache_status["failed"] += 1
        except Exception as e:
            ai_logger.error(f"PRECACHE: ERROR {subject_name} / {ch_name} — {e}")
            _precache_status["failed"] += 1

        _precache_status["done"] += 1
        # Respect free tier rate limit: 20 req/min → 4 sec between requests
        await asyncio.sleep(4)

    _precache_status["running"] = False
    _precache_status["complete"] = True
    _precache_status["current"] = ""
    ai_logger.info(
        f"PRECACHE: Complete — {_precache_status['done']} done, "
        f"{_precache_status['skipped']} skipped, {_precache_status['failed']} failed"
    )


async def _keep_alive():
    """Ping self every 10 minutes to prevent Render cold start."""
    import httpx
    render_url = os.getenv("RENDER_EXTERNAL_URL", "")
    if not render_url:
        ai_logger.info("KEEP_ALIVE: No RENDER_EXTERNAL_URL set, skipping")
        return
    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(600)  # 10 minutes
            try:
                await client.get(f"{render_url}/api/health", timeout=10)
                ai_logger.info("KEEP_ALIVE: ping OK")
            except Exception as e:
                ai_logger.warning(f"KEEP_ALIVE: ping failed — {e}")


@app.on_event("startup")
async def startup_event():
    """Kick off background pre-caching of all chapters on server start."""
    ai_logger.info("SERVER STARTUP — kicking off chapter pre-cache...")
    asyncio.ensure_future(_precache_all_chapters())
    asyncio.ensure_future(_keep_alive())

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


@app.get("/api/verify/chapter/{subject}/{chapter_num}")
async def verify_chapter(subject: str, chapter_num: str):
    """Verification endpoint — inspect what the app actually has for a chapter."""
    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    for chapter in data.get("chapters", []):
        if chapter["chapter_number"] == chapter_num:
            raw_text = chapter.get("text", "")
            source_hash = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()

            # Check if formatted version exists in cache
            formatted = get_cached_chapter(subject, chapter_num) or ""
            validation = validate_formatted_content(raw_text, formatted) if formatted else None

            return {
                "subject": data["subject"],
                "subject_key": subject,
                "chapter_num": chapter_num,
                "chapter_name": chapter["chapter_name"],
                "source_preview": raw_text[:500],
                "formatted_preview": formatted[:500] if formatted else "Not yet formatted",
                "source_hash": source_hash,
                "source_char_count": len(raw_text),
                "formatted_char_count": len(formatted),
                "validation": validation,
            }

    raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found in {subject}")


# ── Ready Reckoner ────────────────────────────────────────────────────────────

RECKONER_CACHE_DIR = Path(__file__).parent / "cache" / "reckoner"
RECKONER_CACHE_DIR.mkdir(parents=True, exist_ok=True)

RECKONER_PROMPT = """You are a CBSE Class 9 exam preparation expert.
Create a concise READY RECKONER (cheat sheet) for this chapter in clean HTML.

STRUCTURE — use exactly these sections (only include what's relevant to the chapter):

<div class="rr-card">
  <div class="rr-section rr-facts">
    <h4>📅 Key Facts / Dates / Events</h4>
    <ul><li><strong>YYYY:</strong> Event description</li></ul>
  </div>
  <div class="rr-section rr-people">
    <h4>👤 Important People / Places</h4>
    <ul><li><strong>Name:</strong> Who they were / significance</li></ul>
  </div>
  <div class="rr-section rr-terms">
    <h4>📖 Key Terms & Definitions</h4>
    <ul><li><strong>Term:</strong> Simple definition</li></ul>
  </div>
  <div class="rr-section rr-causes">
    <h4>⚡ Causes / Reasons</h4>
    <ul><li>Point 1</li></ul>
  </div>
  <div class="rr-section rr-effects">
    <h4>📊 Effects / Results / Significance</h4>
    <ul><li>Point 1</li></ul>
  </div>
  <div class="rr-section rr-exam">
    <h4>🎯 Most Likely Exam Questions</h4>
    <ul><li>Question likely to appear in exam</li></ul>
  </div>
  <div class="rr-section rr-remember">
    <h4>💡 Must Remember</h4>
    <ul><li>Critical one-liner to memorise</li></ul>
  </div>
</div>

RULES:
- Keep each point SHORT — one line max
- Use ONLY the HTML structure above, no other tags or markdown
- Skip sections not applicable (e.g. Maths won't have People/Dates)
- For Maths/Science: include Formulas section instead of People/Dates
- For Social Studies: always include Dates, People, Causes, Effects
- Max 8 bullet points per section — be selective, exam-focused
- Do NOT wrap in code blocks
"""

def get_reckoner_cache(subject: str, chapter_num: str) -> Optional[str]:
    f = RECKONER_CACHE_DIR / f"{subject}_{chapter_num}.html"
    return f.read_text(encoding="utf-8") if f.exists() else None

def save_reckoner_cache(subject: str, chapter_num: str, html: str):
    f = RECKONER_CACHE_DIR / f"{subject}_{chapter_num}.html"
    f.write_text(html, encoding="utf-8")


@app.get("/api/reckoner/{subject}/{chapter_num}")
async def get_reckoner(subject: str, chapter_num: str):
    """Return AI-generated ready reckoner for a chapter. Cached after first generation."""
    # Check cache
    cached = get_reckoner_cache(subject, chapter_num)
    if cached:
        return {"html": cached, "cached": True}

    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    chapter = next((c for c in data.get("chapters", []) if c["chapter_number"] == chapter_num), None)
    if not chapter:
        raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found")

    text = chapter.get("text", "")
    prompt = (
        f"Subject: {data['subject']}\n"
        f"Chapter {chapter_num}: {chapter['chapter_name']}\n\n"
        f"--- Chapter Content (first 10000 chars) ---\n{text[:10000]}"
    )

    try:
        html = await call_ai(RECKONER_PROMPT, prompt)
        # Strip code fences if any
        html = html.strip()
        if html.startswith("```"):
            html = "\n".join(html.split("\n")[1:])
        if html.endswith("```"):
            html = "\n".join(html.split("\n")[:-1])
        save_reckoner_cache(subject, chapter_num, html)
        return {"html": html, "cached": False}
    except Exception as e:
        # Fallback: return basic formatted chapter content as reckoner
        ai_logger.error(f"Reckoner AI failed for {subject}/{chapter_num}: {e}")
        fallback_html = (
            f'<div class="rr-card"><div class="rr-section">'
            f'<h4>📖 Chapter Summary</h4>{basic_html_format(text[:5000])}'
            f'</div><div class="rr-section"><h4>⚠️ AI reckoner unavailable right now</h4>'
            f'<p>Try again in a minute — the AI service is busy. Meanwhile, here\'s the chapter content.</p>'
            f'</div></div>'
        )
        return {"html": fallback_html, "cached": False}


# ── Practice Problems ────────────────────────────────────────────────────────

PRACTICE_CACHE_DIR = Path(__file__).parent / "cache" / "practice"
PRACTICE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

BRAINTEASER_CACHE_DIR = Path(__file__).parent / "cache" / "brainteaser"
BRAINTEASER_CACHE_DIR.mkdir(parents=True, exist_ok=True)

PRACTICE_PROMPT = """You are a CBSE Class 9 exam question paper setter.
Generate 10 practice problems for this chapter in clean HTML.

STRUCTURE:
<div class="practice-set">
  <div class="practice-q" data-type="fill-blank">
    <div class="q-badge">Fill in the Blank</div>
    <div class="q-number">1</div>
    <div class="q-text">Question text with _______ for blanks</div>
    <div class="q-answer" style="display:none">
      <strong>Answer:</strong> The answer here
    </div>
  </div>
  <!-- more questions... -->
</div>

QUESTION MIX:
- 2x Fill in the Blank (data-type="fill-blank")
- 2x True/False with explanation (data-type="true-false")
- 3x Short Answer, 2-3 lines expected (data-type="short-answer")
- 2x Long Answer / Application-based, 5-6 lines (data-type="long-answer")
- 1x Diagram/Visual/Map-based question (data-type="diagram")

RULES:
- Questions should cover the ENTIRE chapter, not just the beginning
- Include questions from different difficulty levels (easy -> medium -> hard)
- Short answers should test understanding, not just recall
- Long answers should require application/analysis
- Include mark weightage hints: [1 mark], [2 marks], [3 marks], [5 marks]
- Do NOT wrap in code blocks
- Output raw HTML only
"""

BRAINTEASER_PROMPT = """You are a creative educator designing challenging "out of the box" thinking problems for a bright Class 9 student.
Generate 5 brain teasers based on this chapter's concepts in clean HTML.

STRUCTURE:
<div class="brainteaser-set">
  <div class="bt-card">
    <div class="bt-number">1</div>
    <div class="bt-type">What If?</div>
    <div class="bt-question">The challenging question here...</div>
    <div class="bt-hint" style="display:none">
      <strong>Hint:</strong> A nudge in the right direction
    </div>
    <div class="bt-answer" style="display:none">
      <strong>Think about it:</strong> The explanation/answer
    </div>
  </div>
</div>

QUESTION TYPES (use a mix):
- "What If?" — change one condition and ask what happens
- "Real World Detective" — apply chapter concepts to solve a real scenario
- "Cross-Subject Connection" — link this chapter to another subject
- "Puzzle/Riddle" — a fun brain teaser using chapter concepts
- "Debate This" — a provocative statement to argue for/against

RULES:
- These must NOT be textbook questions — they should surprise and challenge
- Each question should make the student pause and THINK
- Hints should nudge without giving away the answer
- Answers should explain the reasoning, not just state facts
- Make them fun and engaging — a 14-year-old should want to solve them
- Do NOT wrap in code blocks
- Output raw HTML only
"""


def get_practice_cache(subject: str, chapter_num: str) -> Optional[str]:
    f = PRACTICE_CACHE_DIR / f"{subject}_{chapter_num}.html"
    return f.read_text(encoding="utf-8") if f.exists() else None

def save_practice_cache(subject: str, chapter_num: str, html: str):
    f = PRACTICE_CACHE_DIR / f"{subject}_{chapter_num}.html"
    f.write_text(html, encoding="utf-8")

def get_brainteaser_cache(subject: str, chapter_num: str) -> Optional[str]:
    f = BRAINTEASER_CACHE_DIR / f"{subject}_{chapter_num}.html"
    return f.read_text(encoding="utf-8") if f.exists() else None

def save_brainteaser_cache(subject: str, chapter_num: str, html: str):
    f = BRAINTEASER_CACHE_DIR / f"{subject}_{chapter_num}.html"
    f.write_text(html, encoding="utf-8")


@app.get("/api/practice/{subject}/{chapter_num}")
async def get_practice(subject: str, chapter_num: str):
    """Return AI-generated practice problems for a chapter. Cached after first generation."""
    cached = get_practice_cache(subject, chapter_num)
    if cached:
        return {"html": cached, "cached": True}

    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    chapter = next((c for c in data.get("chapters", []) if c["chapter_number"] == chapter_num), None)
    if not chapter:
        raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found")

    text = chapter.get("text", "")
    prompt = (
        f"Subject: {data['subject']}\n"
        f"Chapter {chapter_num}: {chapter['chapter_name']}\n\n"
        f"--- Chapter Content (first 10000 chars) ---\n{text[:10000]}"
    )

    try:
        html = await call_ai(PRACTICE_PROMPT, prompt)
        html = html.strip()
        if html.startswith("```"):
            html = "\n".join(html.split("\n")[1:])
        if html.endswith("```"):
            html = "\n".join(html.split("\n")[:-1])
        save_practice_cache(subject, chapter_num, html)
        return {"html": html, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@app.get("/api/brainteaser/{subject}/{chapter_num}")
async def get_brainteaser(subject: str, chapter_num: str):
    """Return AI-generated brain teasers for a chapter. Cached after first generation."""
    cached = get_brainteaser_cache(subject, chapter_num)
    if cached:
        return {"html": cached, "cached": True}

    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    chapter = next((c for c in data.get("chapters", []) if c["chapter_number"] == chapter_num), None)
    if not chapter:
        raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found")

    text = chapter.get("text", "")
    prompt = (
        f"Subject: {data['subject']}\n"
        f"Chapter {chapter_num}: {chapter['chapter_name']}\n\n"
        f"--- Chapter Content (first 10000 chars) ---\n{text[:10000]}"
    )

    try:
        html = await call_ai(BRAINTEASER_PROMPT, prompt)
        html = html.strip()
        if html.startswith("```"):
            html = "\n".join(html.split("\n")[1:])
        if html.endswith("```"):
            html = "\n".join(html.split("\n")[:-1])
        save_brainteaser_cache(subject, chapter_num, html)
        return {"html": html, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


# ── Interactive Practice (Hydra Mode) ─────────────────────────────────────────

class PracticeGenerateRequest(BaseModel):
    subject: str
    chapter_num: str
    count: int = 5
    difficulty: str = "mixed"
    exclude_ids: List[str] = []
    focus_concept: Optional[str] = None

PRACTICE_MCQ_PROMPT = """You are a CBSE Class 9 question generator. Generate {count} multiple-choice questions for this chapter.

Return ONLY a JSON array (no markdown, no code blocks, no explanation). Each element:
{{
  "question": "The question text",
  "options": {{"A": "option 1", "B": "option 2", "C": "option 3", "D": "option 4"}},
  "correct": "A",
  "explanation": "Why this is correct - brief",
  "concept": "The specific topic/concept tested",
  "difficulty": "easy|medium|hard"
}}

{difficulty_instruction}
{focus_instruction}

RULES:
- Questions must be exam-relevant for CBSE Class 9
- Each option should be plausible (no obviously wrong answers)
- Explanation should teach, not just state the answer
- Cover different parts of the chapter
- Output ONLY the JSON array, nothing else
"""

@app.post("/api/practice/generate")
async def generate_practice_mcqs(request: PracticeGenerateRequest):
    """Generate interactive MCQ questions for a chapter."""
    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    data = load_subject_data(request.subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{request.subject}' not found")

    chapter = next(
        (c for c in data.get("chapters", []) if c["chapter_number"] == request.chapter_num),
        None
    )
    if not chapter:
        raise HTTPException(status_code=404, detail=f"Chapter {request.chapter_num} not found")

    # Build difficulty instruction
    if request.difficulty == "easier":
        difficulty_instruction = "Make these questions EASIER than typical — they are follow-up questions for a student who got a similar question wrong."
    elif request.difficulty == "easy":
        difficulty_instruction = "Make all questions EASY difficulty."
    elif request.difficulty == "hard":
        difficulty_instruction = "Make all questions HARD difficulty."
    elif request.difficulty == "medium":
        difficulty_instruction = "Make all questions MEDIUM difficulty."
    else:
        difficulty_instruction = "Mix difficulty levels: include easy, medium, and hard questions."

    # Build focus instruction
    if request.focus_concept:
        focus_instruction = f"Focus ALL questions on the concept: {request.focus_concept}. Make them progressively easier to help the student understand."
    else:
        focus_instruction = ""

    prompt_template = PRACTICE_MCQ_PROMPT.format(
        count=request.count,
        difficulty_instruction=difficulty_instruction,
        focus_instruction=focus_instruction,
    )

    text = chapter.get("text", "")
    user_prompt = (
        f"Subject: {data['subject']}\n"
        f"Chapter {request.chapter_num}: {chapter['chapter_name']}\n\n"
        f"--- Chapter Content (first 10000 chars) ---\n{text[:10000]}"
    )

    try:
        raw = await call_ai(prompt_template, user_prompt)
        # Strip code fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = "\n".join(raw.split("\n")[:-1])
        raw = raw.strip()

        questions = json.loads(raw)
        if not isinstance(questions, list):
            raise ValueError("AI did not return a JSON array")

        # Assign UUIDs and validate structure
        for q in questions:
            q["id"] = str(uuid.uuid4())
            # Ensure required fields exist
            if "question" not in q or "options" not in q or "correct" not in q:
                continue  # skip malformed
            if "explanation" not in q:
                q["explanation"] = ""
            if "concept" not in q:
                q["concept"] = "General"
            if "difficulty" not in q:
                q["difficulty"] = "medium"

        # Filter out any whose id is in exclude_ids (shouldn't happen with UUIDs, but safety)
        questions = [q for q in questions if q.get("id") not in request.exclude_ids]

        return {"questions": questions}

    except json.JSONDecodeError as e:
        ai_logger.error(f"PRACTICE_MCQ_JSON_ERROR | {e} | raw={raw[:500]}")
        raise HTTPException(status_code=500, detail="AI returned invalid JSON. Please try again.")
    except Exception as e:
        ai_logger.error(f"PRACTICE_MCQ_ERROR | {e}")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


# ── NCERT Solutions ──────────────────────────────────────────────────────────

NCERT_SOLUTIONS_CACHE_DIR = Path(__file__).parent / "cache" / "ncert-solutions"
NCERT_SOLUTIONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

NCERT_SOLUTIONS_PROMPT = """You are an expert NCERT textbook solutions provider for CBSE Class 9.
Solve all exercise questions from the NCERT textbook for this chapter.

RULES:
- Show step-by-step working for each question
- Number each question clearly
- For Maths/Science: show every calculation step
- For Social Studies/English: provide concise, exam-ready answers
- Use clean HTML formatting (no markdown, no code blocks)
- Use <h4> for exercise/question group headings
- Use <div class="solution-q"> to wrap each question-answer pair
- Use <strong> for question text and important terms
- Keep language simple — a 14-year-old should understand
- Be thorough but concise
- Do NOT wrap in code blocks or backticks
"""

def get_ncert_solutions_cache(subject: str, chapter_num: str) -> Optional[str]:
    f = NCERT_SOLUTIONS_CACHE_DIR / f"{subject}_{chapter_num}.html"
    return f.read_text(encoding="utf-8") if f.exists() else None

def save_ncert_solutions_cache(subject: str, chapter_num: str, html: str):
    f = NCERT_SOLUTIONS_CACHE_DIR / f"{subject}_{chapter_num}.html"
    f.write_text(html, encoding="utf-8")


@app.get("/api/ncert-solutions/{subject}/{chapter_num}")
async def get_ncert_solutions(subject: str, chapter_num: str):
    """Return AI-generated NCERT exercise solutions for a chapter. Cached after first generation."""
    cached = get_ncert_solutions_cache(subject, chapter_num)
    if cached:
        return {"html": cached, "cached": True}

    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    data = load_subject_data(subject)
    if not data:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found")

    chapter = next((c for c in data.get("chapters", []) if c["chapter_number"] == chapter_num), None)
    if not chapter:
        raise HTTPException(status_code=404, detail=f"Chapter {chapter_num} not found")

    text = chapter.get("text", "")
    user_prompt = (
        f"Solve all exercise questions from NCERT Class 9 {data['subject']} "
        f"Chapter {chapter_num}: {chapter['chapter_name']}. "
        f"Show step-by-step working for each question. Format as clean HTML with question numbers.\n\n"
        f"--- Chapter Content (first 10000 chars) ---\n{text[:10000]}"
    )

    try:
        html = await call_ai(NCERT_SOLUTIONS_PROMPT, user_prompt)
        html = html.strip()
        if html.startswith("```"):
            html = "\n".join(html.split("\n")[1:])
        if html.endswith("```"):
            html = "\n".join(html.split("\n")[:-1])
        save_ncert_solutions_cache(subject, chapter_num, html)
        return {"html": html, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


# ── Snap & Solve (Image-based question solver) ──────────────────────────────

SNAP_SOLVE_TEMP_DIR = Path(__file__).parent / "cache" / "snap-temp"
SNAP_SOLVE_TEMP_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/api/snap-solve")
async def snap_solve(
    image: UploadFile = File(...),
    subject: Optional[str] = Form(None),
):
    """Accept an image of a homework/textbook question, read it with Gemini vision, and solve it."""
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
            detail=f"Daily question limit reached ({DAILY_LIMIT} questions). Come back tomorrow!",
        )

    # Read image bytes
    image_bytes = await image.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty image file")
    if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    # Determine mime type
    content_type = image.content_type or "image/jpeg"
    if content_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        content_type = "image/jpeg"

    prompt_text = (
        "This is a photo of a homework/textbook question for CBSE Class 9. "
        "Read the question from the image and solve it step-by-step. "
        "Show all working. If it's a math problem, show each calculation step. "
        "Format your response in markdown."
    )
    if subject:
        index = load_index()
        subject_name = index.get(subject, {}).get("name", subject)
        prompt_text = f"Subject: {subject_name}\n\n" + prompt_text

    try:
        if ai_backend == "gemini":
            from google.genai import types
            loop = asyncio.get_event_loop()

            def _snap_solve_sync():
                import time
                last_error = None
                for model_name in GEMINI_MODELS:
                    for attempt in range(3):
                        try:
                            response = gemini_client.models.generate_content(
                                model=model_name,
                                contents=[
                                    types.Content(parts=[
                                        types.Part.from_text(prompt_text),
                                        types.Part.from_bytes(data=image_bytes, mime_type=content_type)
                                    ])
                                ]
                            )
                            return response.text
                        except Exception as e:
                            last_error = e
                            err_str = str(e)
                            if "503" in err_str or "UNAVAILABLE" in err_str or "overloaded" in err_str.lower():
                                wait = (attempt + 1) * 2
                                ai_logger.warning(f"Snap-solve Gemini {model_name} attempt {attempt+1} failed (503), retrying in {wait}s...")
                                time.sleep(wait)
                            else:
                                raise
                    ai_logger.warning(f"Snap-solve: All retries exhausted for {model_name}, trying next model...")
                raise Exception(f"All Gemini models unavailable. Last error: {last_error}")

            answer = await asyncio.wait_for(
                loop.run_in_executor(_ai_executor, _snap_solve_sync),
                timeout=AI_CALL_TIMEOUT,
            )
        elif ai_backend == "groq":
            # Groq doesn't support vision — use text-only fallback
            raise HTTPException(
                status_code=400,
                detail="Snap & Solve requires Gemini AI backend. Groq does not support image analysis.",
            )
        else:
            raise HTTPException(status_code=503, detail="AI not configured")

        # Increment usage
        updated_usage = increment_usage()

        return {
            "answer": answer,
            "image_text": "Image analyzed by AI",
            "usage_today": updated_usage["count"],
            "usage_limit": DAILY_LIMIT,
            "usage_remaining": max(0, DAILY_LIMIT - updated_usage["count"]),
        }
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=500, detail=f"AI response timed out after {AI_CALL_TIMEOUT} seconds. Please try again.")
    except Exception as e:
        ai_logger.error(f"SNAP_SOLVE_ERROR | {e}")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


# ── Progress & Gamification ──────────────────────────────────────────────────

LEVEL_NAMES = {
    1: "Kitten", 2: "Cat", 3: "Tomcat", 4: "Panther", 5: "Cat Noir",
    6: "Chat Noir", 7: "Cataclysm", 8: "Miraculous", 9: "Legendary Cat", 10: "Ultimate Cat Noir",
}

BADGE_DEFINITIONS = [
    {"id": "first_steps", "name": "First Steps", "desc": "Complete first practice", "icon": "🎯"},
    {"id": "hat_trick", "name": "Hat Trick", "desc": "3 correct in a row", "icon": "🎩"},
    {"id": "on_fire", "name": "On Fire", "desc": "10 correct streak", "icon": "🔥"},
    {"id": "subject_star", "name": "Subject Star", "desc": "90%+ accuracy in any subject", "icon": "⭐"},
    {"id": "brain_bender", "name": "Brain Bender", "desc": "Complete 5 brain teasers", "icon": "🧠"},
    {"id": "mock_master", "name": "Mock Master", "desc": "Score 80%+ on a mock test", "icon": "🏅"},
    {"id": "daily_grind", "name": "Daily Grind", "desc": "Practice 3 days in a row", "icon": "📆"},
    {"id": "centurion", "name": "Centurion", "desc": "Answer 100 questions total", "icon": "💯"},
    {"id": "perfectionist", "name": "Perfectionist", "desc": "100% on any quiz", "icon": "✨"},
    {"id": "hydra_slayer", "name": "Hydra Slayer", "desc": "Defeat all hydra spawns in a practice", "icon": "🐍"},
]


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"records": [], "badges": [], "xp": 0, "brain_teasers_done": 0}


def save_progress(data: dict):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def calculate_xp_for_record(score: int, total: int, streak: int, is_mock: bool) -> int:
    xp = score * 10
    if streak >= 3:
        xp += (streak - 2) * 5
    xp += 50  # quiz completion bonus
    if is_mock:
        xp += 50  # extra mock test bonus (total 100)
    return xp


def check_badges(progress: dict) -> list:
    earned = set(progress.get("badges", []))
    new_badges = []
    records = progress.get("records", [])

    # First Steps
    if "first_steps" not in earned and len(records) > 0:
        new_badges.append("first_steps")

    # Hat Trick
    if "hat_trick" not in earned:
        for r in records:
            if r.get("best_streak", 0) >= 3:
                new_badges.append("hat_trick")
                break

    # On Fire
    if "on_fire" not in earned:
        for r in records:
            if r.get("best_streak", 0) >= 10:
                new_badges.append("on_fire")
                break

    # Subject Star — 90%+ in any subject (min 10 questions)
    if "subject_star" not in earned:
        subject_stats = {}
        for r in records:
            subj = r.get("subject", "")
            if subj not in subject_stats:
                subject_stats[subj] = {"answered": 0, "correct": 0}
            subject_stats[subj]["answered"] += r.get("total", 0)
            subject_stats[subj]["correct"] += r.get("score", 0)
        for st in subject_stats.values():
            if st["answered"] >= 10 and (st["correct"] / st["answered"]) >= 0.9:
                new_badges.append("subject_star")
                break

    # Brain Bender
    if "brain_bender" not in earned and progress.get("brain_teasers_done", 0) >= 5:
        new_badges.append("brain_bender")

    # Mock Master
    if "mock_master" not in earned:
        for r in records:
            if r.get("is_mock") and r.get("total", 0) > 0:
                if (r["score"] / r["total"]) >= 0.8:
                    new_badges.append("mock_master")
                    break

    # Daily Grind — 3 consecutive days
    if "daily_grind" not in earned:
        dates = sorted(set(r.get("date", "") for r in records))
        streak_count = 1
        for i in range(1, len(dates)):
            try:
                d1 = datetime.strptime(dates[i - 1], "%Y-%m-%d").date()
                d2 = datetime.strptime(dates[i], "%Y-%m-%d").date()
                if (d2 - d1).days == 1:
                    streak_count += 1
                    if streak_count >= 3:
                        new_badges.append("daily_grind")
                        break
                else:
                    streak_count = 1
            except ValueError:
                streak_count = 1

    # Centurion
    total_answered = sum(r.get("total", 0) for r in records)
    if "centurion" not in earned and total_answered >= 100:
        new_badges.append("centurion")

    # Perfectionist
    if "perfectionist" not in earned:
        for r in records:
            if r.get("total", 0) >= 3 and r.get("score", 0) == r.get("total", 0):
                new_badges.append("perfectionist")
                break

    # Hydra Slayer
    if "hydra_slayer" not in earned:
        for r in records:
            if r.get("hydra_spawned", 0) > 0 and r.get("hydra_defeated", False):
                new_badges.append("hydra_slayer")
                break

    return new_badges


class ProgressRecordRequest(BaseModel):
    subject: str
    chapter_num: str = ""
    score: int
    total: int
    wrong_concepts: List[str] = []
    best_streak: int = 0
    hydra_spawned: int = 0
    hydra_defeated: bool = False
    is_mock: bool = False


@app.post("/api/progress/record")
async def record_progress(request: ProgressRecordRequest):
    progress = load_progress()
    today = str(date.today())

    xp_gained = calculate_xp_for_record(
        request.score, request.total, request.best_streak, request.is_mock
    )
    progress["xp"] = progress.get("xp", 0) + xp_gained

    record = {
        "date": today,
        "subject": request.subject,
        "chapter_num": request.chapter_num,
        "score": request.score,
        "total": request.total,
        "wrong_concepts": request.wrong_concepts,
        "best_streak": request.best_streak,
        "hydra_spawned": request.hydra_spawned,
        "hydra_defeated": request.hydra_defeated,
        "is_mock": request.is_mock,
        "xp_gained": xp_gained,
    }
    progress.setdefault("records", []).append(record)

    # Check for new badges
    new_badges = check_badges(progress)
    for b in new_badges:
        if b not in progress.get("badges", []):
            progress.setdefault("badges", []).append(b)

    save_progress(progress)

    level = floor(progress["xp"] / 200) + 1
    level_name = LEVEL_NAMES.get(min(level, 10), "Genius")

    return {
        "xp_gained": xp_gained,
        "total_xp": progress["xp"],
        "level": level,
        "level_name": level_name,
        "new_badges": new_badges,
    }


@app.post("/api/progress/check-badges")
async def check_badges_endpoint():
    progress = load_progress()
    new_badges = check_badges(progress)
    for b in new_badges:
        if b not in progress.get("badges", []):
            progress.setdefault("badges", []).append(b)
    save_progress(progress)
    return {"new_badges": new_badges}


@app.get("/api/progress/summary")
async def get_progress_summary():
    progress = load_progress()
    records = progress.get("records", [])

    total_answered = sum(r.get("total", 0) for r in records)
    total_correct = sum(r.get("score", 0) for r in records)
    accuracy_pct = round((total_correct / total_answered) * 100) if total_answered > 0 else 0

    # Subject-wise breakdown
    subjects = {}
    for r in records:
        subj = r.get("subject", "unknown")
        if subj not in subjects:
            subjects[subj] = {"answered": 0, "correct": 0, "chapters_practiced": []}
        subjects[subj]["answered"] += r.get("total", 0)
        subjects[subj]["correct"] += r.get("score", 0)
        ch = r.get("chapter_num", "")
        if ch and ch not in subjects[subj]["chapters_practiced"]:
            subjects[subj]["chapters_practiced"].append(ch)

    for subj in subjects.values():
        subj["accuracy"] = round((subj["correct"] / subj["answered"]) * 100) if subj["answered"] > 0 else 0

    # Weak concepts
    concept_counts = {}
    for r in records:
        for c in r.get("wrong_concepts", []):
            concept_counts[c] = concept_counts.get(c, 0) + 1
    weak_concepts = sorted(concept_counts.keys(), key=lambda c: concept_counts[c], reverse=True)[:10]

    # Daily log (last 7 days)
    daily = {}
    for r in records:
        d = r.get("date", "")
        if d not in daily:
            daily[d] = {"date": d, "questions": 0, "correct": 0}
        daily[d]["questions"] += r.get("total", 0)
        daily[d]["correct"] += r.get("score", 0)
    daily_log = sorted(daily.values(), key=lambda x: x["date"], reverse=True)[:7]

    # Streaks
    practice_dates = sorted(set(r.get("date", "") for r in records if r.get("date")))
    current_streak = 0
    best_streak = 0
    if practice_dates:
        today_str = str(date.today())
        yesterday_str = str(date.today() - timedelta(days=1))
        if practice_dates[-1] in (today_str, yesterday_str):
            current_streak = 1
            for i in range(len(practice_dates) - 2, -1, -1):
                try:
                    d1 = datetime.strptime(practice_dates[i], "%Y-%m-%d").date()
                    d2 = datetime.strptime(practice_dates[i + 1], "%Y-%m-%d").date()
                    if (d2 - d1).days == 1:
                        current_streak += 1
                    else:
                        break
                except ValueError:
                    break
        s = 1
        for i in range(1, len(practice_dates)):
            try:
                d1 = datetime.strptime(practice_dates[i - 1], "%Y-%m-%d").date()
                d2 = datetime.strptime(practice_dates[i], "%Y-%m-%d").date()
                if (d2 - d1).days == 1:
                    s += 1
                    best_streak = max(best_streak, s)
                else:
                    s = 1
            except ValueError:
                s = 1
        best_streak = max(best_streak, current_streak)

    xp = progress.get("xp", 0)
    level = floor(xp / 200) + 1
    level_name = LEVEL_NAMES.get(min(level, 10), "Genius")

    index = load_index()

    return {
        "total_questions_answered": total_answered,
        "total_correct": total_correct,
        "accuracy_percent": accuracy_pct,
        "subjects": subjects,
        "weak_concepts": weak_concepts,
        "daily_log": daily_log,
        "streaks": {"current": current_streak, "best": best_streak},
        "xp": xp,
        "level": level,
        "level_name": level_name,
        "badges": progress.get("badges", []),
        "badge_definitions": BADGE_DEFINITIONS,
        "all_subjects": {
            k: {
                "name": v.get("name", k),
                "emoji": v.get("emoji", ""),
                "chapters": [c["number"] for c in v.get("chapters", [])]
            }
            for k, v in index.items() if v.get("total_chapters", 0) > 0
        },
    }


@app.get("/api/progress/reset")
async def reset_progress():
    save_progress({"records": [], "badges": [], "xp": 0, "brain_teasers_done": 0})
    return {"status": "ok", "message": "All progress has been reset."}


# ── Mock Test ────────────────────────────────────────────────────────────────

class MockTestGenerateRequest(BaseModel):
    subjects: List[str]
    question_count: int = 30
    time_minutes: int = 45


class MockTestSubmitRequest(BaseModel):
    questions: list
    answers: dict
    time_taken_seconds: int = 0


MOCKTEST_MCQ_PROMPT = """You are a CBSE Class 9 exam paper setter. Generate {count} multiple-choice questions spread across the given chapters.

Return ONLY a JSON array (no markdown, no code blocks). Each element:
{{
  "question": "The question text",
  "options": {{"A": "option 1", "B": "option 2", "C": "option 3", "D": "option 4"}},
  "correct": "A",
  "explanation": "Brief explanation",
  "concept": "Topic tested",
  "difficulty": "easy|medium|hard",
  "subject": "subject key",
  "chapter_num": "chapter number"
}}

Mix difficulty: 30% easy, 50% medium, 20% hard.
Cover different chapters proportionally.
Output ONLY the JSON array.
"""


@app.post("/api/mocktest/generate")
async def generate_mock_test(request: MockTestGenerateRequest):
    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    context_parts = []
    for subj_key in request.subjects:
        data = load_subject_data(subj_key)
        if not data:
            continue
        subj_name = data.get("subject", subj_key)
        for ch in data.get("chapters", []):
            text = ch.get("text", "")
            context_parts.append(
                f"[{subj_key}] {subj_name} - Chapter {ch['chapter_number']}: {ch['chapter_name']}\n{text[:2000]}"
            )

    if not context_parts:
        raise HTTPException(status_code=400, detail="No valid subjects selected")

    combined_context = "\n\n---\n\n".join(context_parts)
    if len(combined_context) > 30000:
        combined_context = combined_context[:30000]

    prompt_template = MOCKTEST_MCQ_PROMPT.format(count=request.question_count)
    user_prompt = f"Generate questions from these subjects and chapters:\n\n{combined_context}"

    try:
        raw = await call_ai(prompt_template, user_prompt)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = "\n".join(raw.split("\n")[:-1])
        raw = raw.strip()

        questions = json.loads(raw)
        if not isinstance(questions, list):
            raise ValueError("AI did not return a JSON array")

        for i, q in enumerate(questions):
            q["id"] = str(uuid.uuid4())
            q["index"] = i
            if "explanation" not in q:
                q["explanation"] = ""
            if "concept" not in q:
                q["concept"] = "General"
            if "difficulty" not in q:
                q["difficulty"] = "medium"
            if "subject" not in q:
                q["subject"] = request.subjects[0] if request.subjects else ""
            if "chapter_num" not in q:
                q["chapter_num"] = ""

        return {
            "questions": questions,
            "time_minutes": request.time_minutes,
            "subject_count": len(request.subjects),
        }
    except json.JSONDecodeError as e:
        ai_logger.error(f"MOCKTEST_JSON_ERROR | {e}")
        raise HTTPException(status_code=500, detail="AI returned invalid JSON. Please try again.")
    except Exception as e:
        ai_logger.error(f"MOCKTEST_ERROR | {e}")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@app.post("/api/mocktest/submit")
async def submit_mock_test(request: MockTestSubmitRequest):
    questions = request.questions
    answers = request.answers
    total = len(questions)
    correct = 0
    results = []
    subject_breakdown = {}

    for i, q in enumerate(questions):
        idx_str = str(i)
        user_ans = answers.get(idx_str, "")
        is_correct = user_ans == q.get("correct", "")
        if is_correct:
            correct += 1

        subj = q.get("subject", "unknown")
        if subj not in subject_breakdown:
            subject_breakdown[subj] = {"total": 0, "correct": 0}
        subject_breakdown[subj]["total"] += 1
        if is_correct:
            subject_breakdown[subj]["correct"] += 1

        results.append({
            "question": q.get("question", ""),
            "options": q.get("options", {}),
            "correct_answer": q.get("correct", ""),
            "user_answer": user_ans,
            "is_correct": is_correct,
            "explanation": q.get("explanation", ""),
            "concept": q.get("concept", ""),
            "subject": subj,
        })

    for subj in subject_breakdown.values():
        subj["accuracy"] = round((subj["correct"] / subj["total"]) * 100) if subj["total"] > 0 else 0

    pct = round((correct / total) * 100) if total > 0 else 0

    return {
        "total": total,
        "correct": correct,
        "percentage": pct,
        "subject_breakdown": subject_breakdown,
        "results": results,
    }


# ── Study Planner ────────────────────────────────────────────────────────────

PLANNER_PROMPT = """You are a CBSE Class 9 study planner AI. Create a day-by-day study plan.

Given the exam date, subjects, chapters, daily study hours, and the student's weak areas,
create an optimal study plan.

Return ONLY a JSON object (no markdown, no code blocks):
{{
  "plan_name": "Exam Prep Plan",
  "total_days": N,
  "tasks": [
    {{
      "date": "2026-06-25",
      "day_number": 1,
      "tasks": [
        {{
          "subject": "maths",
          "chapter_num": "01",
          "chapter_name": "Chapter Name",
          "activity": "Study & revise",
          "duration_minutes": 30,
          "priority": "high|medium|low"
        }}
      ]
    }}
  ]
}}

RULES:
- Spread subjects across days (don't do all maths in one day)
- Put weak topics earlier and repeat them
- Include revision days before the exam
- Keep each day's total within the daily_hours limit
- Mix easy and hard topics within a day
- Output ONLY the JSON object
"""


def load_planner() -> dict:
    if PLANNER_FILE.exists():
        try:
            with open(PLANNER_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_planner(data: dict):
    with open(PLANNER_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class PlannerGenerateRequest(BaseModel):
    exam_date: str
    subjects: List[str]
    daily_hours: int = 2


class PlannerCompleteRequest(BaseModel):
    date: str
    task_index: int


@app.post("/api/planner/generate")
async def generate_study_plan(request: PlannerGenerateRequest):
    if not ai_backend:
        raise HTTPException(status_code=503, detail="AI not configured")

    index = load_index()
    chapters_info = []
    for subj in request.subjects:
        subj_data = index.get(subj, {})
        for ch in subj_data.get("chapters", []):
            chapters_info.append(f"{subj}: Chapter {ch['number']} - {ch['name']}")

    progress = load_progress()
    concept_counts = {}
    for r in progress.get("records", []):
        for c in r.get("wrong_concepts", []):
            concept_counts[c] = concept_counts.get(c, 0) + 1
    weak_concepts = sorted(concept_counts.keys(), key=lambda c: concept_counts[c], reverse=True)[:10]

    today_str = str(date.today())
    user_prompt = (
        f"Today's date: {today_str}\n"
        f"Exam date: {request.exam_date}\n"
        f"Daily study hours: {request.daily_hours}\n\n"
        f"Chapters to cover:\n" + "\n".join(chapters_info) + "\n\n"
        f"Weak areas (need extra focus): {', '.join(weak_concepts) if weak_concepts else 'None identified yet'}\n"
    )

    try:
        raw = await call_ai(PLANNER_PROMPT, user_prompt)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = "\n".join(raw.split("\n")[:-1])
        raw = raw.strip()

        plan = json.loads(raw)
        plan["completed_tasks"] = []
        plan["created_at"] = today_str
        plan["exam_date"] = request.exam_date
        plan["subjects"] = request.subjects
        plan["daily_hours"] = request.daily_hours

        save_planner(plan)
        return plan
    except json.JSONDecodeError as e:
        ai_logger.error(f"PLANNER_JSON_ERROR | {e}")
        raise HTTPException(status_code=500, detail="AI returned invalid plan format. Please try again.")
    except Exception as e:
        ai_logger.error(f"PLANNER_ERROR | {e}")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@app.get("/api/planner/current")
async def get_current_plan():
    plan = load_planner()
    if not plan:
        return {"has_plan": False}
    plan["has_plan"] = True
    return plan


@app.post("/api/planner/complete")
async def complete_planner_task(request: PlannerCompleteRequest):
    plan = load_planner()
    if not plan:
        raise HTTPException(status_code=404, detail="No plan found")

    completed = plan.setdefault("completed_tasks", [])
    task_key = f"{request.date}_{request.task_index}"
    if task_key not in completed:
        completed.append(task_key)
    else:
        completed.remove(task_key)

    save_planner(plan)
    return {"status": "ok", "completed_tasks": completed}


# Serve static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def serve_frontend():
    return FileResponse(str(STATIC_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

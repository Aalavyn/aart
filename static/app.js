// Umayal's Study Coach — Frontend JS

let subjectsData = {};

// === Fetch with Timeout Wrapper ===
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const signal = controller.signal;

    // Merge any existing signal with our timeout signal
    if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
    }
    options.signal = signal;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, options);
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Request timed out. The server may be starting up — please try again in a moment.');
        }
        throw err;
    }
}

// === Wake-Up Detection ===
let serverAwake = false;

async function ensureServerAwake() {
    if (serverAwake) return;

    // Fire a quick health ping — if it responds fast, server is warm
    const start = Date.now();
    try {
        await fetchWithTimeout('/api/health', {}, 5000);
        serverAwake = true;
        return;
    } catch (e) {
        // Server didn't respond in 5s — it's probably cold-starting
    }

    // Show wake-up banner
    showWakeUpBanner();

    // Keep pinging until server responds (up to 60s)
    const maxWait = 60000;
    const interval = 3000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, interval));
        try {
            await fetchWithTimeout('/api/health', {}, 5000);
            serverAwake = true;
            hideWakeUpBanner();
            return;
        } catch (e) {
            // Still waking up
        }
    }

    hideWakeUpBanner();
    // Server may still work, just slow — let the actual request try
}

function showWakeUpBanner() {
    let banner = document.getElementById('wakeup-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'wakeup-banner';
        banner.className = 'wakeup-banner';
        banner.innerHTML = '<span class="wakeup-spinner"></span> Server is waking up... This can take 30-40 seconds on the free tier. Please wait!';
        document.getElementById('app').prepend(banner);
    }
    banner.style.display = 'flex';
}

function hideWakeUpBanner() {
    const banner = document.getElementById('wakeup-banner');
    if (banner) banner.style.display = 'none';
}


// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    loadSubjects();
    loadUsage();
    document.getElementById('subject-select').addEventListener('change', onSubjectSelectChange);
    document.getElementById('question-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askDoubt();
        }
    });

    // Keep-alive: ping server every 5 minutes to prevent cold starts
    setInterval(() => {
        fetch('/api/health').catch(() => {});
    }, 5 * 60 * 1000);
});

// === View Navigation ===
function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${view}-view`).classList.add('active');
    const navBtn = document.querySelector(`[data-view="${view}"]`);
    if (navBtn) navBtn.classList.add('active');
    if (view === 'reckoner') initReckoner();
    if (view === 'practice') initPractice();
}

// === Usage Tracking ===
async function loadUsage() {
    try {
        const res = await fetchWithTimeout('/api/usage', {}, 30000);
        const data = await res.json();
        updateUsageDisplay(data.today, data.limit, data.remaining);
    } catch (err) {
        // Usage display is non-critical, fail silently
    }
}

function updateUsageDisplay(used, limit, remaining) {
    const badge = document.getElementById('usage-badge');
    if (!badge) return;
    badge.classList.remove('usage-ok', 'usage-warn', 'usage-limit');
    if (remaining <= 0) {
        badge.classList.add('usage-limit');
        badge.textContent = `Limit reached (${limit}/${limit}) — come back tomorrow!`;
    } else if (remaining <= 10) {
        badge.classList.add('usage-warn');
        badge.textContent = `${used}/${limit} questions today`;
    } else {
        badge.classList.add('usage-ok');
        badge.textContent = `${used}/${limit} questions today`;
    }
}

// === Load Subjects ===
async function loadSubjects() {
    const container = document.getElementById('subjects-accordion');

    try {
        // Wait for server to be awake before loading subjects
        await ensureServerAwake();

        const res = await fetchWithTimeout('/api/subjects', {}, 30000);
        if (!res.ok) throw new Error('Server returned an error');
        const data = await res.json();
        subjectsData = data.subjects;
        renderSubjectsAccordion();
        populateSubjectSelect();
    } catch (err) {
        container.innerHTML =
            '<div class="error-msg">' +
            'Could not load subjects. The server may still be starting up.' +
            '<br><button class="retry-btn" onclick="loadSubjects()">Retry</button>' +
            '</div>';
    }
}

function renderSubjectsAccordion() {
    const container = document.getElementById('subjects-accordion');
    const entries = Object.entries(subjectsData);

    if (entries.length === 0) {
        container.innerHTML = '<div class="loading">No subjects found.</div>';
        return;
    }

    container.innerHTML = entries.map(([key, subject]) => {
        const chapters = subject.chapters || [];
        const chaptersHtml = chapters.length === 0
            ? '<div class="no-chapters">No chapters available</div>'
            : chapters.map(ch => `
                <div class="chapter-row" onclick="showChapterDetail('${key}', '${ch.number}')">
                    <span class="ch-num">${parseInt(ch.number)}</span>
                    <span class="ch-name">${ch.name}</span>
                    <span class="ch-ask" onclick="event.stopPropagation(); askAboutChapter('${key}', '${ch.number}', '${escapeAttr(ch.name)}')">Ask</span>
                </div>
            `).join('');

        return `
            <div class="subject-block" id="subj-${key}">
                <div class="subject-header" onclick="toggleSubject('${key}')">
                    <div class="subject-title">
                        <span class="subject-emoji">${subject.emoji}</span>
                        <span class="subject-name">${subject.name}</span>
                        <span class="chapter-count">${subject.total_chapters} chapters</span>
                    </div>
                    <span class="toggle-icon" id="toggle-${key}">▶</span>
                </div>
                <div class="chapter-list-expanded collapsed" id="chapters-${key}">
                    ${chaptersHtml}
                </div>
            </div>
        `;
    }).join('');
}

function toggleSubject(key) {
    const list = document.getElementById(`chapters-${key}`);
    const icon = document.getElementById(`toggle-${key}`);
    if (list.classList.contains('collapsed')) {
        list.classList.remove('collapsed');
        icon.textContent = '▼';
    } else {
        list.classList.add('collapsed');
        icon.textContent = '▶';
    }
}

function populateSubjectSelect() {
    const select = document.getElementById('subject-select');
    select.innerHTML = '<option value="">Select a subject...</option>';
    for (const [key, subject] of Object.entries(subjectsData)) {
        select.innerHTML += `<option value="${key}">${subject.emoji} ${subject.name}</option>`;
    }
}

// === Subject Select Change ===
function onSubjectSelectChange() {
    const subjectKey = document.getElementById('subject-select').value;
    const chapterRow = document.getElementById('chapter-select-row');
    const chapterSelect = document.getElementById('chapter-select');

    if (subjectKey && subjectsData[subjectKey]) {
        chapterSelect.innerHTML = '<option value="">All chapters</option>';
        const chapters = subjectsData[subjectKey].chapters || [];
        chapters.forEach(ch => {
            chapterSelect.innerHTML += `<option value="${ch.number}">Ch ${parseInt(ch.number)}: ${ch.name}</option>`;
        });
        chapterRow.style.display = 'block';
    } else {
        chapterRow.style.display = 'none';
    }
}

// === Chapter Detail ===
async function showChapterDetail(subjectKey, chapterNum) {
    showView('chapter');
    const content = document.getElementById('chapter-content');
    content.innerHTML = '<div class="loading">Loading chapter...</div>';

    try {
        const res = await fetchWithTimeout(`/api/chapter/${subjectKey}/${chapterNum}`, {}, 60000);
        if (!res.ok) throw new Error('Could not load chapter');
        const data = await res.json();

        const bodyHtml = data.formatted_html
            ? data.formatted_html
            : `<div class="chapter-text">${escapeHtml(data.summary)}</div>`;

        content.innerHTML = `
            <div class="chapter-hero">
                <h2>Chapter ${parseInt(data.chapter_number)}: ${data.chapter_name}</h2>
                <div class="meta">${data.subject} • ${data.word_count.toLocaleString()} words</div>
            </div>
            <div class="chapter-body">${bodyHtml}</div>
            <div class="chapter-actions">
                <button class="ask-about-btn" onclick="askAboutChapter('${subjectKey}', '${chapterNum}', '${escapeAttr(data.chapter_name)}')">
                    Ask a doubt about this chapter
                </button>
            </div>
        `;
    } catch (err) {
        content.innerHTML =
            '<div class="error-msg">Could not load chapter content. ' + escapeHtml(err.message) +
            '<br><button class="retry-btn" onclick="showChapterDetail(\'' + subjectKey + '\', \'' + chapterNum + '\')">Retry</button>' +
            '</div>';
    }
}

function askAboutChapter(subjectKey, chapterNum, chapterName) {
    showView('doubt');
    document.getElementById('subject-select').value = subjectKey;
    onSubjectSelectChange();
    setTimeout(() => {
        document.getElementById('chapter-select').value = chapterNum;
    }, 50);
    document.getElementById('question-input').focus();
    document.getElementById('question-input').placeholder =
        `Ask about Chapter ${parseInt(chapterNum)}: ${chapterName}...`;
}

// === Doubt Solver ===
// Store last question details for retry
let _lastAskParams = null;

async function askDoubt(retryParams) {
    let subjectKey, question, chapterNum;

    if (retryParams) {
        // Retry with saved params
        subjectKey = retryParams.subject;
        question = retryParams.question;
        chapterNum = retryParams.chapter;
    } else {
        subjectKey = document.getElementById('subject-select').value;
        question = document.getElementById('question-input').value.trim();
        chapterNum = document.getElementById('chapter-select')?.value || '';

        if (!subjectKey) { alert('Please select a subject!'); return; }
        if (!question) { alert('Please type your question!'); return; }
    }

    // Save for retry
    _lastAskParams = { subject: subjectKey, question: question, chapter: chapterNum };

    const btn = document.getElementById('ask-btn');
    btn.disabled = true;
    btn.textContent = 'Thinking...';

    const history = document.getElementById('chat-history');
    const subjectName = subjectsData[subjectKey]?.name || subjectKey;

    // Only add question bubble if this is not a retry (avoid duplicates)
    if (!retryParams) {
        history.innerHTML = `
            <div class="chat-bubble chat-question">
                <div class="q-label">${subjectName}${chapterNum ? ' • Ch ' + parseInt(chapterNum) : ''}</div>
                ${escapeHtml(question)}
            </div>
            <div class="chat-bubble chat-answer" id="loading-bubble">
                <div class="loading-dots"><span></span><span></span><span></span></div>
                <div class="loading-status" id="loading-status"></div>
            </div>
        ` + history.innerHTML;
    } else {
        // For retry, replace the error bubble with a new loading bubble
        const existingError = document.getElementById('error-bubble');
        if (existingError) {
            existingError.id = 'loading-bubble';
            existingError.innerHTML = `
                <div class="loading-dots"><span></span><span></span><span></span></div>
                <div class="loading-status" id="loading-status"></div>
            `;
            existingError.classList.remove('error-state');
        }
    }

    // Show "waiting" status after 3 seconds if still loading
    const statusTimer = setTimeout(() => {
        const statusEl = document.getElementById('loading-status');
        if (statusEl) {
            statusEl.textContent = 'The AI is thinking... this can take 10-20 seconds.';
        }
    }, 3000);

    // Show "server may be waking up" after 10 seconds
    const wakeTimer = setTimeout(() => {
        const statusEl = document.getElementById('loading-status');
        if (statusEl) {
            statusEl.textContent = 'Still working... the server may have been asleep. Hang tight!';
        }
    }, 10000);

    try {
        const res = await fetchWithTimeout('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: subjectKey, question, chapter: chapterNum || null }),
        }, 60000); // 60s timeout for AI calls

        clearTimeout(statusTimer);
        clearTimeout(wakeTimer);

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Something went wrong');

        const lb = document.getElementById('loading-bubble');
        if (lb) {
            lb.removeAttribute('id');
            lb.innerHTML = `
                <div class="a-label">Study Coach</div>
                <div class="answer-text">${renderMarkdown(data.answer)}</div>
            `;
        }
        if (data.usage_today !== undefined) {
            updateUsageDisplay(data.usage_today, data.usage_limit, data.usage_remaining);
        }
    } catch (err) {
        clearTimeout(statusTimer);
        clearTimeout(wakeTimer);

        const lb = document.getElementById('loading-bubble');
        if (lb) {
            lb.id = 'error-bubble';
            lb.classList.add('error-state');
            lb.innerHTML = `
                <div class="error-msg">
                    ${escapeHtml(err.message)}
                    <br>
                    <button class="retry-btn" onclick="askDoubt(_lastAskParams)">Retry this question</button>
                </div>
            `;
        }
    }

    btn.disabled = false;
    btn.textContent = 'Ask My Doubt';
    if (!retryParams) {
        document.getElementById('question-input').value = '';
    }
}

// === Ready Reckoner ===
let reckonerSubject = null;

function initReckoner() {
    const tabsEl = document.getElementById('reckoner-subject-tabs');
    if (tabsEl.children.length > 0) return; // already built

    // Build subject tab buttons from loaded subjects
    const subjects = Object.entries(subjectsData);
    if (subjects.length === 0) {
        tabsEl.innerHTML = '<p style="color:var(--text-light)">Subjects not loaded yet. Go to Subjects tab first.</p>';
        return;
    }

    tabsEl.innerHTML = subjects
        .filter(([, s]) => s.total_chapters > 0)
        .map(([key, s]) => `
            <button class="rr-subject-tab" id="rr-tab-${key}" onclick="loadReckonerSubject('${key}')">
                ${s.emoji} ${s.name}
            </button>
        `).join('');
}

async function loadReckonerSubject(subjectKey) {
    // Highlight active tab
    document.querySelectorAll('.rr-subject-tab').forEach(t => t.classList.remove('active'));
    const tab = document.getElementById(`rr-tab-${subjectKey}`);
    if (tab) tab.classList.add('active');

    reckonerSubject = subjectKey;
    const subject = subjectsData[subjectKey];
    const content = document.getElementById('reckoner-content');

    // Build chapter accordion skeleton — chapters expand to show reckoner on click
    content.innerHTML = `
        <div class="rr-chapter-list">
            ${subject.chapters.map(ch => `
                <div class="rr-chapter-block" id="rr-block-${subjectKey}-${ch.number}">
                    <div class="rr-chapter-header" onclick="toggleReckoner('${subjectKey}', '${ch.number}', '${escapeAttr(ch.name)}')">
                        <span class="rr-ch-num">Ch ${parseInt(ch.number)}</span>
                        <span class="rr-ch-name">${ch.name}</span>
                        <span class="rr-toggle" id="rr-toggle-${subjectKey}-${ch.number}">▶ View Reckoner</span>
                    </div>
                    <div class="rr-chapter-body collapsed" id="rr-body-${subjectKey}-${ch.number}">
                        <div class="rr-placeholder">Click to generate reckoner...</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function toggleReckoner(subjectKey, chapterNum, chapterName) {
    const body = document.getElementById(`rr-body-${subjectKey}-${chapterNum}`);
    const toggle = document.getElementById(`rr-toggle-${subjectKey}-${chapterNum}`);

    if (!body.classList.contains('collapsed')) {
        body.classList.add('collapsed');
        toggle.textContent = '▶ View Reckoner';
        return;
    }

    body.classList.remove('collapsed');
    toggle.textContent = '▼ Hide';

    // Already loaded?
    if (body.dataset.loaded === 'true') return;

    body.innerHTML = `<div class="rr-loading"><span class="rr-spinner"></span> Generating reckoner for "${chapterName}"... (first time takes ~10 sec)</div>`;

    try {
        const res = await fetchWithTimeout(`/api/reckoner/${subjectKey}/${chapterNum}`, {}, 60000);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to load reckoner');
        }
        const data = await res.json();
        body.innerHTML = data.html;
        body.dataset.loaded = 'true';
        if (data.cached) {
            toggle.textContent = '▼ Hide (cached ⚡)';
        }
    } catch (err) {
        body.innerHTML = `
            <div class="error-msg">
                ${escapeHtml(err.message)}
                <br><button class="retry-btn" onclick="body.dataset.loaded=''; toggleReckoner('${subjectKey}', '${chapterNum}', '${escapeAttr(chapterName)}')">Retry</button>
            </div>`;
    }
}

// === Practice Problems ===
let practiceSubject = null;
let practiceMode = 'practice'; // 'practice' or 'brainteaser'

// Hydra Mode state
let practiceState = {
    subject: null,
    chapter: null,
    chapterName: null,
    questions: [],
    currentIndex: 0,
    score: 0,
    totalAnswered: 0,
    streak: 0,
    bestStreak: 0,
    wrongCount: 0,
    hydraSpawned: 0,
    wrongConcepts: [],
    excludeIds: [],
    completed: false,
    answering: false  // lock to prevent double-clicks
};

function initPractice() {
    const tabsEl = document.getElementById('practice-subject-tabs');
    if (tabsEl.children.length > 0) return; // already built

    const subjects = Object.entries(subjectsData);
    if (subjects.length === 0) {
        tabsEl.innerHTML = '<p style="color:var(--text-light)">Subjects not loaded yet. Go to Subjects tab first.</p>';
        return;
    }

    tabsEl.innerHTML = subjects
        .filter(([, s]) => s.total_chapters > 0)
        .map(([key, s]) => `
            <button class="rr-subject-tab" id="pr-tab-${key}" onclick="loadPracticeSubject('${key}')">
                ${s.emoji} ${s.name}
            </button>
        `).join('');
}

function switchPracticeMode(mode) {
    practiceMode = mode;
    document.getElementById('mode-practice').classList.toggle('active', mode === 'practice');
    document.getElementById('mode-brainteaser').classList.toggle('active', mode === 'brainteaser');

    const content = document.getElementById('practice-content');

    if (mode === 'brainteaser') {
        // Reset brain teaser loaded state
        document.querySelectorAll('.pr-chapter-body').forEach(el => {
            el.dataset.loaded = '';
            el.classList.add('collapsed');
            el.innerHTML = '<div class="rr-placeholder">Click to generate...</div>';
        });
        document.querySelectorAll('.pr-toggle').forEach(el => {
            el.textContent = '▶ Brain Teaser';
        });
        // Reload the chapter list for brain teaser mode
        if (practiceSubject) loadPracticeSubject(practiceSubject);
    } else {
        // Practice mode — reload the chapter list for interactive quiz
        if (practiceSubject) loadPracticeSubject(practiceSubject);
    }
}

async function loadPracticeSubject(subjectKey) {
    // Highlight active tab
    document.querySelectorAll('#practice-subject-tabs .rr-subject-tab').forEach(t => t.classList.remove('active'));
    const tab = document.getElementById(`pr-tab-${subjectKey}`);
    if (tab) tab.classList.add('active');

    practiceSubject = subjectKey;
    const subject = subjectsData[subjectKey];
    const content = document.getElementById('practice-content');

    if (practiceMode === 'brainteaser') {
        // Brain teaser mode — old accordion UI
        content.innerHTML = `
            <div class="rr-chapter-list">
                ${subject.chapters.map(ch => `
                    <div class="rr-chapter-block" id="pr-block-${subjectKey}-${ch.number}">
                        <div class="rr-chapter-header" onclick="toggleBrainTeaser('${subjectKey}', '${ch.number}', '${escapeAttr(ch.name)}')">
                            <span class="rr-ch-num">Ch ${parseInt(ch.number)}</span>
                            <span class="rr-ch-name">${ch.name}</span>
                            <span class="pr-toggle rr-toggle" id="pr-toggle-${subjectKey}-${ch.number}">▶ Brain Teaser</span>
                        </div>
                        <div class="pr-chapter-body rr-chapter-body collapsed" id="pr-body-${subjectKey}-${ch.number}">
                            <div class="rr-placeholder">Click to generate...</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        // Practice mode — interactive quiz chapter list
        content.innerHTML = `
            <div class="rr-chapter-list">
                ${subject.chapters.map(ch => `
                    <div class="rr-chapter-block quiz-chapter-block" id="pr-block-${subjectKey}-${ch.number}">
                        <div class="rr-chapter-header" onclick="startQuiz('${subjectKey}', '${ch.number}', '${escapeAttr(ch.name)}')">
                            <span class="rr-ch-num">Ch ${parseInt(ch.number)}</span>
                            <span class="rr-ch-name">${ch.name}</span>
                            <span class="rr-toggle quiz-start-label">▶ Start Practice</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

// --- Brain Teaser (old static accordion, unchanged) ---
async function toggleBrainTeaser(subjectKey, chapterNum, chapterName) {
    const body = document.getElementById(`pr-body-${subjectKey}-${chapterNum}`);
    const toggle = document.getElementById(`pr-toggle-${subjectKey}-${chapterNum}`);

    if (!body.classList.contains('collapsed')) {
        body.classList.add('collapsed');
        toggle.textContent = '▶ Brain Teaser';
        return;
    }

    body.classList.remove('collapsed');
    toggle.textContent = '▼ Hide';

    if (body.dataset.loaded === 'brainteaser') return;

    body.innerHTML = `<div class="rr-loading"><span class="rr-spinner"></span> Generating brain teasers for "${chapterName}"... (first time takes ~10 sec)</div>`;

    try {
        const res = await fetchWithTimeout(`/api/brainteaser/${subjectKey}/${chapterNum}`, {}, 60000);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to load');
        }
        const data = await res.json();
        let html = data.html;
        html = html.replace(/<div class="bt-hint" style="display:none">/g,
            '<button class="reveal-btn hint-reveal-btn" onclick="togglePracticeAnswer(this)">Show hint</button><div class="bt-hint" style="display:none">');
        html = html.replace(/<div class="bt-answer" style="display:none">/g,
            '<button class="reveal-btn" onclick="togglePracticeAnswer(this)">Click to reveal answer</button><div class="bt-answer" style="display:none">');
        body.innerHTML = html;
        body.dataset.loaded = 'brainteaser';
        if (data.cached) {
            toggle.textContent = '▼ Hide (cached)';
        }
    } catch (err) {
        body.innerHTML = `
            <div class="error-msg">
                ${escapeHtml(err.message)}
                <br><button class="retry-btn" onclick="this.closest('.pr-chapter-body').dataset.loaded=''; toggleBrainTeaser('${subjectKey}', '${chapterNum}', '${escapeAttr(chapterName)}')">Retry</button>
            </div>`;
    }
}

function togglePracticeAnswer(btn) {
    const target = btn.nextElementSibling;
    if (target.style.display === 'none') {
        target.style.display = 'block';
        btn.textContent = btn.classList.contains('hint-reveal-btn') ? 'Hide hint' : 'Hide answer';
    } else {
        target.style.display = 'none';
        btn.textContent = btn.classList.contains('hint-reveal-btn') ? 'Show hint' : 'Click to reveal answer';
    }
}

// --- Interactive Quiz (Hydra Mode) ---

async function startQuiz(subjectKey, chapterNum, chapterName) {
    // Reset state
    practiceState = {
        subject: subjectKey,
        chapter: chapterNum,
        chapterName: chapterName,
        questions: [],
        currentIndex: 0,
        score: 0,
        totalAnswered: 0,
        streak: 0,
        bestStreak: 0,
        wrongCount: 0,
        hydraSpawned: 0,
        wrongConcepts: [],
        excludeIds: [],
        completed: false,
        answering: false
    };

    const content = document.getElementById('practice-content');
    const subjectName = subjectsData[subjectKey]?.name || subjectKey;
    content.innerHTML = `
        <div class="quiz-loading-screen">
            <div class="quiz-loading-icon"><span class="rr-spinner quiz-spinner"></span></div>
            <h3>Generating practice questions...</h3>
            <p>${subjectName} - Ch ${parseInt(chapterNum)}: ${chapterName}</p>
            <p class="quiz-loading-sub">First time may take ~10 seconds</p>
        </div>
    `;

    try {
        const res = await fetchWithTimeout('/api/practice/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subject: subjectKey,
                chapter_num: chapterNum,
                count: 5,
                difficulty: 'mixed',
                exclude_ids: [],
                focus_concept: null
            })
        }, 60000);

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to generate questions');
        }
        const data = await res.json();
        practiceState.questions = data.questions;
        practiceState.excludeIds = data.questions.map(q => q.id);
        renderQuizQuestion();
    } catch (err) {
        content.innerHTML = `
            <div class="error-msg">
                ${escapeHtml(err.message)}
                <br><button class="retry-btn" onclick="startQuiz('${subjectKey}', '${chapterNum}', '${escapeAttr(chapterName)}')">Retry</button>
                <button class="retry-btn" style="margin-left:8px" onclick="loadPracticeSubject('${subjectKey}')">Back to Chapters</button>
            </div>`;
    }
}

function renderQuizQuestion() {
    const s = practiceState;
    if (s.currentIndex >= s.questions.length) {
        renderQuizResults();
        return;
    }

    const q = s.questions[s.currentIndex];
    const content = document.getElementById('practice-content');
    const subjectName = subjectsData[s.subject]?.name || s.subject;
    const totalQ = s.questions.length;
    const progressPct = Math.round((s.currentIndex / totalQ) * 100);

    const diffClass = q.difficulty === 'easy' ? 'diff-easy' : q.difficulty === 'hard' ? 'diff-hard' : 'diff-medium';
    const diffLabel = q.difficulty ? q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1) : 'Medium';

    content.innerHTML = `
        <div class="quiz-card">
            <div class="quiz-back-row">
                <button class="back-btn" onclick="loadPracticeSubject('${s.subject}')">← Back to Chapters</button>
                <span class="quiz-chapter-label">${subjectName} - Ch ${parseInt(s.chapter)}: ${s.chapterName}</span>
            </div>
            <div class="quiz-header">
                <div class="quiz-progress-bar-wrap">
                    <div class="quiz-progress-bar" style="width: ${progressPct}%"></div>
                </div>
                <div class="quiz-header-info">
                    <div class="quiz-progress">Question ${s.currentIndex + 1} of ${totalQ}</div>
                    <div class="quiz-stats">
                        <span class="quiz-score">Score: ${s.score}/${s.totalAnswered}</span>
                        <span class="quiz-streak">${s.streak > 0 ? '&#128293; ' : ''}Streak: ${s.streak}</span>
                    </div>
                </div>
            </div>
            <div class="quiz-difficulty">
                <span class="diff-badge ${diffClass}">${diffLabel}</span>
                <span class="concept-tag">${escapeHtml(q.concept || 'General')}</span>
            </div>
            <div class="quiz-question">${escapeHtml(q.question)}</div>
            <div class="quiz-options">
                ${['A', 'B', 'C', 'D'].map(letter => `
                    <button class="option-btn" id="opt-${letter}" onclick="selectAnswer('${letter}')">
                        <span class="option-letter">${letter}</span>
                        <span class="option-text">${escapeHtml(q.options[letter] || '')}</span>
                    </button>
                `).join('')}
            </div>
            <div class="quiz-explanation" id="quiz-explanation" style="display:none"></div>
            <div class="hydra-msg" id="hydra-msg" style="display:none"></div>
            <button class="quiz-next-btn" id="quiz-next-btn" style="display:none" onclick="nextQuestion()">
                Next Question →
            </button>
        </div>
    `;
}

function selectAnswer(selected) {
    const s = practiceState;
    if (s.answering || s.completed) return;
    s.answering = true;

    const q = s.questions[s.currentIndex];
    const isCorrect = selected === q.correct;

    // Disable all buttons
    document.querySelectorAll('.option-btn').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('disabled');
    });

    // Highlight correct and wrong
    const selectedBtn = document.getElementById(`opt-${selected}`);
    const correctBtn = document.getElementById(`opt-${q.correct}`);

    if (isCorrect) {
        selectedBtn.classList.add('correct');
        s.score++;
        s.streak++;
        if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    } else {
        selectedBtn.classList.add('wrong');
        correctBtn.classList.add('reveal-correct');
        s.streak = 0;
        s.wrongCount++;
        if (!s.wrongConcepts.includes(q.concept)) {
            s.wrongConcepts.push(q.concept);
        }
        // Show hydra message
        const hydraMsg = document.getElementById('hydra-msg');
        hydraMsg.style.display = 'block';
        hydraMsg.innerHTML = '<span class="hydra-icon">&#128013;</span> Hydra! 2 more questions spawned on this topic!';
        hydraMsg.classList.add('hydra-animate');

        // Spawn 2 more questions in background
        spawnHydraQuestions(q.concept);
    }

    s.totalAnswered++;

    // Show explanation
    const explEl = document.getElementById('quiz-explanation');
    explEl.style.display = 'block';
    explEl.innerHTML = `<strong>${isCorrect ? 'Correct!' : 'Not quite.'}</strong> ${escapeHtml(q.explanation || '')}`;
    explEl.className = 'quiz-explanation ' + (isCorrect ? 'explanation-correct' : 'explanation-wrong');

    // Show next button
    document.getElementById('quiz-next-btn').style.display = 'block';
}

async function spawnHydraQuestions(concept) {
    const s = practiceState;
    s.hydraSpawned += 2;

    try {
        const res = await fetchWithTimeout('/api/practice/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subject: s.subject,
                chapter_num: s.chapter,
                count: 2,
                difficulty: 'easier',
                exclude_ids: s.excludeIds,
                focus_concept: concept
            })
        }, 60000);

        if (!res.ok) return; // silently fail — quiz continues with remaining questions

        const data = await res.json();
        if (data.questions && data.questions.length > 0) {
            s.questions.push(...data.questions);
            s.excludeIds.push(...data.questions.map(q => q.id));
        }
    } catch (e) {
        // Silently fail — quiz continues
    }
}

function nextQuestion() {
    practiceState.currentIndex++;
    practiceState.answering = false;
    renderQuizQuestion();
}

function renderQuizResults() {
    const s = practiceState;
    s.completed = true;
    const content = document.getElementById('practice-content');
    const subjectName = subjectsData[s.subject]?.name || s.subject;

    const pct = s.totalAnswered > 0 ? Math.round((s.score / s.totalAnswered) * 100) : 0;
    let emoji, message;
    if (pct >= 90) { emoji = '&#127942;'; message = 'Outstanding! You nailed it!'; }
    else if (pct >= 70) { emoji = '&#128170;'; message = 'Great job! Keep it up!'; }
    else if (pct >= 50) { emoji = '&#128218;'; message = 'Good effort! Review the weak topics below.'; }
    else { emoji = '&#128170;'; message = 'Keep practicing! You will get there!'; }

    const weakTopicsHtml = s.wrongConcepts.length > 0
        ? `<div class="results-weak">
               <h4>Topics to review:</h4>
               <ul>${s.wrongConcepts.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
           </div>`
        : '<div class="results-weak"><p>No weak topics — perfect score!</p></div>';

    content.innerHTML = `
        <div class="quiz-results">
            <div class="results-emoji">${emoji}</div>
            <h3>Practice Complete!</h3>
            <p class="results-chapter">${subjectName} - Ch ${parseInt(s.chapter)}: ${s.chapterName}</p>
            <p class="results-message">${message}</p>
            <div class="results-stats">
                <div class="result-stat">
                    <span class="result-stat-num">${s.score}/${s.totalAnswered}</span>
                    <span class="result-stat-label">Score (${pct}%)</span>
                </div>
                <div class="result-stat">
                    <span class="result-stat-num">&#128293; ${s.bestStreak}</span>
                    <span class="result-stat-label">Best Streak</span>
                </div>
                <div class="result-stat">
                    <span class="result-stat-num">&#128013; ${s.hydraSpawned}</span>
                    <span class="result-stat-label">Hydra Spawned</span>
                </div>
            </div>
            ${weakTopicsHtml}
            <div class="results-actions">
                <button class="quiz-action-btn primary" onclick="startQuiz('${s.subject}', '${s.chapter}', '${escapeAttr(s.chapterName)}')">Try Again</button>
                <button class="quiz-action-btn secondary" onclick="loadPracticeSubject('${s.subject}')">Back to Chapters</button>
            </div>
        </div>
    `;
}

function restartPractice() {
    const s = practiceState;
    if (s.subject && s.chapter) {
        startQuiz(s.subject, s.chapter, s.chapterName);
    }
}

// === Helpers ===
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[234]>)/g, '$1');
    html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    return html;
}

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
    loadXpHeader();
    document.getElementById('subject-select').addEventListener('change', onSubjectSelectChange);
    document.getElementById('question-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askDoubt();
        }
    });

    // Mock test sliders
    const qSlider = document.getElementById('mt-question-count');
    const tSlider = document.getElementById('mt-time');
    if (qSlider) qSlider.addEventListener('input', () => { document.getElementById('mt-question-label').textContent = qSlider.value; });
    if (tSlider) tSlider.addEventListener('input', () => { document.getElementById('mt-time-label').textContent = tSlider.value + ' min'; });

    // Keep-alive: ping server every 5 minutes to prevent cold starts
    setInterval(() => {
        fetch('/api/health').catch(() => {});
    }, 5 * 60 * 1000);

    // Init Snap & Solve file input listener
    initSnapSolve();

    // Init Cat Noir quote rotator
    initCatNoirQuotes();
});

// === Cat Noir Quotes ===
function initCatNoirQuotes() {
    const quotes = [
        '"Time to save the day... with studying! \uD83D\uDC3E" \u2014 Cat Noir',
        '"A true hero never stops learning!" \u2014 Cat Noir',
        '"Claws out for knowledge! \uD83D\uDC31" \u2014 Cat Noir',
        '"Plagg would be proud of your studying!" \u2014 Cat Noir',
        '"Miraculous study powers, activate!" \u2014 Cat Noir',
    ];
    const el = document.getElementById('cat-noir-quote');
    if (!el) return;
    let idx = 0;
    setInterval(() => {
        idx = (idx + 1) % quotes.length;
        el.style.opacity = '0';
        setTimeout(() => {
            el.textContent = quotes[idx];
            el.style.opacity = '0.7';
        }, 500);
    }, 30000);
}

// === View Navigation ===
function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${view}-view`).classList.add('active');
    const navBtn = document.querySelector(`[data-view="${view}"]`);
    if (navBtn) navBtn.classList.add('active');
    if (view === 'reckoner') initReckoner();
    if (view === 'practice') initPractice();
    if (view === 'mocktest') initMockTestSetup();
    if (view === 'planner') initPlanner();
    if (view === 'progress') loadProgressDashboard();
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
        const res = await fetchWithTimeout(`/api/chapter/${subjectKey}/${chapterNum}`, {}, 120000);
        if (!res.ok) throw new Error('Could not load chapter');
        const data = await res.json();

        const bodyHtml = data.formatted_html
            ? data.formatted_html
            : `<div class="chapter-text">${escapeHtml(data.summary)}</div>`;

        content.innerHTML = `
            <div class="chapter-hero">
                <h2>Chapter ${parseInt(data.chapter_number)}: ${data.chapter_name}</h2>
                <div class="meta">${data.subject} • ${data.word_count.toLocaleString()} words</div>
                <button class="read-aloud-btn" onclick="readAloud(this)" style="margin-top:10px">🔊 Read Aloud</button>
            </div>
            <div class="chapter-body readable-content">${bodyHtml}</div>
            <div class="chapter-actions">
                <button class="ask-about-btn" onclick="askAboutChapter('${subjectKey}', '${chapterNum}', '${escapeAttr(data.chapter_name)}')">
                    Ask a doubt about this chapter
                </button>
                <button class="ncert-solutions-btn" onclick="loadNcertSolutions('${subjectKey}', '${chapterNum}', '${escapeAttr(data.chapter_name)}')">
                    📖 NCERT Solutions
                </button>
            </div>
            <div class="ncert-solutions-section" id="ncert-solutions-section" style="display:none">
                <h3>📖 NCERT Exercise Solutions</h3>
                <div id="ncert-solutions-content" class="ncert-solutions-content readable-content"></div>
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
        }, 120000); // 120s timeout for AI calls (Render cold start + Gemini)

        clearTimeout(statusTimer);
        clearTimeout(wakeTimer);

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Something went wrong');

        const lb = document.getElementById('loading-bubble');
        if (lb) {
            lb.removeAttribute('id');
            lb.innerHTML = `
                <div class="cat-noir-avatar">
                    ${getCatNoirAvatarSVG()}
                    <span class="cat-noir-avatar-label">Study Coach</span>
                </div>
                <div class="answer-text readable-content">${renderMarkdown(data.answer)}</div>
                <button class="read-aloud-btn" onclick="readAloud(this)" style="margin-top:8px">🔊 Read Aloud</button>
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

    body.innerHTML = `<div class="rr-loading"><span class="rr-spinner"></span> Generating reckoner for "${chapterName}"... this takes 30-60 seconds on first load ⏳</div>`;

    try {
        const res = await fetchWithTimeout(`/api/reckoner/${subjectKey}/${chapterNum}`, {}, 120000);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to load reckoner');
        }
        const data = await res.json();
        body.innerHTML = '<div class="readable-content">' + data.html + '</div><button class="read-aloud-btn" onclick="readAloud(this)" style="margin:8px 0">🔊 Read Aloud</button>';
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

    body.innerHTML = `<div class="rr-loading"><span class="rr-spinner"></span> Generating brain teasers for "${chapterName}"... this takes 30-60 seconds on first load ⏳</div>`;

    try {
        const res = await fetchWithTimeout(`/api/brainteaser/${subjectKey}/${chapterNum}`, {}, 120000);
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
            <p class="quiz-loading-sub">Generating... this takes 30-60 seconds on first load ⏳</p>
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
        }, 120000);

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
        hydraMsg.innerHTML = '<span class="hydra-icon">&#128013;</span> \uD83D\uDC0D Hiss! 2 more questions spawned! Show them your claws! \uD83D\uDC3E';
        hydraMsg.classList.add('hydra-animate');

        // Spawn 2 more questions in background
        spawnHydraQuestions(q.concept);
    }

    s.totalAnswered++;

    // Show explanation with cat-themed messages
    const correctMessages = ["Purrfect! \uD83D\uDC3E", "Meow-nificent! \uD83D\uDE3A", "Cat-astrophically good! \uD83D\uDC31", "Clawsome answer! \uD83D\uDC3E"];
    const wrongMessages = ["Not quite, kitten! \uD83D\uDE40", "Cat got your tongue? \uD83D\uDE3F", "Try again, little cat! \uD83D\uDC31"];
    const catMsg = isCorrect
        ? correctMessages[Math.floor(Math.random() * correctMessages.length)]
        : wrongMessages[Math.floor(Math.random() * wrongMessages.length)];
    const explEl = document.getElementById('quiz-explanation');
    explEl.style.display = 'block';
    explEl.innerHTML = `<strong>${catMsg}</strong> ${escapeHtml(q.explanation || '')}`;
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
        }, 120000);

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
    if (pct >= 90) { emoji = '\uD83D\uDC31'; message = 'Cat Noir would be proud! Miraculous score!'; }
    else if (pct >= 70) { emoji = '\uD83D\uDC3E'; message = 'Great job, kitten! Almost purrfect!'; }
    else if (pct >= 50) { emoji = '\uD83D\uDE3A'; message = 'Not bad! Keep practicing, little cat!'; }
    else { emoji = '\uD83D\uDE40'; message = 'Time for more training, kitten! Cat Noir never gives up!'; }

    const weakTopicsHtml = s.wrongConcepts.length > 0
        ? `<div class="results-weak">
               <h4>Topics to review:</h4>
               <ul>${s.wrongConcepts.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
           </div>`
        : '<div class="results-weak"><p>No weak topics — perfect score!</p></div>';

    content.innerHTML = `
        <div class="quiz-results">
            ${getCatNoirCelebrationSVG()}
            <h3>Practice Complete!</h3>
            <p class="results-chapter">${subjectName} - Ch ${parseInt(s.chapter)}: ${s.chapterName}</p>
            <p class="results-message">${message}</p>
            <div id="xp-result-msg" class="xp-result-msg"></div>
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

    // Record progress
    recordPracticeProgress(s);
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

// === Cat Noir SVG Helpers ===

function getCatNoirAvatarSVG() {
    return `<img src="/static/catnoir.png" alt="Cat Noir" class="cat-noir-avatar-img">`;
}

function getCatNoirCelebrationSVG() {
    return `<div class="cat-noir-celebration">
        <img src="/static/catnoir.png" alt="Cat Noir" class="cat-noir-celebration-img">
    </div>`;
}

function getCatalysmRingSVG() {
    return `<svg width="20" height="20" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="14" fill="none" stroke="#00ff41" stroke-width="3" opacity="0.8"/>
        <circle cx="20" cy="20" r="7" fill="#00ff41" opacity="0.4"/>
        <circle cx="20" cy="20" r="3" fill="#00ff41" opacity="0.8"/>
    </svg>`;
}


// === Progress Recording & Gamification ===

async function recordPracticeProgress(s) {
    try {
        const res = await fetchWithTimeout('/api/progress/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subject: s.subject,
                chapter_num: s.chapter,
                score: s.score,
                total: s.totalAnswered,
                wrong_concepts: s.wrongConcepts,
                best_streak: s.bestStreak,
                hydra_spawned: s.hydraSpawned,
                hydra_defeated: s.hydraSpawned > 0 && s.wrongCount === 0,
                is_mock: false,
            })
        }, 15000);
        const data = await res.json();
        // Show XP gained
        const xpEl = document.getElementById('xp-result-msg');
        if (xpEl && data.xp_gained) {
            xpEl.innerHTML = `<span class="xp-gained-badge">+${data.xp_gained} XP</span> Level ${data.level}: ${data.level_name}`;
            xpEl.style.display = 'block';
        }
        updateXpHeader(data.total_xp, data.level, data.level_name);
        // Show badge toasts
        if (data.new_badges && data.new_badges.length > 0) {
            showBadgeToasts(data.new_badges);
        }
    } catch (e) {
        // Non-critical, fail silently
    }
}

function updateXpHeader(xp, level, levelName) {
    const bar = document.getElementById('xp-bar-header');
    if (!bar) return;
    bar.style.display = 'flex';
    document.getElementById('xp-level-label').textContent = `L${level} ${levelName}`;
    document.getElementById('xp-value-label').textContent = `${xp} XP`;
    const progressInLevel = xp % 200;
    const pct = Math.min(100, Math.round((progressInLevel / 200) * 100));
    document.getElementById('xp-bar-fill').style.width = pct + '%';
}

async function loadXpHeader() {
    try {
        const res = await fetchWithTimeout('/api/progress/summary', {}, 10000);
        const data = await res.json();
        if (data.xp !== undefined) {
            updateXpHeader(data.xp, data.level, data.level_name);
        }
    } catch (e) { /* non-critical */ }
}

const BADGE_DEFS = {
    first_steps: { name: "First Steps", icon: "🎯" },
    hat_trick: { name: "Hat Trick", icon: "🎩" },
    on_fire: { name: "On Fire", icon: "🔥" },
    subject_star: { name: "Subject Star", icon: "⭐" },
    brain_bender: { name: "Brain Bender", icon: "🧠" },
    mock_master: { name: "Mock Master", icon: "🏅" },
    daily_grind: { name: "Daily Grind", icon: "📆" },
    centurion: { name: "Centurion", icon: "💯" },
    perfectionist: { name: "Perfectionist", icon: "✨" },
    hydra_slayer: { name: "Hydra Slayer", icon: "🐍" },
};

function showBadgeToasts(badgeIds) {
    const container = document.getElementById('badge-toast-container');
    if (!container) return;
    badgeIds.forEach((id, idx) => {
        const def = BADGE_DEFS[id] || { name: id, icon: "🏆" };
        const toast = document.createElement('div');
        toast.className = 'badge-toast';
        toast.innerHTML = `<span class="cat-noir-ring-badge">${getCatalysmRingSVG()}</span> <span class="badge-toast-icon">${def.icon}</span> Badge Earned: <strong>${def.name}</strong>!`;
        container.appendChild(toast);
        setTimeout(() => { toast.classList.add('show'); }, idx * 600);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4000 + idx * 600);
    });
}


// === Progress Dashboard ===

async function loadProgressDashboard() {
    const content = document.getElementById('progress-content');
    content.innerHTML = '<div class="loading">Loading progress...</div>';
    try {
        const res = await fetchWithTimeout('/api/progress/summary', {}, 15000);
        const data = await res.json();
        renderProgressDashboard(data);
    } catch (err) {
        content.innerHTML = '<div class="error-msg">Could not load progress. <button class="retry-btn" onclick="loadProgressDashboard()">Retry</button></div>';
    }
}

function renderProgressDashboard(data) {
    const content = document.getElementById('progress-content');
    const earned = new Set(data.badges || []);
    const badgeDefs = data.badge_definitions || [];

    // Stat cards
    const statsHtml = `
        <div class="progress-stats-grid">
            <div class="progress-stat-card">
                <div class="psc-num">${data.total_questions_answered}</div>
                <div class="psc-label">Questions Answered</div>
            </div>
            <div class="progress-stat-card">
                <div class="psc-num">${data.accuracy_percent}%</div>
                <div class="psc-label">Accuracy</div>
            </div>
            <div class="progress-stat-card">
                <div class="psc-num">🔥 ${data.streaks.current}</div>
                <div class="psc-label">Current Streak</div>
            </div>
            <div class="progress-stat-card">
                <div class="psc-num">L${data.level}</div>
                <div class="psc-label">${data.level_name} (${data.xp} XP)</div>
            </div>
        </div>
    `;

    // Subject progress bars
    let subjectBarsHtml = '';
    const allSubjects = data.all_subjects || {};
    for (const [key, info] of Object.entries(allSubjects)) {
        const subj = data.subjects[key];
        const accuracy = subj ? subj.accuracy : 0;
        const answered = subj ? subj.answered : 0;
        const practicedChapters = subj ? subj.chapters_practiced.length : 0;
        const totalChapters = info.chapters ? info.chapters.length : 0;
        const colorClass = accuracy >= 80 ? 'pg-green' : accuracy >= 60 ? 'pg-amber' : 'pg-red';
        const barWidth = answered > 0 ? accuracy : 0;
        subjectBarsHtml += `
            <div class="subject-progress-row">
                <div class="spr-label">${info.emoji} ${info.name}</div>
                <div class="spr-bar-wrap">
                    <div class="spr-bar ${colorClass}" style="width:${barWidth}%"></div>
                </div>
                <div class="spr-stats">${accuracy}% (${answered}q, ${practicedChapters}/${totalChapters} ch)</div>
            </div>
        `;
    }

    // Unpracticed chapters
    let unpracticedHtml = '';
    for (const [key, info] of Object.entries(allSubjects)) {
        const practiced = data.subjects[key]?.chapters_practiced || [];
        const unpracticed = (info.chapters || []).filter(ch => !practiced.includes(ch));
        if (unpracticed.length > 0 && unpracticed.length < (info.chapters || []).length) {
            const subjInfo = subjectsData[key] || {};
            unpracticedHtml += `<span class="unpracticed-tag">${info.emoji} ${info.name}: Ch ${unpracticed.map(c => parseInt(c)).join(', ')}</span> `;
        }
    }

    // Weak concepts
    const weakHtml = data.weak_concepts.length > 0
        ? data.weak_concepts.map(c => `<span class="weak-concept-tag">${escapeHtml(c)}</span>`).join(' ')
        : '<span class="text-light">No weak areas yet!</span>';

    // Daily activity log
    let dailyHtml = '';
    if (data.daily_log.length > 0) {
        dailyHtml = data.daily_log.map(d => `
            <div class="daily-log-row">
                <span class="dl-date">${d.date}</span>
                <span class="dl-questions">${d.questions} questions</span>
                <span class="dl-correct">${d.correct} correct</span>
            </div>
        `).join('');
    } else {
        dailyHtml = '<div class="text-light" style="padding:12px">No activity yet. Start practicing!</div>';
    }

    // Badge gallery
    const badgesHtml = badgeDefs.map(b => {
        const isEarned = earned.has(b.id);
        return `<div class="badge-card ${isEarned ? 'earned' : 'locked'}">
            <div class="badge-icon">${isEarned ? b.icon : '?'}</div>
            <div class="badge-name">${b.name}</div>
            <div class="badge-desc">${b.desc}</div>
        </div>`;
    }).join('');

    content.innerHTML = `
        ${statsHtml}
        <div class="progress-section">
            <h3>Subject Progress</h3>
            ${subjectBarsHtml}
        </div>
        ${unpracticedHtml ? `<div class="progress-section"><h3>Chapters Not Yet Practiced</h3><div class="unpracticed-list">${unpracticedHtml}</div></div>` : ''}
        <div class="progress-section">
            <h3>Weak Concepts</h3>
            <div class="weak-concepts-list">${weakHtml}</div>
        </div>
        <div class="progress-section">
            <h3>Recent Activity (Last 7 Days)</h3>
            <div class="daily-log">${dailyHtml}</div>
        </div>
        <div class="progress-section">
            <h3>🏆 Badge Gallery</h3>
            <div class="badge-gallery">${badgesHtml}</div>
        </div>
        <div class="progress-section" style="text-align:center">
            <button class="retry-btn" style="background:#e74c3c" onclick="if(confirm('Reset all progress? This cannot be undone.')){resetProgress()}">Reset All Progress</button>
        </div>
    `;
}

async function resetProgress() {
    try {
        await fetchWithTimeout('/api/progress/reset', {}, 10000);
        loadProgressDashboard();
        loadXpHeader();
    } catch (e) { alert('Failed to reset.'); }
}


// === Mock Test ===

let mockTestState = {
    questions: [],
    answers: {},
    flagged: new Set(),
    currentIndex: 0,
    timeRemaining: 0,
    timerInterval: null,
    timeMinutes: 30,
    started: false,
};

function initMockTestSetup() {
    const checksEl = document.getElementById('mt-subject-checkboxes');
    if (!checksEl || checksEl.children.length > 0) return;
    const subjects = Object.entries(subjectsData);
    checksEl.innerHTML = subjects
        .filter(([, s]) => s.total_chapters > 0)
        .map(([key, s]) => `
            <label class="mt-subject-check">
                <input type="checkbox" value="${key}" checked> ${s.emoji} ${s.name}
            </label>
        `).join('');
}

async function startMockTest() {
    const checks = document.querySelectorAll('#mt-subject-checkboxes input:checked');
    const subjects = Array.from(checks).map(c => c.value);
    if (subjects.length === 0) { alert('Select at least one subject!'); return; }

    const questionCount = parseInt(document.getElementById('mt-question-count').value);
    const timeMinutes = parseInt(document.getElementById('mt-time').value);

    const content = document.getElementById('mocktest-content');
    content.innerHTML = `
        <div class="quiz-loading-screen">
            <div class="quiz-loading-icon"><span class="rr-spinner quiz-spinner"></span></div>
            <h3>Generating mock test...</h3>
            <p>${subjects.length} subject(s), ${questionCount} questions, ${timeMinutes} minutes</p>
            <p class="quiz-loading-sub">Generating... this takes 30-60 seconds on first load ⏳</p>
        </div>
    `;

    try {
        const res = await fetchWithTimeout('/api/mocktest/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjects, question_count: questionCount, time_minutes: timeMinutes })
        }, 120000);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to generate mock test');
        }
        const data = await res.json();
        mockTestState = {
            questions: data.questions,
            answers: {},
            flagged: new Set(),
            currentIndex: 0,
            timeRemaining: timeMinutes * 60,
            timerInterval: null,
            timeMinutes: timeMinutes,
            started: true,
        };
        startMockTimer();
        renderMockQuestion();
    } catch (err) {
        content.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}<br><button class="retry-btn" onclick="showView('mocktest')">Try Again</button></div>`;
    }
}

function startMockTimer() {
    if (mockTestState.timerInterval) clearInterval(mockTestState.timerInterval);
    mockTestState.timerInterval = setInterval(() => {
        mockTestState.timeRemaining--;
        updateMockTimer();
        if (mockTestState.timeRemaining <= 0) {
            clearInterval(mockTestState.timerInterval);
            submitMockTest(true);
        }
    }, 1000);
}

function updateMockTimer() {
    const el = document.getElementById('mt-timer');
    if (!el) return;
    const mins = Math.floor(mockTestState.timeRemaining / 60);
    const secs = mockTestState.timeRemaining % 60;
    el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    if (mockTestState.timeRemaining <= 300) {
        el.classList.add('timer-danger');
    }
}

function renderMockQuestion() {
    const s = mockTestState;
    const q = s.questions[s.currentIndex];
    const content = document.getElementById('mocktest-content');
    const total = s.questions.length;
    const answered = Object.keys(s.answers).length;

    // Navigation sidebar circles
    const navCircles = s.questions.map((_, i) => {
        let cls = 'mt-nav-circle';
        if (s.answers[String(i)] !== undefined) cls += ' answered';
        if (s.flagged.has(i)) cls += ' flagged';
        if (i === s.currentIndex) cls += ' current';
        return `<div class="${cls}" onclick="goToMockQuestion(${i})">${i + 1}</div>`;
    }).join('');

    const isFlagged = s.flagged.has(s.currentIndex);
    const subjectName = subjectsData[q.subject]?.name || q.subject;

    content.innerHTML = `
        <div class="mt-test-layout">
            <div class="mt-sidebar">
                <div class="mt-timer-box">
                    <div class="mt-timer-label">Time Left</div>
                    <div class="mt-timer" id="mt-timer">--:--</div>
                </div>
                <div class="mt-nav-grid">${navCircles}</div>
                <div class="mt-sidebar-stats">${answered}/${total} answered</div>
                <button class="quiz-action-btn primary mt-submit-btn" onclick="confirmSubmitMock()">Submit Test</button>
            </div>
            <div class="mt-question-area">
                <div class="mt-q-header">
                    <span class="mt-q-num">Question ${s.currentIndex + 1} of ${total}</span>
                    <span class="concept-tag">${escapeHtml(subjectName)}</span>
                    <button class="mt-flag-btn ${isFlagged ? 'flagged' : ''}" onclick="toggleMockFlag(${s.currentIndex})">
                        ${isFlagged ? '🚩 Flagged' : '🏳️ Flag'}
                    </button>
                </div>
                <div class="quiz-question">${escapeHtml(q.question)}</div>
                <div class="quiz-options">
                    ${['A', 'B', 'C', 'D'].map(letter => {
                        const selected = s.answers[String(s.currentIndex)] === letter;
                        return `<button class="option-btn ${selected ? 'mt-selected' : ''}" onclick="selectMockAnswer('${letter}')">
                            <span class="option-letter">${letter}</span>
                            <span class="option-text">${escapeHtml(q.options[letter] || '')}</span>
                        </button>`;
                    }).join('')}
                </div>
                <div class="mt-nav-btns">
                    <button class="quiz-action-btn secondary" onclick="goToMockQuestion(${s.currentIndex - 1})" ${s.currentIndex === 0 ? 'disabled' : ''}>Previous</button>
                    <button class="quiz-action-btn primary" onclick="goToMockQuestion(${s.currentIndex + 1})" ${s.currentIndex === total - 1 ? 'disabled' : ''}>Next</button>
                </div>
            </div>
        </div>
    `;
    updateMockTimer();
}

function selectMockAnswer(letter) {
    mockTestState.answers[String(mockTestState.currentIndex)] = letter;
    renderMockQuestion();
}

function goToMockQuestion(idx) {
    if (idx < 0 || idx >= mockTestState.questions.length) return;
    mockTestState.currentIndex = idx;
    renderMockQuestion();
}

function toggleMockFlag(idx) {
    if (mockTestState.flagged.has(idx)) {
        mockTestState.flagged.delete(idx);
    } else {
        mockTestState.flagged.add(idx);
    }
    renderMockQuestion();
}

function confirmSubmitMock() {
    const unanswered = mockTestState.questions.length - Object.keys(mockTestState.answers).length;
    const msg = unanswered > 0
        ? `You have ${unanswered} unanswered question(s). Are you sure you want to submit?`
        : 'Are you sure you want to submit the test?';
    if (confirm(msg)) submitMockTest(false);
}

async function submitMockTest(autoSubmit) {
    if (mockTestState.timerInterval) clearInterval(mockTestState.timerInterval);
    const content = document.getElementById('mocktest-content');
    content.innerHTML = '<div class="loading">Grading your test...</div>';

    try {
        const timeTaken = (mockTestState.timeMinutes * 60) - mockTestState.timeRemaining;
        const res = await fetchWithTimeout('/api/mocktest/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                questions: mockTestState.questions,
                answers: mockTestState.answers,
                time_taken_seconds: timeTaken,
            })
        }, 15000);
        const data = await res.json();
        renderMockResults(data, autoSubmit);
        // Record progress for mock test
        recordMockProgress(data);
    } catch (err) {
        content.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    }
}

async function recordMockProgress(data) {
    // Record overall mock test to progress
    try {
        const res = await fetchWithTimeout('/api/progress/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subject: 'mock_test',
                chapter_num: '',
                score: data.correct,
                total: data.total,
                wrong_concepts: data.results.filter(r => !r.is_correct).map(r => r.concept),
                best_streak: 0,
                hydra_spawned: 0,
                hydra_defeated: false,
                is_mock: true,
            })
        }, 15000);
        const progData = await res.json();
        updateXpHeader(progData.total_xp, progData.level, progData.level_name);
        if (progData.new_badges && progData.new_badges.length > 0) {
            showBadgeToasts(progData.new_badges);
        }
    } catch (e) { /* non-critical */ }
}

function renderMockResults(data, autoSubmit) {
    const content = document.getElementById('mocktest-content');

    // Subject breakdown bars
    let breakdownHtml = '';
    for (const [subj, stats] of Object.entries(data.subject_breakdown)) {
        const name = subjectsData[subj]?.name || subj;
        const emoji = subjectsData[subj]?.emoji || '';
        const colorClass = stats.accuracy >= 80 ? 'pg-green' : stats.accuracy >= 60 ? 'pg-amber' : 'pg-red';
        breakdownHtml += `
            <div class="subject-progress-row">
                <div class="spr-label">${emoji} ${name}</div>
                <div class="spr-bar-wrap"><div class="spr-bar ${colorClass}" style="width:${stats.accuracy}%"></div></div>
                <div class="spr-stats">${stats.correct}/${stats.total} (${stats.accuracy}%)</div>
            </div>
        `;
    }

    // Question-by-question review
    let reviewHtml = data.results.map((r, i) => {
        const icon = r.is_correct ? '✅' : '❌';
        return `
            <div class="mt-review-q ${r.is_correct ? '' : 'wrong'}">
                <div class="mt-rq-header">${icon} Q${i + 1}. ${escapeHtml(r.question)}</div>
                <div class="mt-rq-body">
                    ${!r.is_correct ? `<div class="mt-rq-yours">Your answer: <strong>${r.user_answer || 'Not answered'}</strong> — ${escapeHtml(r.options[r.user_answer] || '')}</div>` : ''}
                    <div class="mt-rq-correct">Correct: <strong>${r.correct_answer}</strong> — ${escapeHtml(r.options[r.correct_answer] || '')}</div>
                    ${r.explanation ? `<div class="mt-rq-expl">${escapeHtml(r.explanation)}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    let emoji, message;
    if (data.percentage >= 90) { emoji = '\uD83D\uDC31'; message = 'Cat Noir would be proud! Miraculous score!'; }
    else if (data.percentage >= 70) { emoji = '\uD83D\uDC3E'; message = 'Great job, kitten! Almost purrfect!'; }
    else if (data.percentage >= 50) { emoji = '\uD83D\uDE3A'; message = 'Not bad! Keep practicing, little cat!'; }
    else { emoji = '\uD83D\uDE40'; message = 'Time for more training, kitten! Cat Noir never gives up!'; }

    content.innerHTML = `
        <div class="quiz-results" style="max-width:800px">
            ${autoSubmit ? '<div class="mt-auto-submit-msg">Time is up! Test auto-submitted.</div>' : ''}
            ${getCatNoirCelebrationSVG()}
            <h3>Mock Test Results</h3>
            <p class="results-message">${message}</p>
            <div class="results-stats">
                <div class="result-stat">
                    <span class="result-stat-num">${data.correct}/${data.total}</span>
                    <span class="result-stat-label">Score</span>
                </div>
                <div class="result-stat">
                    <span class="result-stat-num">${data.percentage}%</span>
                    <span class="result-stat-label">Percentage</span>
                </div>
            </div>
            <div class="progress-section"><h3>Subject Breakdown</h3>${breakdownHtml}</div>
            <div class="progress-section"><h3>Question Review</h3><div class="mt-review-list">${reviewHtml}</div></div>
            <div class="results-actions">
                <button class="quiz-action-btn primary" onclick="showView('mocktest')">Retake</button>
                <button class="quiz-action-btn secondary" onclick="showView('progress')">View Progress</button>
            </div>
        </div>
    `;
}


// === Study Planner ===

async function initPlanner() {
    const body = document.getElementById('planner-body');
    body.innerHTML = '<div class="loading">Loading planner...</div>';
    try {
        const res = await fetchWithTimeout('/api/planner/current', {}, 10000);
        const data = await res.json();
        if (data.has_plan) {
            renderPlannerView(data);
        } else {
            renderPlannerSetup();
        }
    } catch (err) {
        renderPlannerSetup();
    }
}

function renderPlannerSetup() {
    const body = document.getElementById('planner-body');
    const subjects = Object.entries(subjectsData).filter(([, s]) => s.total_chapters > 0);
    const checksHtml = subjects.map(([key, s]) => `
        <label class="mt-subject-check">
            <input type="checkbox" class="planner-subj-check" value="${key}" checked> ${s.emoji} ${s.name}
        </label>
    `).join('');

    body.innerHTML = `
        <div class="mt-setup-card">
            <h3>Create Your Study Plan</h3>
            <div class="form-row">
                <label for="planner-exam-date">Exam Date</label>
                <input type="date" id="planner-exam-date" class="planner-date-input" value="">
            </div>
            <div class="form-row">
                <label>Subjects</label>
                <div class="mt-subject-checks">${checksHtml}</div>
            </div>
            <div class="form-row">
                <label>Study Hours Per Day</label>
                <div class="mt-slider-row">
                    <input type="range" id="planner-hours" min="1" max="5" value="2">
                    <span id="planner-hours-label" class="mt-slider-label">2 hrs</span>
                </div>
            </div>
            <button class="ask-btn" onclick="generatePlan()">Generate My Plan</button>
        </div>
    `;
    const hSlider = document.getElementById('planner-hours');
    hSlider.addEventListener('input', () => {
        document.getElementById('planner-hours-label').textContent = hSlider.value + ' hrs';
    });
    // Set default exam date to 3 weeks from now
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 21);
    document.getElementById('planner-exam-date').value = defaultDate.toISOString().split('T')[0];
}

async function generatePlan() {
    const examDate = document.getElementById('planner-exam-date').value;
    if (!examDate) { alert('Please select an exam date!'); return; }
    const subjects = Array.from(document.querySelectorAll('.planner-subj-check:checked')).map(c => c.value);
    if (subjects.length === 0) { alert('Select at least one subject!'); return; }
    const dailyHours = parseInt(document.getElementById('planner-hours').value);

    const body = document.getElementById('planner-body');
    body.innerHTML = `
        <div class="quiz-loading-screen">
            <div class="quiz-loading-icon"><span class="rr-spinner quiz-spinner"></span></div>
            <h3>Generating your study plan...</h3>
            <p>AI is creating a personalized plan based on your progress</p>
            <p class="quiz-loading-sub">Generating... this takes 30-60 seconds on first load ⏳</p>
        </div>
    `;

    try {
        const res = await fetchWithTimeout('/api/planner/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exam_date: examDate, subjects, daily_hours: dailyHours })
        }, 120000);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to generate plan');
        }
        const data = await res.json();
        data.has_plan = true;
        renderPlannerView(data);
    } catch (err) {
        body.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}<br><button class="retry-btn" onclick="renderPlannerSetup()">Try Again</button></div>`;
    }
}

function renderPlannerView(plan) {
    const body = document.getElementById('planner-body');
    const tasks = plan.tasks || [];
    const completed = new Set(plan.completed_tasks || []);
    const today = new Date().toISOString().split('T')[0];

    let totalTasks = 0;
    let doneTasks = 0;
    tasks.forEach(day => {
        (day.tasks || []).forEach((_, ti) => {
            totalTasks++;
            if (completed.has(`${day.date}_${ti}`)) doneTasks++;
        });
    });

    // Find current day number
    let currentDayNum = 0;
    tasks.forEach((day, i) => {
        if (day.date <= today) currentDayNum = day.day_number || (i + 1);
    });

    const totalDays = plan.total_days || tasks.length;
    const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    let daysHtml = tasks.map(day => {
        const isToday = day.date === today;
        const isPast = day.date < today;
        const dayTasks = (day.tasks || []).map((task, ti) => {
            const taskKey = `${day.date}_${ti}`;
            const isDone = completed.has(taskKey);
            const priorityCls = task.priority === 'high' ? 'priority-high' : task.priority === 'low' ? 'priority-low' : 'priority-med';
            const subjName = subjectsData[task.subject]?.emoji || '';
            return `
                <div class="planner-task ${isDone ? 'done' : ''}" onclick="togglePlannerTask('${day.date}', ${ti})">
                    <span class="planner-check">${isDone ? '✅' : '⬜'}</span>
                    <span class="planner-task-text">${subjName} ${escapeHtml(task.chapter_name || task.activity)}</span>
                    <span class="planner-task-meta">${task.duration_minutes || 30} min</span>
                    <span class="planner-priority ${priorityCls}">${task.priority || 'medium'}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="planner-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}">
                <div class="planner-day-header">
                    <span class="planner-day-label">${isToday ? '📍 TODAY — ' : ''}Day ${day.day_number || ''}</span>
                    <span class="planner-day-date">${day.date}</span>
                </div>
                <div class="planner-day-tasks">${dayTasks}</div>
            </div>
        `;
    }).join('');

    body.innerHTML = `
        <div class="planner-overview">
            <div class="planner-overview-bar">
                <span>Day ${currentDayNum} of ${totalDays}</span>
                <span>${doneTasks}/${totalTasks} tasks done (${progressPct}%)</span>
            </div>
            <div class="quiz-progress-bar-wrap"><div class="quiz-progress-bar" style="width:${progressPct}%"></div></div>
        </div>
        <div class="planner-calendar">${daysHtml}</div>
        <div style="text-align:center;margin-top:20px">
            <button class="quiz-action-btn secondary" onclick="renderPlannerSetup()">Create New Plan</button>
        </div>
    `;
}

async function togglePlannerTask(date, taskIndex) {
    try {
        const res = await fetchWithTimeout('/api/planner/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, task_index: taskIndex })
        }, 10000);
        // Reload planner
        initPlanner();
    } catch (e) { /* non-critical */ }
}


// === NCERT Solutions ===

async function loadNcertSolutions(subjectKey, chapterNum, chapterName) {
    const section = document.getElementById('ncert-solutions-section');
    const contentEl = document.getElementById('ncert-solutions-content');

    if (section.style.display !== 'none' && contentEl.dataset.loaded === 'true') {
        // Toggle collapse
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (contentEl.dataset.loaded === 'true') return;

    contentEl.innerHTML = '<div class="rr-loading"><span class="rr-spinner"></span> Generating NCERT solutions for "' + escapeHtml(chapterName) + '"... this takes 30-60 seconds on first load ⏳</div>';

    try {
        const res = await fetchWithTimeout(`/api/ncert-solutions/${subjectKey}/${chapterNum}`, {}, 120000);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to load NCERT solutions');
        }
        const data = await res.json();
        contentEl.innerHTML = data.html;
        contentEl.dataset.loaded = 'true';
    } catch (err) {
        contentEl.innerHTML = `
            <div class="error-msg">
                ${escapeHtml(err.message)}
                <br><button class="retry-btn" onclick="document.getElementById('ncert-solutions-content').dataset.loaded=''; loadNcertSolutions('${subjectKey}', '${chapterNum}', '${escapeAttr(chapterName)}')">Retry</button>
            </div>`;
    }
}


// === Snap & Solve ===

let _snapSolveFile = null;

function initSnapSolve() {
    const fileInput = document.getElementById('snap-file-input');
    if (!fileInput) return;
    fileInput.addEventListener('change', onSnapFileSelected);
}

function onSnapFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    _snapSolveFile = file;

    const previewEl = document.getElementById('snap-preview');
    const solveBtn = document.getElementById('snap-solve-btn');
    const reader = new FileReader();
    reader.onload = function(ev) {
        previewEl.src = ev.target.result;
        previewEl.style.display = 'block';
        solveBtn.style.display = 'inline-block';
    };
    reader.readAsDataURL(file);
}

function triggerSnapUpload() {
    document.getElementById('snap-file-input').click();
}

async function submitSnapSolve() {
    if (!_snapSolveFile) { alert('Please select an image first!'); return; }

    const btn = document.getElementById('snap-solve-btn');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    const subjectKey = document.getElementById('subject-select').value || '';
    const formData = new FormData();
    formData.append('image', _snapSolveFile);
    if (subjectKey) formData.append('subject', subjectKey);

    const history = document.getElementById('chat-history');
    // Add a question bubble with image preview
    const imgUrl = URL.createObjectURL(_snapSolveFile);
    history.innerHTML = `
        <div class="chat-bubble chat-question">
            <div class="q-label">📸 Snap & Solve${subjectKey ? ' • ' + (subjectsData[subjectKey]?.name || subjectKey) : ''}</div>
            <img src="${imgUrl}" class="snap-preview" alt="Uploaded question">
        </div>
        <div class="chat-bubble chat-answer" id="snap-loading-bubble">
            <div class="loading-dots"><span></span><span></span><span></span></div>
            <div class="loading-status">Analyzing your image... this may take 10-20 seconds.</div>
        </div>
    ` + history.innerHTML;

    try {
        const res = await fetchWithTimeout('/api/snap-solve', {
            method: 'POST',
            body: formData,
        }, 120000);

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Something went wrong');

        const lb = document.getElementById('snap-loading-bubble');
        if (lb) {
            lb.removeAttribute('id');
            lb.innerHTML = `
                <div class="cat-noir-avatar">
                    ${getCatNoirAvatarSVG()}
                    <span class="cat-noir-avatar-label">Study Coach (Snap & Solve)</span>
                </div>
                <div class="answer-text readable-content">${renderMarkdown(data.answer)}</div>
                <button class="read-aloud-btn" onclick="readAloud(this)" style="margin-top:8px">🔊 Read Aloud</button>
            `;
        }
        if (data.usage_today !== undefined) {
            updateUsageDisplay(data.usage_today, data.usage_limit, data.usage_remaining);
        }
    } catch (err) {
        const lb = document.getElementById('snap-loading-bubble');
        if (lb) {
            lb.removeAttribute('id');
            lb.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
        }
    }

    btn.disabled = false;
    btn.textContent = 'Solve This!';
    _snapSolveFile = null;
    document.getElementById('snap-file-input').value = '';
    document.getElementById('snap-preview').style.display = 'none';
    btn.style.display = 'none';
}


// === Read Aloud (Web Speech API) ===

// Preload voices
if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => { speechSynthesis.getVoices(); };
}

function readAloud(btn) {
    const container = btn.closest('.readable-content') || btn.parentElement.querySelector('.readable-content') || btn.parentElement;
    const text = container.innerText;

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        btn.textContent = '🔊 Read Aloud';
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    // Try to find an Indian English voice
    const voices = speechSynthesis.getVoices();
    const indianVoice = voices.find(v => v.lang === 'en-IN') || voices.find(v => v.lang.startsWith('en'));
    if (indianVoice) utterance.voice = indianVoice;
    utterance.onend = () => { btn.textContent = '🔊 Read Aloud'; };
    btn.textContent = '🔇 Stop';
    speechSynthesis.speak(utterance);
}

// Umayal's Study Coach — Frontend JS

let subjectsData = {};

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
});

// === View Navigation ===
function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${view}-view`).classList.add('active');
    const navBtn = document.querySelector(`[data-view="${view}"]`);
    if (navBtn) navBtn.classList.add('active');
}

// === Usage Tracking ===
async function loadUsage() {
    try {
        const res = await fetch('/api/usage');
        const data = await res.json();
        updateUsageDisplay(data.today, data.limit, data.remaining);
    } catch (err) {}
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
    try {
        const res = await fetch('/api/subjects');
        const data = await res.json();
        subjectsData = data.subjects;
        renderSubjectsAccordion();
        populateSubjectSelect();
    } catch (err) {
        document.getElementById('subjects-accordion').innerHTML =
            '<div class="error-msg">Could not load subjects. Make sure the server is running.</div>';
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
                    <span class="ch-ask" onclick="event.stopPropagation(); askAboutChapter('${key}', '${ch.number}', '${escapeAttr(ch.name)}')">Ask 🤖</span>
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
                    <span class="toggle-icon" id="toggle-${key}">▼</span>
                </div>
                <div class="chapter-list-expanded" id="chapters-${key}">
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
        const res = await fetch(`/api/chapter/${subjectKey}/${chapterNum}`);
        const data = await res.json();

        content.innerHTML = `
            <h2>Chapter ${parseInt(data.chapter_number)}: ${data.chapter_name}</h2>
            <div class="meta">${data.subject} • ${data.word_count.toLocaleString()} words</div>
            <div class="chapter-text">${escapeHtml(data.summary)}</div>
            <button class="ask-about-btn" onclick="askAboutChapter('${subjectKey}', '${chapterNum}', '${escapeAttr(data.chapter_name)}')">
                🤖 Ask a doubt about this chapter
            </button>
        `;
    } catch (err) {
        content.innerHTML = '<div class="error-msg">Could not load chapter content.</div>';
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
async function askDoubt() {
    const subjectKey = document.getElementById('subject-select').value;
    const question = document.getElementById('question-input').value.trim();
    const chapterNum = document.getElementById('chapter-select')?.value || '';

    if (!subjectKey) { alert('Please select a subject!'); return; }
    if (!question) { alert('Please type your question!'); return; }

    const btn = document.getElementById('ask-btn');
    btn.disabled = true;
    btn.textContent = 'Thinking... 🧠';

    const history = document.getElementById('chat-history');
    const subjectName = subjectsData[subjectKey]?.name || subjectKey;

    history.innerHTML = `
        <div class="chat-bubble chat-question">
            <div class="q-label">${subjectName}${chapterNum ? ' • Ch ' + parseInt(chapterNum) : ''}</div>
            ${escapeHtml(question)}
        </div>
        <div class="chat-bubble chat-answer" id="loading-bubble">
            <div class="loading-dots"><span></span><span></span><span></span></div>
        </div>
    ` + history.innerHTML;

    try {
        const res = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: subjectKey, question, chapter: chapterNum || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Something went wrong');

        const lb = document.getElementById('loading-bubble');
        lb.removeAttribute('id');
        lb.innerHTML = `
            <div class="a-label">🤖 Study Coach</div>
            <div class="answer-text">${renderMarkdown(data.answer)}</div>
        `;
        if (data.usage_today !== undefined) {
            updateUsageDisplay(data.usage_today, data.usage_limit, data.usage_remaining);
        }
    } catch (err) {
        const lb = document.getElementById('loading-bubble');
        if (lb) { lb.removeAttribute('id'); lb.innerHTML = `<div class="error-msg">❌ ${escapeHtml(err.message)}</div>`; }
    }

    btn.disabled = false;
    btn.textContent = 'Ask My Doubt ✨';
    document.getElementById('question-input').value = '';
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

'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────
const CFG = {
    // Change this to your backend URL (e.g., https://your-northflank-service.run)
    // For local development: http://localhost:3000
    DEFAULT_URL: 'http://localhost:3000',
    MAX_FILE:    10 * 1024 * 1024,
    EXTS:        ['.pdf', '.docx', '.txt'],
    MIN_JOB:     50,
    MAX_JOB:     20000,
    TIMEOUT:     60000,
    KEYS: {
        URL:      'backendUrl',
        TOKEN:    'authToken',
        CV:       'cvContent',
        FNAME:    'cvFilename',
        THEME:    'theme',
        HISTORY:  'sessionsHistory'
    }
};

// ─── SAFE DOM HELPERS ─────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function on(id, evt, fn) {
    const node = typeof id === 'string' ? el(id) : id;
    if (node) node.addEventListener(evt, fn);
    else console.warn('Missing element:', id);
}

// ─── STORAGE ──────────────────────────────────────────────────────
const Store = {
    get: k => new Promise((res, rej) => chrome.storage.local.get([k], r => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r[k]))),
    set: (k, v) => new Promise((res, rej) => chrome.storage.local.set({[k]: v}, () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())),
    setMany: obj => new Promise((res, rej) => chrome.storage.local.set(obj, () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())),
    del: k => new Promise((res, rej) => chrome.storage.local.remove([k], () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())),
    async url()     { return (await this.get(CFG.KEYS.URL))     || CFG.DEFAULT_URL; },
    async token()   { return (await this.get(CFG.KEYS.TOKEN))   || ''; },
    async cv()      { return (await this.get(CFG.KEYS.CV))      || ''; },
    async fname()   { return (await this.get(CFG.KEYS.FNAME))   || ''; },
    async theme()   { return (await this.get(CFG.KEYS.THEME))   || 'dark'; },
    async history() { return (await this.get(CFG.KEYS.HISTORY)) || []; },
    async pushSession(s) {
        try {
            const h = await this.history();
            h.unshift({ id: Date.now(), ts: new Date().toISOString(), ...s });
            await this.set(CFG.KEYS.HISTORY, h.slice(0, 20));
        } catch(e) { console.warn('history save failed', e); }
    }
};

// ─── THEME ────────────────────────────────────────────────────────
const Theme = {
    cur: 'dark',
    async init() {
        this.cur = await Store.theme();
        this.apply(this.cur);
    },
    apply(t) {
        document.documentElement.setAttribute('data-theme', t);
        this.cur = t;
        const btn = el('theme-toggle');
        if (btn) btn.textContent = t === 'light' ? '◑' : '◐';
        qsa('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
    },
    async toggle() { const n = this.cur === 'dark' ? 'light' : 'dark'; this.apply(n); await Store.set(CFG.KEYS.THEME, n); },
    async set(t)   { this.apply(t); await Store.set(CFG.KEYS.THEME, t); }
};

// ─── TOAST ────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const c = el('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3000);
}

// ─── COPY ─────────────────────────────────────────────────────────
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied!', 'success'); }
    catch { toast('Copy failed', 'error'); }
}

// ─── FILE PARSER ─────────────────────────────────────────────────
const Parser = {
    async parse(file) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (ext === '.pdf')  return this.pdf(file);
        if (ext === '.docx') return this.docx(file);
        if (ext === '.txt')  return this.txt(file);
        throw new Error('Unsupported file type. Use PDF, DOCX or TXT.');
    },
    pdf(file) {
        return new Promise((res, rej) => {
            if (typeof pdfjsLib === 'undefined') return rej(new Error('PDF parser not loaded'));
            try { pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js'); } catch {}
            const reader = new FileReader();
            reader.onload = async e => {
                try {
                    const doc = await pdfjsLib.getDocument({ data: e.target.result }).promise;
                    let text = '';
                    for (let i = 1; i <= doc.numPages; i++) {
                        const page = await doc.getPage(i);
                        const ct = await page.getTextContent();
                        text += ct.items.map(x => x.str).join(' ') + '\n';
                    }
                    text.trim() ? res(text.trim()) : rej(new Error('No text found in PDF'));
                } catch(e2) { rej(new Error('PDF error: ' + e2.message)); }
            };
            reader.onerror = () => rej(new Error('Could not read file'));
            reader.readAsArrayBuffer(file);
        });
    },
    docx(file) {
        return new Promise((res, rej) => {
            if (typeof mammoth === 'undefined') return rej(new Error('DOCX parser not loaded'));
            const reader = new FileReader();
            reader.onload = async e => {
                try {
                    const r = await mammoth.extractRawText({ arrayBuffer: e.target.result });
                    r.value.trim() ? res(r.value.trim()) : rej(new Error('No text found in DOCX'));
                } catch(e2) { rej(new Error('DOCX error: ' + e2.message)); }
            };
            reader.onerror = () => rej(new Error('Could not read file'));
            reader.readAsArrayBuffer(file);
        });
    },
    txt(file) {
        return new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload  = e => e.target.result.trim() ? res(e.target.result.trim()) : rej(new Error('Empty file'));
            reader.onerror = () => rej(new Error('Could not read file'));
            reader.readAsText(file);
        });
    }
};

// ─── LANGUAGE HELPER ─────────────────────────────────────────────
function langInstruction(mode, jobText) {
    if (mode === 'keep') return 'Respond in the same language as the CV. Do not translate.';
    if (mode === 'job')  return 'Respond in the same language as the job description.';
    // auto: detect job language and suggest switching if different from CV
    const looksArabic  = /[؀-ۿ]/.test(jobText);
    const looksFrench  = /(le|la|les|de|du|des|est|avec|pour|dans|vous|nous)/i.test(jobText);
    const looksSpanish = /(el|la|los|las|de|del|con|para|en|por|que)/i.test(jobText);
    if (looksArabic)  return 'The job description is in Arabic. Tailor and write the CV in Arabic unless the CV was originally in another language, in which case keep it bilingual or ask.';
    if (looksFrench)  return 'The job description appears to be in French. Match the language of the job description.';
    if (looksSpanish) return 'The job description appears to be in Spanish. Match the language of the job description.';
    return 'Match the output language to the job description language.';
}

// ─── API ──────────────────────────────────────────────────────────
async function tailorAPI(url, token, cv, job) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), CFG.TIMEOUT);
    try {
        const resp = await fetch(url.replace(/\/$/, '') + '/tailor-cv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ cv, job, language: langInstruction(S.lang, job) }),
            signal: ctrl.signal
        });
        clearTimeout(tid);
        if (resp.status === 401) throw new Error('Auth failed — check your token in Settings');
        if (resp.status === 429) throw new Error('Rate limited — please wait and try again');
        if (!resp.ok) {
            let msg = 'Backend error ' + resp.status;
            try { const d = await resp.json(); msg = d.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await resp.json();
        if (!data.tailoredCv) throw new Error('Invalid response — no CV returned');
        return data;
    } catch(e) {
        if (e.name === 'AbortError') throw new Error('Request timed out — try again');
        throw e;
    } finally { clearTimeout(tid); }
}

// ─── STATE ────────────────────────────────────────────────────────
const S = { cvContent: null, cvFilename: null, results: null, origCv: null, pendingFile: null, lang: 'auto' };

// ─── BOOT ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Theme.init();
        S.cvContent  = await Store.cv();
        S.cvFilename = await Store.fname();
        updateDash();
        await renderHistory();
        wire();
    } catch(e) {
        console.error('Boot error:', e);
        const ec = el('error-container'), et = el('error-text');
        if (ec) ec.classList.remove('hidden');
        if (et) et.textContent = 'Error: ' + (e.message || 'Failed to initialize');
    }
});

// ─── WIRE ALL EVENTS ──────────────────────────────────────────────
function wire() {
    // Sidebar nav
    qsa('.nav-btn').forEach(btn => on(btn, 'click', e => {
        const tab = e.currentTarget.dataset.tab;
        switchTab(tab);
        if (tab === 'history') renderHistory();
    }));

    // Header icons
    on('theme-toggle',   'click', () => Theme.toggle());
    on('settings-btn',   'click', openSettings);

    // Dashboard
    on('quick-upload-btn',   'click', () => switchTab('upload'));
    on('quick-settings-btn', 'click', openSettings);

    // Upload
    wireUpload();

    // Tailor
    on('tailor-btn',     'click', doTailor);
    on('new-tailor-btn', 'click', resetResults);

    // Results tabs
    qsa('.rtab').forEach(btn => on(btn, 'click', e => switchResultsTab(e.currentTarget.dataset.resultTab)));

    // Copy / export
    on('copy-cv-btn',     'click', () => S.results ? copyText(S.results.tailoredCv) : toast('No CV to copy', 'error'));
    on('export-dropdown', 'click', e => { e.stopPropagation(); qs('.export-menu')?.classList.toggle('hidden'); });
    on('export-txt',      'click', doExportTxt);
    on('export-pdf',      'click', doExportPdf);

    // History
    on('clear-history-btn', 'click', doClearHistory);

    // Settings
    on('settings-close',    'click', closeSettings);
    on('save-settings-btn', 'click', doSaveSettings);
    on('settings-overlay',  'click', e => { if (e.target === el('settings-overlay')) closeSettings(); });
    qsa('.theme-opt').forEach(btn => on(btn, 'click', e => Theme.set(e.currentTarget.dataset.theme)));

    // Language selector
    qsa('.lang-opt').forEach(btn => on(btn, 'click', e => {
        S.lang = e.currentTarget.dataset.lang;
        qsa('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === S.lang));
    }));

    // Error retry
    on('error-retry', 'click', () => location.reload());

    // Close export menu on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('.export-wrap')) qs('.export-menu')?.classList.add('hidden');
    });
}

// ─── TAB SWITCHING ────────────────────────────────────────────────
function switchTab(name) {
    qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    qsa('.tab').forEach(s => s.classList.remove('active'));
    el(name + '-tab')?.classList.add('active');
}

function switchResultsTab(name) {
    qsa('.rtab').forEach(b => b.classList.toggle('active', b.dataset.resultTab === name));
    qsa('.rpanel').forEach(s => s.classList.remove('active'));
    el(name + '-tab')?.classList.add('active');
}

// ─── UPLOAD ───────────────────────────────────────────────────────
function wireUpload() {
    const area  = el('upload-area');
    const input = el('file-input');
    if (!area || !input) { console.warn('Upload elements missing'); return; }

    area.addEventListener('dragover',  e => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', e => {
        e.preventDefault(); area.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) onFileSelected(e.dataTransfer.files[0]);
    });

    on('file-picker-btn',  'click',  () => input.click());
    input.addEventListener('change', e => { if (e.target.files[0]) onFileSelected(e.target.files[0]); });
    on('remove-file-btn',  'click',  removeFile);
    on('confirm-upload-btn','click', doConfirmUpload);
    on('save-manual-cv-btn','click', doSaveManual);
}

async function onFileSelected(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (file.size > CFG.MAX_FILE)      return toast('File too large (max 10MB)', 'error');
    if (!CFG.EXTS.includes(ext))       return toast('Use PDF, DOCX or TXT', 'error');

    try {
        const text = await Parser.parse(file);
        file._text = text;
        S.pendingFile = file;
        const fn = el('preview-filename'); if (fn) fn.textContent = file.name;
        const fs = el('preview-size');     if (fs) fs.textContent = fmtBytes(file.size);
        const pt = el('preview-text');     if (pt) pt.value = text;
        el('file-preview')?.classList.remove('hidden');
    } catch(e) {
        toast('Error reading file: ' + e.message, 'error');
        S.pendingFile = null;
    }
}

function removeFile() {
    S.pendingFile = null;
    el('file-preview')?.classList.add('hidden');
    const inp = el('file-input'); if (inp) inp.value = '';
}

async function doConfirmUpload() {
    if (!S.pendingFile) return toast('Select a file first', 'error');
    // Use the (possibly edited) textarea content
    const editedText = el('preview-text')?.value?.trim() || S.pendingFile._text;
    if (!editedText) return toast('CV text is empty', 'error');
    try {
        await Store.setMany({ [CFG.KEYS.CV]: editedText, [CFG.KEYS.FNAME]: S.pendingFile.name });
        S.cvContent  = editedText;
        S.cvFilename = S.pendingFile.name;
        toast('CV saved!', 'success');
        updateDash();
        removeFile();
        setTimeout(() => switchTab('dashboard'), 900);
    } catch { toast('Failed to save CV', 'error'); }
}

async function doSaveManual() {
    const text = el('manual-cv-input')?.value.trim() || '';
    if (!text) return toast('Enter CV content first', 'error');
    try {
        await Store.setMany({ [CFG.KEYS.CV]: text, [CFG.KEYS.FNAME]: 'manual-cv.txt' });
        S.cvContent  = text;
        S.cvFilename = 'manual-cv.txt';
        toast('CV saved!', 'success');
        updateDash();
        const inp = el('manual-cv-input'); if (inp) inp.value = '';
        setTimeout(() => switchTab('dashboard'), 900);
    } catch { toast('Failed to save CV', 'error'); }
}

// ─── TAILOR ───────────────────────────────────────────────────────
async function doTailor() {
    const statusEl = el('tailor-status');
    const btn      = el('tailor-btn');
    if (btn) btn.disabled = true;

    function setStatus(msg, type) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className   = 'status-msg ' + type;
    }

    try {
        // Always read fresh from storage — never use stale state
        const url   = await Store.url();
        const token = await Store.token();
        const cv    = await Store.cv();
        const fname = await Store.fname();

        if (!url)   { setStatus('Set your backend URL in Settings first', 'error'); openSettings(); return; }
        if (!token) { setStatus('Set your auth token in Settings first', 'error'); openSettings(); return; }
        if (!cv)    { setStatus('Upload your CV first', 'error'); switchTab('upload'); return; }

        setStatus('Extracting job description…', 'loading');

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const job   = await getJobFromPage(tab.id);

        if (!job || job.trim().length < CFG.MIN_JOB) {
            setStatus('No job description found — make sure you\'re on a job posting page', 'error');
            return;
        }

        setStatus('AI is tailoring your CV… (up to 30s)', 'loading');

        const result = await tailorAPI(url, token, cv, job);

        S.results  = result;
        S.origCv   = cv;
        S.cvContent  = cv;
        S.cvFilename = fname;

        Store.pushSession({
            jobSnippet:  job.substring(0, 150),
            cvFilename:  fname || 'CV',
            tailoredCv:  result.tailoredCv,
            changesMade: result.changesMade || [],
            gaps:        result.gaps || []
        });

        setStatus('Done! CV tailored successfully', 'success');
        showResults(result);
        renderHistory();

    } catch(e) {
        setStatus('Error: ' + (e.message || 'Unknown error'), 'error');
        console.error(e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function getJobFromPage(tabId) {
    // Try existing content script first
    try {
        const resp = await new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('timeout')), 3000);
            chrome.tabs.sendMessage(tabId, { action: 'getJobDescription' }, r => {
                clearTimeout(t);
                chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r);
            });
        });
        if (resp?.jobDescription?.trim().length > CFG.MIN_JOB) return resp.jobDescription;
    } catch {}

    // Re-inject content script (handles SPA navigation)
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 500));
        const resp = await new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('timeout')), 3000);
            chrome.tabs.sendMessage(tabId, { action: 'getJobDescription' }, r => {
                clearTimeout(t);
                chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r);
            });
        });
        if (resp?.jobDescription?.trim().length > CFG.MIN_JOB) return resp.jobDescription;
    } catch {}

    return '';
}

// ─── RESULTS ──────────────────────────────────────────────────────
function showResults(result) {
    el('results-container')?.classList.remove('hidden');

    const set = (id, val) => { const e = el(id); if (e) e.textContent = val || ''; };
    set('tailored-cv-display',          result.tailoredCv);
    set('original-cv-display',          S.origCv);
    set('comparison-tailored-display',  result.tailoredCv);

    const changes = el('changes-list');
    if (changes) {
        changes.innerHTML = '';
        (result.changesMade?.length ? result.changesMade : ['No changes reported.']).forEach(c => {
            const li = document.createElement('li'); li.textContent = c; changes.appendChild(li);
        });
    }

    const gaps = el('gaps-list');
    if (gaps) {
        gaps.innerHTML = '';
        (result.gaps?.length ? result.gaps : ['No skill gaps identified.']).forEach(g => {
            const li = document.createElement('li'); li.textContent = g; gaps.appendChild(li);
        });
    }

    switchResultsTab('tailored');
}

function resetResults() {
    el('results-container')?.classList.add('hidden');
    S.results = null;
    const s = el('tailor-status');
    if (s) { s.className = 'status-msg hidden'; s.textContent = ''; }
}

// ─── EXPORT ───────────────────────────────────────────────────────
function doExportTxt() {
    if (!S.results?.tailoredCv) return toast('No CV to export', 'error');
    const name = 'CV_Tailored_' + new Date().toISOString().split('T')[0] + '.txt';
    const blob = new Blob([S.results.tailoredCv], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Exported as TXT', 'success');
    qs('.export-menu')?.classList.add('hidden');
}

function doExportPdf() {
    if (!S.results?.tailoredCv) return toast('No CV to export', 'error');
    const name = 'CV_Tailored_' + new Date().toISOString().split('T')[0];

    // Build print-ready HTML that mirrors CV layout
    const lines  = S.results.tailoredCv.split('\n');
    let body = '';
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { body += '<br>'; continue; }
        const isHeader = (line === line.toUpperCase() && line.length < 60 && line.length > 2)
            || /^(EXPERIENCE|EDUCATION|SKILLS|SUMMARY|PROFILE|OBJECTIVE|PROJECTS|CERTIFICATIONS|LANGUAGES|CONTACT|WORK|EMPLOYMENT|REFERENCES|AWARDS)/i.test(line);
        const isBullet = /^[-•·*▪◦]/.test(line);
        if (isHeader)  body += `<h2>${esc(line)}</h2>`;
        else if (isBullet) body += `<p class="bullet">${esc(line)}</p>`;
        else           body += `<p>${esc(line)}</p>`;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Georgia','Times New Roman',serif;font-size:11pt;line-height:1.6;color:#111;padding:2cm 2.5cm;max-width:21cm;margin:0 auto}
h2{font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #333;margin:14px 0 5px;padding-bottom:2px}
p{margin-bottom:3px}
p.bullet{padding-left:16px}
br{display:block;margin:4px 0;content:""}
@media print{body{padding:0}@page{margin:2cm 2.5cm;size:A4}}
</style></head><body>${body}</body></html>`;

    const win = window.open('', '_blank', 'width=820,height=960');
    if (!win) { toast('Allow popups to export PDF', 'warning'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
    toast('Print dialog opened — choose "Save as PDF"', 'info');
    qs('.export-menu')?.classList.add('hidden');
}

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── HISTORY ──────────────────────────────────────────────────────
async function renderHistory() {
    const list = el('history-list');
    const stat = el('stat-tailored');
    if (!list) return;

    let history = [];
    try { history = await Store.history(); } catch {}

    if (stat) stat.textContent = history.length;

    if (!history.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">◷</div><p>No sessions yet</p></div>';
        return;
    }

    list.innerHTML = '';
    for (const s of history) {
        const d = new Date(s.ts);
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="history-card-head">
                <div class="history-meta">
                    <span class="history-date">${dateStr} · ${timeStr}</span>
                    <span class="history-file">${esc(s.cvFilename || 'CV')}</span>
                </div>
                <div class="history-actions">
                    <button class="btn btn-ghost btn-sm history-view-btn">Load</button>
                    <button class="btn btn-danger btn-sm history-del-btn">✕</button>
                </div>
            </div>
            ${s.jobSnippet ? `<div class="history-snippet">${esc(s.jobSnippet)}…</div>` : ''}`;

        card.querySelector('.history-view-btn').addEventListener('click', () => {
            S.results = { tailoredCv: s.tailoredCv, changesMade: s.changesMade, gaps: s.gaps };
            S.origCv  = null;
            showResults(S.results);
            switchTab('tailor');
        });

        card.querySelector('.history-del-btn').addEventListener('click', async () => {
            try {
                const h = await Store.history();
                await Store.set(CFG.KEYS.HISTORY, h.filter(x => x.id !== s.id));
                renderHistory();
            } catch { toast('Delete failed', 'error'); }
        });

        list.appendChild(card);
    }
}

async function doClearHistory() {
    if (!confirm('Clear all history?')) return;
    try { await Store.del(CFG.KEYS.HISTORY); renderHistory(); toast('History cleared', 'success'); }
    catch { toast('Failed', 'error'); }
}

// ─── SETTINGS ────────────────────────────────────────────────────
function openSettings() {
    el('settings-overlay')?.classList.remove('hidden');
    Store.url().then(v   => { const e = el('backend-url'); if(e) e.value = v; });
    Store.token().then(v => { const e = el('auth-token');  if(e) e.value = v; });
    qsa('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === Theme.cur));
}

function closeSettings() { el('settings-overlay')?.classList.add('hidden'); }

async function doSaveSettings() {
    const url   = el('backend-url')?.value.trim()  || '';
    const token = el('auth-token')?.value.trim()   || '';
    if (!url)   return toast('Backend URL is required', 'error');
    if (!token) return toast('Auth token is required', 'error');
    try {
        new URL(url);
    } catch { return toast('Invalid URL format', 'error'); }
    try {
        await Store.setMany({ [CFG.KEYS.URL]: url, [CFG.KEYS.TOKEN]: token });
        toast('Settings saved!', 'success');
        closeSettings();
    } catch { toast('Save failed', 'error'); }
}

// ─── DASHBOARD ────────────────────────────────────────────────────
function updateDash() {
    const e = el('stat-cv-status');
    if (!e) return;
    if (S.cvContent) {
        e.textContent = S.cvFilename || 'Loaded';
        e.classList.add('ok');
    } else {
        e.textContent = '—';
        e.classList.remove('ok');
    }
}

// ─── UTILS ───────────────────────────────────────────────────────
function fmtBytes(b) {
    if (!b) return '0 B';
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(1) + ' ' + ['B','KB','MB'][i];
}

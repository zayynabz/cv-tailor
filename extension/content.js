/**
 * CV Tailor — Content Script v5
 * Robust job description extractor — LinkedIn, Indeed, Glassdoor,
 * Welcome to the Jungle, Greenhouse, Lever, Workday, and generic fallback
 */

'use strict';

// Prevent double-registration if script is injected twice
if (!window.__cvTailorContentLoaded) {
    window.__cvTailorContentLoaded = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getJobDescription') {
            try {
                const jobDescription = extractJobDescription();
                sendResponse({ jobDescription });
            } catch (e) {
                sendResponse({ jobDescription: '' });
            }
        }
        return true;
    });
}

function extractJobDescription() {
    const host = window.location.hostname;

    if (host.includes('linkedin.com'))            return clean(extractLinkedIn());
    if (host.includes('indeed.com'))              return clean(extractIndeed());
    if (host.includes('glassdoor.com'))           return clean(extractGlassdoor());
    if (host.includes('welcometothejungle.com'))  return clean(extractWelcomeJungle());
    if (host.includes('greenhouse.io'))           return clean(extractGreenhouse());
    if (host.includes('lever.co'))                return clean(extractLever());
    if (host.includes('workday.com'))             return clean(extractWorkday());
    if (host.includes('monster.com'))             return clean(extractMonster());
    if (host.includes('stepstone'))               return clean(extractStepstone());
    if (host.includes('careers.') || host.includes('jobs.')) return clean(extractGeneric());

    return clean(extractGeneric());
}

// ─── LinkedIn ──────────────────────────────────────────────────────
function extractLinkedIn() {
    const selectors = [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.jobs-box__html-content',
        '[class*="jobs-description-content"]',
        '[class*="jobs-description__content"]',
        '[class*="job-details-jobs-unified-top-card"]',
        '.scaffold-layout__detail',
        '[data-test-id="job-details"]',
        '.jobs-details__main-content',
        '[class*="jobs-unified-description"]',
        '[class*="description__text"]',
    ];

    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 100) return el.innerText;
    }

    // SPA fallback — grab the largest text block on the page
    return extractLargestBlock();
}

// ─── Indeed ────────────────────────────────────────────────────────
function extractIndeed() {
    const selectors = [
        '#jobDescriptionText',
        '[id*="jobDescriptionText"]',
        '.jobsearch-jobDescriptionText',
        '[class*="jobDescriptionText"]',
        '[class*="job-description"]',
        '.jobsearch-JobComponent-description',
    ];
    return trySelectors(selectors) || extractLargestBlock();
}

// ─── Glassdoor ────────────────────────────────────────────────────
function extractGlassdoor() {
    const selectors = [
        '[data-test="jobDescriptionContent"]',
        '[data-test="JobDescription"]',
        '[class*="JobDetails_jobDescription"]',
        '[class*="jobDescription"]',
        '[class*="JobDescription"]',
        '[class*="desc"]',
    ];
    return trySelectors(selectors) || extractLargestBlock();
}

// ─── Welcome to the Jungle ────────────────────────────────────────
function extractWelcomeJungle() {
    const selectors = [
        '[data-testid="job-description"]',
        '[data-testid="job-section-description"]',
        '[class*="JobDescription"]',
    ];
    return trySelectors(selectors) || qs('main')?.innerText || extractLargestBlock();
}

// ─── Greenhouse ───────────────────────────────────────────────────
function extractGreenhouse() {
    return trySelectors(['#content', '.job-description', '.description']) || extractLargestBlock();
}

// ─── Lever ────────────────────────────────────────────────────────
function extractLever() {
    return trySelectors([
        '[data-qa="job-description"]',
        '.section-wrapper',
        '.posting-content',
        '.content',
    ]) || extractLargestBlock();
}

// ─── Workday ──────────────────────────────────────────────────────
function extractWorkday() {
    return trySelectors([
        '[data-automation-id="jobPostingDescription"]',
        '[class*="jobPostingDescription"]',
        '[data-automation-id="job-posting-details"]',
    ]) || extractLargestBlock();
}

// ─── Monster ──────────────────────────────────────────────────────
function extractMonster() {
    return trySelectors([
        '.job-description',
        '[class*="description"]',
        '#JobDescription',
    ]) || extractLargestBlock();
}

// ─── Stepstone ────────────────────────────────────────────────────
function extractStepstone() {
    return trySelectors([
        '[data-at="job-ad-details"]',
        '[class*="jobDescription"]',
        'article',
    ]) || extractLargestBlock();
}

// ─── Generic fallback ─────────────────────────────────────────────
const JOB_KEYWORDS = [
    'responsibilities', 'requirements', 'qualifications', 'experience',
    'skills', 'duties', 'position', 'role', 'benefits', 'apply',
    'description', 'about the job', 'what you', 'we are looking',
    'compétences', 'expérience', 'poste', 'missions', // French
];

function extractGeneric() {
    const candidates = [
        '[class*="job-description"]', '[class*="job-detail"]',
        '[class*="job-post"]',        '[class*="jobDescription"]',
        '[class*="JobDescription"]',  '[id*="job-description"]',
        '[id*="jobDescription"]',     '[data-testid*="description"]',
        '[data-test*="description"]', 'article', 'main', '[role="main"]',
    ];

    let best = '';
    for (const sel of candidates) {
        for (const el of document.querySelectorAll(sel)) {
            const text = el.innerText || '';
            if (text.length > 200 && JOB_KEYWORDS.some(k => text.toLowerCase().includes(k))) {
                if (text.length > best.length) best = text;
            }
        }
    }
    return best || extractLargestBlock();
}

// Grab the single largest text block on the visible page (last resort)
function extractLargestBlock() {
    let best = '';
    const blocks = document.querySelectorAll('div, section, article, main, p');
    for (const el of blocks) {
        // Skip tiny or invisible elements
        if (el.offsetHeight === 0) continue;
        const text = el.innerText || '';
        if (text.length > best.length && text.length < 50000) best = text;
    }
    return best;
}

// ─── Helpers ──────────────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }

function trySelectors(selectors) {
    for (const sel of selectors) {
        const el = qs(sel);
        if (el && el.innerText.trim().length > 100) return el.innerText;
    }
    return '';
}

function clean(text) {
    if (!text) return '';
    return text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n')
        .substring(0, 20000);
}

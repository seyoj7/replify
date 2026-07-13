document.addEventListener('DOMContentLoaded', () => {
    // --- DOM refs ---
    const $ = (s) => document.getElementById(s);
    const variationsSlider = $('variations-slider');
    const variationsVal    = $('variations-val');
    const settingsView     = $('settings-view');
    const generatorView    = $('generator-view');
    const generateBtn      = $('generate-btn');
    const urlInput         = $('x-post-url');
    const loadingSpinner   = $('loading-spinner');
    const resultsContainer = $('results-container');
    const saveSettingsBtn  = $('save-settings-btn');
    const clearHistoryBtn  = $('clear-history-btn');
    const historyList      = $('history-list');
    const historyEmpty     = $('history-empty-state');
    const noPostMessage    = $('no-post-message');
    const toneSelect       = $('tone-select');
    const lengthSelect     = $('length-select');
    const instrTextarea    = $('instructions-textarea');
    const emojiToggle      = document.querySelector('.toggle-wrapper input');

    // --- Storage ---
    const storage = (() => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            return {
                get: k => new Promise(r => chrome.storage.local.get([k], res => r(res[k]))),
                set: (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r))
            };
        }
        return {
            get: k => { try { return Promise.resolve(JSON.parse(localStorage.getItem(k))); } catch { return Promise.resolve(null); } },
            set: (k, v) => { localStorage.setItem(k, JSON.stringify(v)); return Promise.resolve(); }
        };
    })();

    const SETTINGS_KEY = 'replify_settings';
    const HISTORY_KEY  = 'replify_history';
    const MAX_HISTORY  = 10;

    // --- Helpers ---
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    function show(el) { if (el) el.style.display = 'flex'; }
    function hide(el) { if (el) el.style.display = 'none'; }

    async function copyText(btn, text) {
        try {
            await navigator.clipboard.writeText(text);
            const icon = btn.querySelector('.material-symbols-outlined');
            icon.textContent = 'check';
            setTimeout(() => { icon.textContent = 'content_copy'; }, 2000);
        } catch (e) { console.error('Copy failed:', e); }
    }

    // --- Slider ---
    variationsSlider?.addEventListener('input', e => { variationsVal.textContent = e.target.value; });

    // --- View toggle ---
    $('header-preferences-btn')?.addEventListener('click', () => { hide(generatorView); show(settingsView); });
    $('header-settings-btn')?.addEventListener('click', () => { hide(settingsView); show(generatorView); });

    // --- Settings ---
    async function loadSettings() {
        try {
            const s = await storage.get(SETTINGS_KEY);
            if (!s) return;
            if (s.tone && toneSelect)          toneSelect.value = s.tone;
            if (s.numVariations && variationsSlider) {
                variationsSlider.value = s.numVariations;
                if (variationsVal) variationsVal.textContent = s.numVariations;
            }
            if (s.length && lengthSelect)      lengthSelect.value = s.length;
            if (s.instructions !== undefined && instrTextarea) instrTextarea.value = s.instructions;
            if (s.emoji !== undefined && emojiToggle) emojiToggle.checked = s.emoji;
        } catch (e) { console.error('Failed to load settings:', e); }
    }

    async function saveSettings() {
        const s = {
            tone: toneSelect?.value || 'professional',
            numVariations: variationsSlider?.value || '3',
            length: lengthSelect?.value || 'short',
            instructions: instrTextarea?.value || '',
            emoji: emojiToggle ? emojiToggle.checked : true
        };
        try {
            await storage.set(SETTINGS_KEY, s);
            if (saveSettingsBtn) {
                saveSettingsBtn.innerHTML = '<span class="material-symbols-outlined">check</span> Saved!';
                setTimeout(() => { saveSettingsBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Settings'; }, 1500);
            }
        } catch (e) { console.error('Failed to save settings:', e); }
    }

    saveSettingsBtn?.addEventListener('click', saveSettings);
    loadSettings();

    // --- History ---
    function relTime(ts) {
        const d = Date.now() - ts;
        const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), dy = Math.floor(d / 86400000);
        if (m < 1) return 'Just now';
        if (m < 60) return m + 'm ago';
        if (h < 24) return h + 'h ago';
        return dy + 'd ago';
    }

    function shortUrl(url) {
        try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            return parts.length >= 3 ? '@' + parts[0] : new URL(url).hostname;
        } catch { return url.slice(0, 30); }
    }

    function buildCard(session) {
        const card = document.createElement('div');
        card.className = 'history-session';
        card.dataset.id = session.id;

        const replies = session.replies.map(r => `
            <div class="history-session-reply-row">
                <span class="font-body-sm history-reply-text">${esc(r)}</span>
                <div class="history-actions">
                    <button class="action-icon-btn copy-btn" data-reply="${encodeURIComponent(r)}" title="Copy">
                        <span class="material-symbols-outlined">content_copy</span>
                    </button>
                </div>
            </div>`).join('');

        card.innerHTML = `
            <div class="history-session-header">
                <div class="history-session-meta">
                    <span class="history-tone-badge">${esc(session.tone)}</span>
                    <div class="history-session-info">
                        <span class="history-session-url">${esc(shortUrl(session.postUrl))}</span>
                        <span class="history-session-time">${relTime(session.id)}</span>
                    </div>
                </div>
                <div class="history-session-right">
                    <span class="history-count-badge">${session.replies.length}</span>
                    <span class="material-symbols-outlined history-chevron">expand_more</span>
                </div>
            </div>
            <div class="history-session-replies">${replies}</div>`;

        card.querySelector('.history-session-header').addEventListener('click', () => card.classList.toggle('expanded'));
        card.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); copyText(btn, decodeURIComponent(btn.dataset.reply)); });
        });
        return card;
    }

    function renderHistory(sessions) {
        historyList.innerHTML = '';
        const empty = !sessions?.length;
        historyEmpty.style.display = empty ? 'flex' : 'none';
        clearHistoryBtn.style.display = empty ? 'none' : 'flex';
        if (!empty) [...sessions].reverse().forEach(s => historyList.appendChild(buildCard(s)));
    }

    async function loadHistory() { renderHistory(await storage.get(HISTORY_KEY) || []); }

    async function saveToHistory(session) {
        let sessions = await storage.get(HISTORY_KEY) || [];
        sessions.push(session);
        if (sessions.length > MAX_HISTORY) sessions = sessions.slice(-MAX_HISTORY);
        await storage.set(HISTORY_KEY, sessions);
        renderHistory(sessions);
    }

    clearHistoryBtn?.addEventListener('click', async () => { await storage.set(HISTORY_KEY, []); renderHistory([]); });
    loadHistory();

    // --- Auto-detect post URL ---
    async function autoDetect() {
        if (typeof chrome === 'undefined' || !chrome.tabs) { show(noPostMessage); return; }
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.url) { show(noPostMessage); return; }
            const url = tab.url;
            if ((url.includes('x.com/') || url.includes('twitter.com/')) && url.includes('/status/')) {
                urlInput.value = url;
                urlInput.classList.add('auto-detected');
                if (generateBtn) generateBtn.disabled = false;
                hide(noPostMessage);
                const badge = document.createElement('div');
                badge.className = 'auto-detect-badge font-label-sm';
                badge.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">link</span> Auto-detected from active tab';
                urlInput.parentElement.insertBefore(badge, urlInput.nextSibling);
            } else {
                show(noPostMessage);
                if (generateBtn) generateBtn.disabled = true;
            }
        } catch (e) { console.warn('Auto-detect failed:', e); show(noPostMessage); }
    }
    autoDetect();

    // --- Tweet scraping ---
    async function extractTweet(postUrl) {
        if (typeof chrome === 'undefined' || !chrome.scripting || !chrome.tabs) return null;
        try {
            const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
            let tab = tabs.find(t => t.url?.includes(postUrl));
            if (!tab) {
                const m = postUrl.match(/status\/(\d+)/);
                if (m) tab = tabs.find(t => t.url?.includes(m[1]));
            }
            if (!tab) {
                const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (active?.url && (active.url.includes('x.com') || active.url.includes('twitter.com'))) tab = active;
            }
            if (!tab) return null;

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const el = document.querySelector('article[data-testid="tweet"] div[data-testid="tweetText"]');
                    if (el) return el.innerText;
                    const meta = document.querySelector('meta[property="og:description"]');
                    return meta?.content || null;
                }
            });
            return results?.[0]?.result || null;
        } catch (e) { console.warn('Tweet extraction failed:', e); return null; }
    }

    // --- Generate ---
    generateBtn?.addEventListener('click', async () => {
        const postUrl = urlInput.value.trim();
        if (!postUrl) return;

        const tone = toneSelect?.value || 'professional';
        const numVariations = parseInt(variationsSlider?.value || '3', 10);
        const length = lengthSelect?.value || 'short';
        const instructions = instrTextarea?.value || '';
        const emoji = emojiToggle ? emojiToggle.checked : true;

        resultsContainer.innerHTML = '';
        loadingSpinner.style.display = 'block';
        generateBtn.disabled = true;

        try {
            const postText = await extractTweet(postUrl);
            const res = await fetch('http://127.0.0.1:8000/generate-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    post_url: postText ? '' : postUrl,
                    post_text: postText || '',
                    tone, num_variations: numVariations, length,
                    custom_instructions: instructions, emoji
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.detail || res.statusText);
            }
            const replies = (await res.json()).replies || [];
            hide(loadingSpinner);

            replies.forEach(reply => {
                const card = document.createElement('div');
                card.className = 'history-item';
                card.innerHTML = `
                    <div class="font-body-sm history-reply">${esc(reply)}</div>
                    <div class="history-actions">
                        <button class="action-icon-btn copy-btn" data-reply="${encodeURIComponent(reply)}" title="Copy">
                            <span class="material-symbols-outlined">content_copy</span>
                        </button>
                    </div>`;
                resultsContainer.appendChild(card);
            });

            resultsContainer.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', () => copyText(btn, decodeURIComponent(btn.dataset.reply)));
            });

            await saveToHistory({ id: Date.now(), postUrl, tone, replies });
        } catch (e) {
            console.error(e);
            alert('Failed to generate replies. Make sure the server is running and the link is valid.');
            hide(loadingSpinner);
        } finally {
            generateBtn.disabled = false;
        }
    });
});
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM References ---
    const variationsSlider = document.getElementById('variations-slider');
    const variationsVal    = document.getElementById('variations-val');
    const settingsView     = document.getElementById('settings-view');
    const generatorView    = document.getElementById('generator-view');
    const headerGeneratorBtn   = document.getElementById('header-settings-btn');
    const headerPreferencesBtn = document.getElementById('header-preferences-btn');
    const generateBtn      = document.getElementById('generate-btn');
    const urlInput         = document.getElementById('x-post-url');
    const loadingSpinner   = document.getElementById('loading-spinner');
    const resultsContainer = document.getElementById('results-container');
    const saveSettingsBtn  = document.getElementById('save-settings-btn');
    const clearHistoryBtn  = document.getElementById('clear-history-btn');
    const historyList      = document.getElementById('history-list');
    const historyEmptyState = document.getElementById('history-empty-state');

    // Settings elements
    const toneSelect          = document.getElementById('tone-select');
    const lengthSelect        = document.getElementById('length-select');
    const instructionsTextarea = document.getElementById('instructions-textarea');
    const emojiToggle         = document.querySelector('.toggle-wrapper input');

    // ─── Storage Abstraction ─────────────────────────────────────────────────
    function getStorage() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return {
                get: (key) => new Promise((resolve) => {
                    chrome.storage.local.get([key], (result) => resolve(result[key]));
                }),
                set: (key, value) => new Promise((resolve) => {
                    chrome.storage.local.set({ [key]: value }, resolve);
                })
            };
        }
        return {
            get: (key) => {
                try { return Promise.resolve(JSON.parse(localStorage.getItem(key))); }
                catch { return Promise.resolve(null); }
            },
            set: (key, value) => {
                localStorage.setItem(key, JSON.stringify(value));
                return Promise.resolve();
            }
        };
    }
    const storage = getStorage();

    const SETTINGS_KEY = 'replify_settings';
    const HISTORY_KEY  = 'replify_history';
    const MAX_HISTORY  = 10; // max sessions to keep

    // ─── Slider ─────────────────────────────────────────────────────────────
    if (variationsSlider && variationsVal) {
        variationsSlider.addEventListener('input', (e) => {
            variationsVal.textContent = e.target.value;
        });
    }

    // ─── View Toggling ───────────────────────────────────────────────────────
    function hideAllViews() {
        settingsView.style.display = 'none';
        generatorView.style.display = 'none';
    }

    headerPreferencesBtn?.addEventListener('click', () => {
        hideAllViews();
        settingsView.style.display = 'flex';
    });

    headerGeneratorBtn?.addEventListener('click', () => {
        hideAllViews();
        generatorView.style.display = 'flex';
    });

    // ─── Settings Persistence ────────────────────────────────────────────────
    async function loadSettings() {
        try {
            const s = await storage.get(SETTINGS_KEY);
            if (!s) return;
            if (s.tone && toneSelect)                   toneSelect.value = s.tone;
            if (s.numVariations && variationsSlider) {
                variationsSlider.value = s.numVariations;
                if (variationsVal) variationsVal.textContent = s.numVariations;
            }
            if (s.length && lengthSelect)               lengthSelect.value = s.length;
            if (s.instructions !== undefined && instructionsTextarea)
                                                        instructionsTextarea.value = s.instructions;
            if (s.emoji !== undefined && emojiToggle)   emojiToggle.checked = s.emoji;
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }

    async function saveSettings() {
        const s = {
            tone:          toneSelect?.value          || 'professional',
            numVariations: variationsSlider?.value    || '3',
            length:        lengthSelect?.value        || 'short',
            instructions:  instructionsTextarea?.value || '',
            emoji:         emojiToggle ? emojiToggle.checked : true
        };
        try {
            await storage.set(SETTINGS_KEY, s);
            if (saveSettingsBtn) {
                saveSettingsBtn.innerHTML = '<span class="material-symbols-outlined">check</span> Saved!';
                setTimeout(() => {
                    saveSettingsBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Settings';
                }, 1500);
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
        }
    }

    saveSettingsBtn?.addEventListener('click', saveSettings);
    loadSettings();

    // ─── History Helpers ─────────────────────────────────────────────────────
    function formatRelativeTime(ts) {
        const diff = Date.now() - ts;
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins < 1)    return 'Just now';
        if (mins < 60)   return `${mins}m ago`;
        if (hours < 24)  return `${hours}h ago`;
        return `${days}d ago`;
    }

    function shortenUrl(url) {
        try {
            const u = new URL(url);
            // "x.com/handle/status/123…"
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length >= 3) return `@${parts[0]}`;
            return u.hostname;
        } catch {
            return url.slice(0, 30);
        }
    }

    function buildSessionCard(session) {
        const card = document.createElement('div');
        card.className = 'history-session';
        card.dataset.id = session.id;

        const repliesHtml = session.replies.map((reply, i) => `
            <div class="history-session-reply-row">
                <span class="font-body-sm history-reply-text">${escapeHtml(reply)}</span>
                <div class="history-actions">
                    <button class="action-icon-btn copy-btn-hist" data-reply="${encodeURIComponent(reply)}" title="Copy">
                        <span class="material-symbols-outlined">content_copy</span>
                    </button>
                </div>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="history-session-header">
                <div class="history-session-meta">
                    <span class="history-tone-badge">${escapeHtml(session.tone)}</span>
                    <div class="history-session-info">
                        <span class="history-session-url">${escapeHtml(shortenUrl(session.postUrl))}</span>
                        <span class="history-session-time">${formatRelativeTime(session.id)}</span>
                    </div>
                </div>
                <div class="history-session-right">
                    <span class="history-count-badge">${session.replies.length}</span>
                    <span class="material-symbols-outlined history-chevron">expand_more</span>
                </div>
            </div>
            <div class="history-session-replies">
                ${repliesHtml}
            </div>
        `;

        // Toggle expand/collapse
        card.querySelector('.history-session-header').addEventListener('click', () => {
            card.classList.toggle('expanded');
        });

        // Copy buttons
        card.querySelectorAll('.copy-btn-hist').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const text = decodeURIComponent(e.currentTarget.getAttribute('data-reply'));
                try {
                    await navigator.clipboard.writeText(text);
                    const icon = e.currentTarget.querySelector('.material-symbols-outlined');
                    icon.textContent = 'check';
                    setTimeout(() => { icon.textContent = 'content_copy'; }, 2000);
                } catch (err) {
                    console.error('Copy failed:', err);
                }
            });
        });

        return card;
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderHistory(sessions) {
        historyList.innerHTML = '';
        const isEmpty = !sessions || sessions.length === 0;
        historyEmptyState.style.display = isEmpty ? 'flex' : 'none';
        clearHistoryBtn.style.display   = isEmpty ? 'none' : 'flex';
        if (isEmpty) return;

        // Most recent first
        [...sessions].reverse().forEach(session => {
            historyList.appendChild(buildSessionCard(session));
        });
    }

    async function loadHistory() {
        const sessions = await storage.get(HISTORY_KEY) || [];
        renderHistory(sessions);
    }

    async function saveToHistory(session) {
        let sessions = await storage.get(HISTORY_KEY) || [];
        sessions.push(session);
        // Keep only the latest MAX_HISTORY entries
        if (sessions.length > MAX_HISTORY) {
            sessions = sessions.slice(sessions.length - MAX_HISTORY);
        }
        await storage.set(HISTORY_KEY, sessions);
        renderHistory(sessions);
    }

    clearHistoryBtn?.addEventListener('click', async () => {
        await storage.set(HISTORY_KEY, []);
        renderHistory([]);
    });

    loadHistory();

    // ─── Tweet Scraping via Content Script ────────────────────────────────────
    /**
     * Extracts tweet text from the active X/Twitter tab by injecting a script.
     * Returns the tweet text string, or null if extraction fails.
     */
    async function extractTweetFromTab(postUrl) {
        // Only works in extension context
        if (typeof chrome === 'undefined' || !chrome.scripting || !chrome.tabs) {
            return null;
        }

        try {
            // Find the X/Twitter tab that matches the URL
            const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
            
            // Try to find a tab whose URL matches the provided post URL
            let targetTab = tabs.find(t => t.url && t.url.includes(postUrl));
            
            // If no exact match, try matching by tweet ID
            if (!targetTab) {
                const match = postUrl.match(/status\/(\d+)/);
                if (match) {
                    const tweetId = match[1];
                    targetTab = tabs.find(t => t.url && t.url.includes(tweetId));
                }
            }

            // If still no matching tab, use the active tab if it's an X page
            if (!targetTab) {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTab && activeTab.url && (activeTab.url.includes('x.com') || activeTab.url.includes('twitter.com'))) {
                    targetTab = activeTab;
                }
            }

            if (!targetTab) return null;

            // Inject script to extract tweet text from the page
            const results = await chrome.scripting.executeScript({
                target: { tabId: targetTab.id },
                func: () => {
                    // Try to find the main tweet text from the article
                    const tweetTextEl = document.querySelector('article[data-testid="tweet"] div[data-testid="tweetText"]');
                    if (tweetTextEl) {
                        return tweetTextEl.innerText;
                    }
                    // Fallback: try meta description
                    const metaDesc = document.querySelector('meta[property="og:description"]');
                    if (metaDesc) {
                        return metaDesc.content;
                    }
                    return null;
                }
            });

            if (results && results[0] && results[0].result) {
                return results[0].result;
            }
        } catch (err) {
            console.warn('Failed to extract tweet from tab:', err);
        }
        return null;
    }

    // ─── Generator Logic ─────────────────────────────────────────────────────
    generateBtn?.addEventListener('click', async () => {
        const postUrl = urlInput.value.trim();
        if (!postUrl) {
            alert('Please enter a valid X post link');
            return;
        }

        const tone         = toneSelect?.value           || 'professional';
        const numVariations = parseInt(variationsSlider?.value || '3', 10);
        const length       = lengthSelect?.value         || 'short';
        const instructions = instructionsTextarea?.value || '';
        const includeEmoji = emojiToggle ? emojiToggle.checked : true;

        resultsContainer.innerHTML = '';
        loadingSpinner.style.display = 'block';
        generateBtn.disabled = true;

        try {
            // Try to extract tweet text from the browser tab first
            let postText = await extractTweetFromTab(postUrl);

            const response = await fetch('http://127.0.0.1:8000/generate-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    post_url:            postText ? '' : postUrl,
                    post_text:           postText || '',
                    tone,
                    num_variations:      numVariations,
                    length,
                    custom_instructions: instructions,
                    emoji:               includeEmoji
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.detail || response.statusText);
            }

            const data    = await response.json();
            const replies = data.replies || [];

            loadingSpinner.style.display = 'none';

            // Render fresh reply cards
            replies.forEach((reply) => {
                const card = document.createElement('div');
                card.className = 'history-item';
                card.style.marginBottom = '12px';
                card.innerHTML = `
                    <div class="font-body-sm history-reply">${escapeHtml(reply)}</div>
                    <div class="history-actions">
                        <button class="action-icon-btn copy-btn-gen" data-reply="${encodeURIComponent(reply)}" title="Copy">
                            <span class="material-symbols-outlined">content_copy</span>
                        </button>
                    </div>
                `;
                resultsContainer.appendChild(card);
            });

            // Wire copy buttons for fresh results
            resultsContainer.querySelectorAll('.copy-btn-gen').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const text = decodeURIComponent(e.currentTarget.getAttribute('data-reply'));
                    try {
                        await navigator.clipboard.writeText(text);
                        const icon = e.currentTarget.querySelector('.material-symbols-outlined');
                        icon.textContent = 'check';
                        setTimeout(() => { icon.textContent = 'content_copy'; }, 2000);
                    } catch (err) {
                        console.error('Copy failed:', err);
                    }
                });
            });

            // Persist to history
            await saveToHistory({
                id:      Date.now(),
                postUrl,
                tone,
                replies
            });

        } catch (err) {
            console.error(err);
            alert('Failed to generate replies. Make sure the server is running and the link is valid.');
            loadingSpinner.style.display = 'none';
        } finally {
            generateBtn.disabled = false;
        }
    });
});
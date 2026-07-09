document.addEventListener('DOMContentLoaded', () => {
    const variationsSlider = document.getElementById('variations-slider');
    const variationsVal = document.getElementById('variations-val');

    if (variationsSlider && variationsVal) {
        variationsSlider.addEventListener('input', (e) => {
            variationsVal.textContent = e.target.value;
        });
    }

});

// View Toggling
const settingsView = document.getElementById('settings-view');
const generatorView = document.getElementById('generator-view');
const headerGeneratorBtn = document.getElementById('header-settings-btn');
const headerPreferencesBtn = document.getElementById('header-preferences-btn');

function hideAllViews() {
    settingsView.style.display = 'none';
    generatorView.style.display = 'none';
}

if (headerPreferencesBtn) {
    headerPreferencesBtn.addEventListener('click', () => {
        hideAllViews();
        settingsView.style.display = 'flex';
    });
}

headerGeneratorBtn.addEventListener('click', () => {
    hideAllViews();
    generatorView.style.display = 'block';
});

// Generator Logic
const generateBtn = document.getElementById('generate-btn');
const urlInput = document.getElementById('x-post-url');
const loadingSpinner = document.getElementById('loading-spinner');
const resultsContainer = document.getElementById('results-container');

if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
        const postUrl = urlInput.value.trim();
        if (!postUrl) {
            alert("Please enter a valid X post link");
            return;
        }

        // Get settings
        const tone = document.getElementById('tone-select')?.value || 'professional';
        const numVariations = parseInt(document.getElementById('variations-slider')?.value || '3', 10);
        const length = document.getElementById('length-select')?.value || 'short';
        const instructions = document.getElementById('instructions-textarea')?.value || '';
        const emojiToggle = document.querySelector('.toggle-wrapper input');
        const includeEmoji = emojiToggle ? emojiToggle.checked : true;

        resultsContainer.innerHTML = '';
        loadingSpinner.style.display = 'block';
        generateBtn.disabled = true;

        try {
            const response = await fetch('http://127.0.0.1:8000/generate-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    post_url: postUrl,
                    post_text: "",
                    tone: tone,
                    num_variations: numVariations,
                    length: length,
                    custom_instructions: instructions,
                    emoji: includeEmoji
                })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.statusText}`);
            }

            const data = await response.json();
            const replies = data.replies || [];

            loadingSpinner.style.display = 'none';

            replies.forEach((reply, index) => {
                const replyCard = document.createElement('div');
                replyCard.className = 'history-item';
                replyCard.style.marginBottom = '12px';
                replyCard.innerHTML = `
                    <div class="font-body-sm history-reply">${reply}</div>
                    <div class="history-actions">
                        <button class="action-icon-btn copy-btn-gen" data-reply="${encodeURIComponent(reply)}" title="Copy">
                            <span class="material-symbols-outlined">content_copy</span>
                        </button>
                    </div>
                `;
                resultsContainer.appendChild(replyCard);
            });

            // Attach copy listeners
            document.querySelectorAll('.copy-btn-gen').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const replyText = decodeURIComponent(e.currentTarget.getAttribute('data-reply'));
                    try {
                        await navigator.clipboard.writeText(replyText);
                        const icon = e.currentTarget.querySelector('.material-symbols-outlined');
                        icon.textContent = 'check';
                        setTimeout(() => { icon.textContent = 'content_copy'; }, 2000);
                    } catch (err) {
                        console.error('Failed to copy: ', err);
                    }
                });
            });

        } catch (err) {
            console.error(err);
            alert("Failed to generate replies. Make sure the server is running and the link is valid.");
            loadingSpinner.style.display = 'none';
        } finally {
            generateBtn.disabled = false;
        }
    });
}


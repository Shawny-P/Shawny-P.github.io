// === GLOBAL ERROR HANDLING ===
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    showToast('An error occurred. Check console for details.');
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    showToast('An async error occurred. Check console for details.');
});

// === CONFIGURATION ===
const CONFIG = {
    MAX_INPUT_SIZE: 5 * 1024 * 1024, // 5MB
    AUTO_SAVE_DELAY: 2000,
    RENDER_DEBOUNCE: 250,
    USER_KEYWORDS: ['user', 'you', 'me', 'human', 'prompter'],
    AI_KEYWORDS: ['ai', 'chatgpt', 'claude', 'gemini', 'grok', 'llama', 'copilot', 'assistant', 'model', 'bot']
};

// === CLASSIFIER INSTANCE ===
const speakerClassifier = new SpeakerClassifier();

if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true, strikethrough: false });
} else {
    console.error('Marked Library not loaded. Check Internet connection or CSP.');
}

// === STATE MANAGEMENT ===
const State = {
    renderTimeout: null,
    autoSaveTimeout: null,
    isUpdatingFromPreview: false,
    speakerColorCache: {},
    currentThemeIndex: 0
};

// === DOM ELEMENTS (Initialize lazily) ===
let elements = {};

/**
 * Manages a dynamic stylesheet to avoid inline styles, complying with a strict CSP.
 */
const StyleManager = {
    sheet: null,
    rules: new Set(), // Cache to avoid adding duplicate rules

    init() {
        const styleEl = document.createElement('style');
        document.head.appendChild(styleEl);
        this.sheet = styleEl.sheet;
    },

    ensureRule(className, cssText) {
        if (this.sheet && !this.rules.has(className)) try {
            this.sheet.insertRule(`.${className} { ${cssText} }`, this.sheet.cssRules.length);
            this.rules.add(className);
        } catch (e) {
            console.warn('Could not insert rule:', className);
        }
    }
};

// --- Theme Management ---
const themes = [
    'light', 
    'dark', 
    'ocean-breeze', 
    'sunset-glow', 
    'tropical-vibes', 
    'coral-reef', 
    'sky-sand', 
    'citrus-pop', 
    'lavender-fields', 
    'aqua-coral', 
    'berry-burst', 
    'fresh-lime'
];

// SECURE: Whitelist of valid themes
const VALID_THEMES = [...themes];

/**
 * Generates a unique, deterministic class name for a speaker and ensures a CSS rule exists for it.
 * @param {string} speaker - The speaker's name.
 * @returns {string} The CSS class name for the speaker.
 */
function getClassForSpeaker(speaker) {
    if (State.speakerColorCache[speaker]) {
        return State.speakerColorCache[speaker];
    }
    // Deterministic hash function to get a consistent value from the speaker's name.
    let hash = 0;
    for (let i = 0; i < speaker.length; i++) {
        hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const className = `speaker-hash-${Math.abs(hash).toString(36)}`;
    
    // FIX: Create rules for both the border and the label color
    const dynamicColor = `hsl(${hue}, 90%, 75%)`;
    StyleManager.ensureRule(className, `border-color: ${dynamicColor};`);
    StyleManager.ensureRule(`${className} .speaker-label`, `color: ${dynamicColor};`);
    State.speakerColorCache[speaker] = className;
    return className;
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compile keyword regexes for performance.
// The following regexes are built from hardcoded keyword lists.
// While building regex from strings can be a security risk if the input is untrusted,
// in this case the input is a hardcoded constant, so the risk is minimal.
// Using a regex is more performant than iterating through the keyword arrays for each line of input.
const userKeywordRegex = new RegExp(`\\b(${CONFIG.USER_KEYWORDS.map(escapeRegex).join('|')})\\b`, 'i');
const aiKeywordRegex = new RegExp(`\\b(${CONFIG.AI_KEYWORDS.map(escapeRegex).join('|')})\\b`, 'i');

function init() {
    // --- CRITICAL: Check for dependencies before proceeding ---
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
        document.body.innerHTML = `<div class="critical-error-container">
        <h1>Critical Error: Core library failed to load.</h1>
        <p>The application cannot start because a required library (Marked.js for parsing or DOMPurify for security) did not load. This may be due to a network issue, a content delivery network (CDN) outage, or a browser extension blocking the request.</p>
        <p><strong>Please check your internet connection and reload the page. Do not paste any data.</strong></p>
    </div>`;
        // Halt all further execution
        return;
    }

    // FIX: Select elements here to ensure DOM is ready
    elements = {
        input: document.getElementById('inputBox'),
        output: document.getElementById('outputContent'),
        title: document.getElementById('docTitle'),
        date: document.getElementById('dateField'),
        source: document.getElementById('sourceField'),
        count: document.getElementById('charCount'),
        status: document.getElementById('saveStatus'),
        scoreModalOverlay: document.getElementById('scoreModalOverlay'),
        scoreModalContent: document.getElementById('scoreModalContent')
    };

    StyleManager.init(); // Initialize the dynamic stylesheet
    const savedTheme = localStorage.getItem('chatTheme');
    // SECURE: Validate saved theme
    setTheme(VALID_THEMES.includes(savedTheme) ? savedTheme : 'light');
    resetMetaOnReload();
    
    // Set date if still empty after potential reload reset
    if (!elements.date.value || elements.date.value === "Enter Date Here") {
        const today = new Date();
        elements.date.value = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // --- Event Listeners for Controls (replaces onclick) ---
    document.getElementById('btnLoad').addEventListener('click', Storage.load);
    document.getElementById('btnThemeLight').addEventListener('click', () => setTheme('light'));
    document.getElementById('btnThemeDark').addEventListener('click', () => setTheme('dark'));
    document.getElementById('btnThemeCycle').addEventListener('click', cycleTheme);
    document.getElementById('btnSave').addEventListener('click', Storage.save);
    document.getElementById('btnClear').addEventListener('click', clearText);
    document.getElementById('btnPrint').addEventListener('click', () => window.print());
    document.getElementById('btnPaste').addEventListener('click', pasteFromClipboard);

    // --- Event listener for Score Modal ---
    elements.scoreModalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.scoreModalOverlay) {
            elements.scoreModalOverlay.classList.remove('visible');
        }
    });
    
    elements.input.addEventListener('input', () => {
        if (elements.input.value.length > CONFIG.MAX_INPUT_SIZE) {
            elements.input.value = elements.input.value.substring(0, CONFIG.MAX_INPUT_SIZE);
            showToast(`Input truncated to ${(CONFIG.MAX_INPUT_SIZE / 1024 / 1024).toFixed(1)}MB limit`);
        }
        handleInput(true); // Debounce rendering
    });
    // Handle rich text pasting by converting it to clean plain text
    elements.input.addEventListener('paste', handlePaste);
    
    // --- CRITICAL SECURITY FIX: Sanitize contenteditable inputs ---
    // 1. Force all pastes into contenteditable bubbles to be plain text.
    elements.output.addEventListener('paste', (e) => {
        if (e.target && e.target.matches('.markdown-body[contenteditable="true"]')) {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        }
    }, true); // Use capture phase

    // 2. Sanitize any input (typing, drag-drop, etc.) in real-time.
    elements.output.addEventListener('input', (e) => {
        if (e.target && e.target.matches('.markdown-body[contenteditable="true"]')) {
            // Immediately sanitize any pasted/edited content
            if (typeof DOMPurify === 'undefined') return;
            const clean = DOMPurify.sanitize(e.target.innerHTML, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote'],
                ALLOWED_ATTR: ['class'],
                ALLOW_DATA_ATTR: false
            });
            if (clean !== e.target.innerHTML) {
                e.target.innerHTML = clean;
                // Reposition cursor at the end after sanitization
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(e.target);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
                showToast("Potentially dangerous content was removed");
            }
        }
    }, true); // Use capture phase

    // Tab support in textarea
    elements.input.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertText', false, "    ");
        }
    });

    // Use event delegation to handle edits within the preview pane
    elements.output.addEventListener('blur', (e) => {
        // When a user clicks away from an edited bubble, update the source text
        if (e.target && e.target.matches('.markdown-body[contenteditable="true"]')) {
            updateSourceFromPreview();
        }
    }, true); // Use capture phase to ensure the event is caught reliably.

    // Accessibility: Keyboard navigation for bubbles
    elements.output.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && e.target.matches('.markdown-body[contenteditable="true"]')) {
            const bubbles = Array.from(elements.output.querySelectorAll('.markdown-body[contenteditable="true"]'));
            const currentIndex = bubbles.indexOf(e.target);
            
            if (e.shiftKey && currentIndex > 0) {
                e.preventDefault();
                bubbles[currentIndex - 1].focus();
            } else if (!e.shiftKey && currentIndex < bubbles.length - 1) {
                e.preventDefault();
                bubbles[currentIndex + 1].focus();
            }
        }
    });

    // Add confirmation before leaving the page if there's unsaved text
    window.addEventListener('beforeunload', (e) => {
        // Clear all pending timers to prevent memory leaks on unload
        if (State.renderTimeout) clearTimeout(State.renderTimeout);
        if (State.autoSaveTimeout) clearTimeout(State.autoSaveTimeout);

        if (elements.input.value.trim().length > 0) {
            // Standard way to trigger the browser's confirmation dialog
            e.preventDefault();
            e.returnValue = '';
        }
    }); // loadAutoSave(); // Disabled for privacy on shared computers. User must explicitly click "Load".
}

function setTheme(theme) {
    // SECURE: Validate theme against whitelist
    if (!VALID_THEMES.includes(theme)) {
        console.warn(`Invalid theme: ${theme}. Defaulting to light.`);
        theme = 'light';
    }

    // BEST PRACTICE: Safely remove old theme classes using classList API
    const classesToRemove = Array.from(document.body.classList).filter(
        c => c.startsWith('theme-') || c === 'dark-mode'
    );
    document.body.classList.remove(...classesToRemove);

    if (theme !== 'light') {
        const className = theme === 'dark' ? 'dark-mode' : `theme-${theme}`;
        document.body.classList.add(className);
    }
    
    localStorage.setItem('chatTheme', theme);
    const themeIndex = VALID_THEMES.indexOf(theme);
    State.currentThemeIndex = themeIndex !== -1 ? themeIndex : 0;
}

function cycleTheme() {
    State.currentThemeIndex = (State.currentThemeIndex + 1) % themes.length;
    const nextTheme = themes[State.currentThemeIndex];
    setTheme(nextTheme);
}

function resetMetaOnReload() {
  const wasReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  if (wasReload) {
    resetFields();
  }
}

function resetFields() {
  elements.title.textContent = 'Enter Title Here';
  elements.source.value = 'Enter Source Here';
  const today = new Date();
  elements.date.value = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function pasteFromClipboard() {
    try {
        if (!navigator.clipboard || !navigator.clipboard.read) {
            showToast('Clipboard API not supported. Please use Ctrl+V / Cmd+V to paste.');
            return;
        }

        const permission = await navigator.permissions.query({ name: 'clipboard-read' });
        if (permission.state === 'denied') {
            showToast('Clipboard access denied. Please use Ctrl+V to paste.');
            return;
        }

        try { // Nested try for the actual read operation
            const clipboardItems = await navigator.clipboard.read();
            let pastedText = '';

            for (const item of clipboardItems) {
                if (item.types.includes('text/html')) {
                    const blob = await item.getType('text/html');
                    const htmlText = await blob.text();
                    pastedText = convertHtmlToPreserveBreaks(htmlText);
                    break; 
                } else if (item.types.includes('text/plain') && !pastedText) {
                    const blob = await item.getType('text/plain');
                    pastedText = await blob.text();
                }
            }
            
            if (pastedText) {
                const input = elements.input;
                const selStart = input.selectionStart;
                const selEnd = input.selectionEnd;
                const currentText = input.value;
                input.value = currentText.substring(0, selStart) + pastedText + currentText.substring(selEnd);
                input.selectionStart = input.selectionEnd = selStart + pastedText.length;
                handleInput();
            } else {
                showToast('No text found on clipboard.');
            }

        } catch (readErr) {
            console.error('Failed to read clipboard: ', readErr);
            showToast('Could not read clipboard. Please use Ctrl+V / Cmd+V to paste.');
        }
    } catch (permErr) {
        console.error('Clipboard permission error: ', permErr);
        showToast('Could not access clipboard. Please use Ctrl+V / Cmd+V.');
    }

}

/**
 * A hardened DOMPurify configuration that follows the principle of least privilege.
 */
const DOMPURIFY_CONFIG = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'a'],
    ALLOWED_ATTR: {
        'a': ['href', 'title'],
        'code': ['class']
    },
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ALLOW_DATA_ATTR: false
};

function handlePaste(e) {
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    let pastedText = '';

    const html = cd.getData('text/html');
    const plain = cd.getData('text/plain');

    if (html) {
        pastedText = convertHtmlToPreserveBreaks(html);
    } else if (plain) {
        pastedText = plain;
    }

    // Aggressively clean invisible characters and normalize whitespace
    pastedText = pastedText
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/\n{3,}/g, '\n\n'); // Collapse excessive blank lines

    document.execCommand('insertText', false, pastedText.trim());
}

function convertHtmlToPreserveBreaks(htmlString) {
    // FIX: Proactively strip style attributes from the raw HTML string
    // before parsing to prevent CSP violations.
    const cleanedHtml = htmlString.replace(/ style="[^"]*"/g, '');

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedHtml, 'text/html');
    const tempDiv = doc.body; // Use the body of the parsed document

    // Add newlines before block elements to ensure they are on a new line
    tempDiv.querySelectorAll('p, div, li, h1, h2, h3, blockquote').forEach(el => {
        el.insertAdjacentText('beforebegin', '\n'); 
    });
    
    // Replace <br> tags with newlines
    tempDiv.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

    // Use textContent which is more literal than innerText
    let text = tempDiv.textContent || '';
    
    // Clean up excessive newlines, preserving up to two for paragraph breaks
    text = text.replace(/(\n\s*){3,}/g, '\n\n');

    return text.trim();
}

function handleInput(debounce = false) {
    if (State.renderTimeout) {
        clearTimeout(State.renderTimeout);
        State.renderTimeout = null;
    }

    const process = () => {
        const text = elements.input.value;
        elements.count.textContent = `${text.length.toLocaleString()} chars`;
        
        // Parse once, use twice for performance.
        const segments = Parser.parseSegments(text);
        Renderer.renderChat(text, segments);
        updateMetadata(text, segments);
        Storage.scheduleAutoSave();
        State.renderTimeout = null;
    };

    if (debounce) {
        State.renderTimeout = setTimeout(process, CONFIG.RENDER_DEBOUNCE);
    } else {
        process();
    }
}

function updateMetadata(text, segments = null) {
    if (!segments) segments = Parser.parseSegments(text);

    // 1. Detect LLM source only if it's the default or empty
    if (elements.source.value === 'Enter Source Here' || elements.source.value === 'AI Assistant' || !elements.source.value) {
        const aiSegments = segments.filter(s => s.type === 'ai');
        let detectedSource = null;
        if (aiSegments.length > 0) {
            // Find the first AI speaker that isn't just "AI"
            const specificAi = aiSegments.find(s => s.speaker.toLowerCase() !== 'ai' && s.speaker.toLowerCase() !== 'assistant');
            if (specificAi) {
                detectedSource = specificAi.speaker;
            } else if (aiSegments.length > 0) {
                detectedSource = aiSegments[0].speaker; // Fallback to the first one, e.g., "AI"
            }
        }

        if (detectedSource) {
            elements.source.value = detectedSource;
        } else {
            elements.source.value = 'AI Assistant';
        }
    }

    // 2. Detect Topic only if it's the default or empty
    if (elements.title.textContent === 'Enter Title Here' || elements.title.textContent === 'Conversation Log' || !elements.title.textContent) {
        let potentialTitle = "Conversation Log";
        const lines = text.trim().split('\n');

        if (lines.length > 0) {
            const firstSignificantLine = lines.find(l => l.trim().length > 0) || '';
            // A "heading" is a good title candidate.
            if (firstSignificantLine.trim().startsWith('#')) {
                potentialTitle = firstSignificantLine.trim().replace(/^#+\s*/, '').trim();
            } else {
                // Otherwise, find the first bit of user content.
                const userSegments = segments.filter(s => s.type === 'user' && s.content.trim().length > 0);
                if (userSegments.length > 0) {
                    const firstUserContent = userSegments[0].content.trim();
                    // Take the first line of the user's message
                    potentialTitle = firstUserContent.split('\n')[0].trim();
                    // Truncate if it's too long
                    if (potentialTitle.length > 60) {
                        potentialTitle = potentialTitle.substring(0, 57) + "...";
                    }
                }
                // If we still have nothing, don't change from default
                if (potentialTitle.trim() === '...' || potentialTitle.trim() === '') potentialTitle = "Conversation Log";
            }
        }
        elements.title.textContent = potentialTitle;
    }
}

// === PARSER MODULE ===
const Parser = {
parseSegments(text) {
    // This function combines multiple parsing strategies to create a list of chat segments.
    let segments = this.parseByLabels(text);

    const hasKnownLabels = segments.some(s => s.type === 'user' || s.type === 'ai');

    // If label-based parsing is inconclusive, use the classifier as the primary strategy.
    if (segments.length < 2 || !hasKnownLabels) {
        const classifierSegments = this.parseWithClassifier(text);
        if (classifierSegments.length > 1) {
            return classifierSegments.filter(seg => seg.content.trim());
        }
    }
    
    // Fallback to simpler methods if the classifier fails or labels were not present.
    if (segments.length < 2 || !hasKnownLabels) {
        const alternateSegments = this.parseByAlternatingTurns(text);
        if (alternateSegments.length > 1) {
            segments = alternateSegments;
        }
    }
    
    if (segments.length < 2) {
         const heuristicSegments = this.parseByHeuristicSplit(text);
         if (heuristicSegments.length > 1) {
             segments = heuristicSegments;
         }
    }
    
    return segments.filter(seg => seg.content.trim());
},

parseByLabels(text) {
    const lines = text.split('\n');
    const segments = [];
    let currentSegment = { type: 'unknown', speaker: 'Unknown', content: '' };

    // --- Hardened Speaker Detection ---
    const permissiveSpeakerRegex = /^([^:\n]{1,100}):\s+/; // SECURE: Prevents ReDoS
    const keywordSpeakerRegex = new RegExp(`^(\\*\\*|##\\s|)?(\\s*)(${[...CONFIG.USER_KEYWORDS, ...CONFIG.AI_KEYWORDS].join('|')})(\\*\\*|:|\\s+said)?`, 'i');

    lines.forEach(line => {
        let match = line.match(permissiveSpeakerRegex);
        let speakerName, isUser, isAi;

        let originalPrefix = '';
        if (match && match[1]) { 
            speakerName = match[1].trim();
            const lowerSpeaker = speakerName.toLowerCase();
            isUser = userKeywordRegex.test(lowerSpeaker);
            isAi = aiKeywordRegex.test(lowerSpeaker);
            originalPrefix = match[0];

        } else { 
            match = line.match(keywordSpeakerRegex);
            if (match && match[3]) {
                speakerName = match[3];
                const lowerSpeaker = speakerName.toLowerCase();
                isUser = CONFIG.USER_KEYWORDS.includes(lowerSpeaker);
                isAi = true; 
                originalPrefix = match[0];
            }
        }

        if (speakerName) {
            if (currentSegment.content.trim()) {
                segments.push(currentSegment);
            }
            const speakerType = isUser ? 'user' : 'ai';
            let cleanLine = line.replace(match[0], '').trim();

            currentSegment = {
                type: speakerType,
                speaker: speakerName.charAt(0).toUpperCase() + speakerName.slice(1), 
                content: cleanLine + '\n',
                originalPrefix: originalPrefix
            };
        } else {
            currentSegment.content += line + '\n';
        }
    });

    if (currentSegment.content.trim()) {
        segments.push(currentSegment);
    }
    if (segments.length > 0 && !segments[0].originalPrefix) {
        segments[0].originalPrefix = '';
    }

    if (segments.length > 1 && segments[0].type === 'unknown') {
        const firstKnownSegment = segments[1];
        if (firstKnownSegment.type === 'ai') {
            segments[0].type = 'user';
            segments[0].speaker = 'User';
        } else if (firstKnownSegment.type === 'user') {
            segments[0].type = 'ai';
            segments[0].speaker = 'Assistant';
        }
    }
    
    return segments;
},

parseByAlternatingTurns(text) {
    const blocks = text.trim().split(/\n\s*\n+/);
    if (blocks.length < 2) return [];
    const segments = [];
    let isUserTurn = true;
    blocks.forEach(block => {
        const content = block.trim();
        if (content) {
            segments.push({
                type: isUserTurn ? 'user' : 'ai',
                speaker: isUserTurn ? 'User' : 'Assistant',
                content: content
            });
            isUserTurn = !isUserTurn;
        }
    });
    return segments;
},

parseByHeuristicSplit(text) {
    const blocks = text.trim().split(/\n\s*\n+/);
    if (blocks.length < 2) return [];

    return blocks.map((block, i) => ({
        type: i % 2 === 0 ? 'user' : 'ai',
        speaker: i % 2 === 0 ? 'User' : 'Assistant',
        content: block.trim()
    })).filter(seg => seg.content);
},

parseWithClassifier(text) {
    // This strategy uses the advanced SpeakerClassifier for zero-shot detection
    const turns = text.trim().split(/\n\s*\n+/);
    if (turns.length === 0) return [];

    const results = speakerClassifier.classifyConversation(turns);
    
    return results.map((result, index) => {
        let speakerName = 'User';
        if (result.speaker === 'ai') {
            speakerName = 'Assistant';
        } else if (result.speaker === 'uncertain') {
            speakerName = 'Unknown';
        }

        return {
            type: result.speaker, // 'user', 'ai', or 'uncertain'
            speaker: speakerName,
            content: turns[index]
        };
    });
}
}; 

// === RENDERER MODULE ===
const Renderer = {
renderChat(text, segments = null) {
    if (!text.trim()) {
        elements.output.innerHTML = '<p class="preview-placeholder">Preview will appear here...</p>';
        return;
    }

    if (!segments) segments = Parser.parseSegments(text);
    
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
        elements.output.innerHTML = '<p class="error-message">Error: A critical library (Marked or DOMPurify) is not loaded.</p>';
        return;
    }

    if (segments.length <= 1) {
        const safeHTML = DOMPurify.sanitize(marked.parse(text), DOMPURIFY_CONFIG);
        elements.output.innerHTML = `<div class="markdown-body standard-doc">${safeHTML}</div>`;
        return;
    }

    // Virtual DOM approach - only update changed bubbles
    const existingBubbles = elements.output.querySelectorAll('.chat-row');
    let container = elements.output.querySelector('.chat-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'chat-container';
        elements.output.innerHTML = '';
        elements.output.appendChild(container);
    }
    
    segments.forEach((seg, index) => {
        if (!seg.content.trim()) return;
        
        let row = existingBubbles[index];
        const needsUpdate = !row || 
            row.dataset.speaker !== seg.speaker ||
            row.dataset.content !== seg.content;
        
        if (needsUpdate) {
            const rawHtml = marked.parse(seg.content);
            const safeHtml = DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
            const alignClass = seg.type === 'user' ? 'user' : 'ai';
            
            const newRow = document.createElement('div');
            newRow.className = `chat-row ${alignClass}`;
            newRow.dataset.speaker = seg.speaker; 
            newRow.dataset.content = seg.content; 

            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble';
            
            bubble.innerHTML = `
                <div class="speaker-label">${seg.speaker}</div>
                <div class="markdown-body" contenteditable="true">${safeHtml}</div>
            `;
            
            // Add the analyze button
            const analyzeBtnTemplate = document.getElementById('analyze-icon-template');
            if(analyzeBtnTemplate) {
                const analyzeBtnFragment = analyzeBtnTemplate.content.cloneNode(true);
                const analyzeBtn = analyzeBtnFragment.firstElementChild;
                analyzeBtn.addEventListener('click', () => showScoreAnalysis(seg.content));
                bubble.appendChild(analyzeBtn);
            }

            newRow.appendChild(bubble);
            
            const isDarkMode = document.body.classList.contains('dark-mode');
            if (isDarkMode && seg.type !== 'unknown') {
                const speakerClass = getClassForSpeaker(seg.speaker);
                bubble.classList.add(speakerClass);
            }
            if (row) {
                container.replaceChild(newRow, row);
            } else {
                container.appendChild(newRow);
            }
        }
    });
    
    while (container.children.length > segments.filter(s => s.content.trim()).length) {
        container.removeChild(container.lastChild);
    }
}
}; 

function convertBubbleHtmlToText(bubbleNode) {
    if (typeof DOMPurify === 'undefined') return bubbleNode.textContent;
    
    const safeFragment = DOMPurify.sanitize(bubbleNode.innerHTML, { ...DOMPURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });

    safeFragment.querySelectorAll('pre').forEach(pre => {
        const code = pre.querySelector('code');
        const lang = code ? (Array.from(code.classList).find(c => c.startsWith('language-')) || '').replace('language-', '') : '';
        const codeText = pre.textContent;
        pre.replaceWith(document.createTextNode(`\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`));
    });
    
    safeFragment.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    
    safeFragment.querySelectorAll('p, ul, ol, blockquote').forEach(block => {
        if (block.previousSibling) {
            block.before(document.createTextNode('\n'));
        }
    });
    return safeFragment.textContent.trim();
}

function updateSourceFromPreview() {
    if (State.isUpdatingFromPreview) return;
    State.isUpdatingFromPreview = true;

    const segments = Parser.parseSegments(elements.input.value);
    const bubbles = elements.output.querySelectorAll('.markdown-body[contenteditable="true"]');

    if (segments.length !== bubbles.length) {
        showToast("Preview out of sync. Re-rendering from source.");
        State.isUpdatingFromPreview = false;
        handleInput(false); 
        return;
    }

    let updatedText = '';
    segments.forEach((segment, index) => {
        const bubbleNode = bubbles[index];
        const newContent = convertBubbleHtmlToText(bubbleNode);
        updatedText += (segment.originalPrefix || '') + newContent + '\n\n';
    });
    elements.input.value = updatedText.trim();
    Storage.scheduleAutoSave();

    setTimeout(() => { State.isUpdatingFromPreview = false; }, 100);
}

// === STORAGE MODULE ===
const Storage = {
// Storage size limits
MAX_INPUT_SIZE: 5 * 1024 * 1024,    // 5MB
MAX_TITLE_SIZE: 500,                 // 500 chars
MAX_FIELD_SIZE: 200,                 // 200 chars

save() {
    try {
        const storageSize = JSON.stringify(localStorage).length;
        if (storageSize > 10 * 1024 * 1024) { 
            showToast("Storage limit reached. Please clear old data.");
            return;
        }
        
        const data = {
            input: elements.input.value.substring(0, this.MAX_INPUT_SIZE),
            title: elements.title.textContent.substring(0, this.MAX_TITLE_SIZE),
            date: elements.date.value.substring(0, this.MAX_FIELD_SIZE),
            source: elements.source.value.substring(0, this.MAX_FIELD_SIZE),
            timestamp: Date.now()
        };
        localStorage.setItem('chatExporter_save', JSON.stringify(data));
        showToast("Draft saved successfully");
    } catch (e) {
        console.error("Save failed:", e);
        showToast("Failed to save: " + e.message);
    }
},
load() {
    try {
        const autoSaveData = JSON.parse(localStorage.getItem('chatExporter_auto'));
        const manualSaveData = JSON.parse(localStorage.getItem('chatExporter_save'));

        const dataToLoad = (autoSaveData && autoSaveData.timestamp > (manualSaveData?.timestamp || 0))
            ? autoSaveData 
            : manualSaveData;

        if (!dataToLoad) {
            showToast("No saved draft found");
            return;
        }
        
        if (typeof dataToLoad !== 'object' || dataToLoad === null) {
            throw new Error('Invalid data format');
        }
        
        if (typeof dataToLoad.input !== 'string' || 
            typeof dataToLoad.title !== 'string' ||
            typeof dataToLoad.date !== 'string' ||
            typeof dataToLoad.source !== 'string') {
            throw new Error('Invalid data structure');
        }
        
        if (dataToLoad.input.length > this.MAX_INPUT_SIZE) {
            throw new Error('Input data too large');
        }
        if (dataToLoad.title.length > this.MAX_TITLE_SIZE) {
            throw new Error('Title too large');
        }
        if (dataToLoad.date.length > this.MAX_FIELD_SIZE ||
            dataToLoad.source.length > this.MAX_FIELD_SIZE) {
            throw new Error('Field data too large');
        }
        
        const cleanTitle = DOMPurify.sanitize(dataToLoad.title, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: []
        });
        const cleanSource = DOMPurify.sanitize(dataToLoad.source, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: []
        });
        const cleanDate = DOMPurify.sanitize(dataToLoad.date, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: []
        });
        
        elements.input.value = dataToLoad.input;
        elements.title.textContent = cleanTitle || 'Conversation Log';
        elements.date.value = cleanDate || new Date().toLocaleDateString();
        elements.source.value = cleanSource || 'AI Assistant';
        
        handleInput();
        showToast("Draft loaded");
    } catch (e) {
        console.error("Failed to load draft:", e);
        showToast("Failed to load draft: " + e.message);
        localStorage.removeItem('chatExporter_auto');
        localStorage.removeItem('chatExporter_save');
    }
},
scheduleAutoSave() {
    if (State.autoSaveTimeout) {
        clearTimeout(State.autoSaveTimeout);
        State.autoSaveTimeout = null;
    }
    
    State.autoSaveTimeout = setTimeout(() => {
        try {
            const storageSize = JSON.stringify(localStorage).length;
            if (storageSize > 10 * 1024 * 1024) {
                console.warn("Storage quota approaching limit");
                elements.status.textContent = "Storage nearly full";
                return;
            }
            
            const data = {
                input: elements.input.value.substring(0, this.MAX_INPUT_SIZE),
                title: elements.title.textContent.substring(0, this.MAX_TITLE_SIZE),
                date: elements.date.value.substring(0, this.MAX_FIELD_SIZE),
                source: elements.source.value.substring(0, this.MAX_FIELD_SIZE),
                timestamp: Date.now()
            };
            localStorage.setItem('chatExporter_auto', JSON.stringify(data));
            elements.status.textContent = "Auto-saved";
            elements.status.classList.add('saved');
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                elements.status.textContent = "Save failed: Storage full";
                showToast("Storage quota exceeded. Please export or clear data.");
            } else {
                console.error("Auto-save failed:", e);
                elements.status.textContent = "Save failed";
            }
        }
        setTimeout(() => {
            elements.status.textContent = "";
            elements.status.classList.remove('saved');
        }, 3000);
        State.autoSaveTimeout = null;
    }, CONFIG.AUTO_SAVE_DELAY);
}
}; 

function clearText() {
    elements.input.value = '';
    resetFields();
    handleInput();
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function showScoreAnalysis(text) {
    const result = speakerClassifier.classifyTurn(text);
    const heatScore = speakerClassifier.generateHeatScore(result);

    elements.scoreModalContent.innerHTML = ''; // Clear previous content

    heatScore.forEach(item => {
        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'score-item';
        
        const weightClass = item.type === 'summary' ? 'summary' : (item.weight > 0 ? 'positive' : 'negative');

        scoreDiv.innerHTML = `
            <span class="feature-desc">${item.description}</span>
            <span class="feature-weight ${weightClass}">${item.weight > 0 ? '+' : ''}${item.weight}</span>
        `;
        elements.scoreModalContent.appendChild(scoreDiv);
    });

    elements.scoreModalOverlay.classList.add('visible');
}

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', init);
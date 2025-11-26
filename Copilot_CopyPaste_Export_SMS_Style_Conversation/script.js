// Wait until DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    const returnBtn = document.getElementById('returnBtn');
    const convertBtn = document.getElementById('convertBtn');
    const printBtn = document.getElementById('printBtn');

    returnBtn.addEventListener('click', function() {
        document.getElementById('inputSection').classList.remove('hidden');
        document.getElementById('chatSection').classList.add('hidden');
        returnBtn.classList.add('hidden');
    });

    convertBtn.addEventListener('click', function() {
        try {
            const input = document.getElementById('conversationInput').value;
            if (!input || input.trim() === "") {
                alert('Please paste conversation text.');
                return;
            }
            const lines = input.split(/\r?\n/);
            const messages = [];
            let buffer = "";
            let lastSpeaker = null;
            // Regex to find "You said:" or "Copilot said:" at the beginning of a line
            const nameRegex = /^(You said|Copilot said):\s*(.*)$/i;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                const match = line.match(nameRegex);

                if (match) {
                    // Flush the previous speaker's buffer before switching
                    if (lastSpeaker) {
                        messages.push({ speaker: lastSpeaker, text: buffer.trim() });
                    }

                    const currentSpeaker = match[1].trim();
                    const text = match[2];

                    // Normalize speaker names for consistency
                    lastSpeaker = /copilot/i.test(currentSpeaker) ? "Copilot" : "You";
                    buffer = text;
                } else {
                    // This line does not identify a new speaker
                    if (lastSpeaker) {
                        // Append the line to the current speaker's buffer
                        buffer += (buffer ? "\n" : "") + line;
                    } else {
                        // If the conversation starts without a speaker, assume it's the user.
                        lastSpeaker = "You";
                        buffer = line;
                    }
                }
            }
            if (lastSpeaker) messages.push({ speaker: lastSpeaker, text: buffer.trim() });

            if (messages.length === 0) {
                alert('No valid messages found. Check your formatting.');
                return;
            }

            const chatDiv = document.getElementById('chat');
            chatDiv.innerHTML = "";

            messages.forEach(function(msg, idx) {
                const row = document.createElement('div');
                // Treat any speaker with "copilot" in the name (case-insensitive) as Copilot.
                const isCopilot = msg.speaker === "Copilot";
                row.className = "bubble-row " + (isCopilot ? "row-copilot" : "row-user");

                const checkbox = document.createElement('input');
                checkbox.type = "checkbox";
                checkbox.id = "msg" + idx;
                checkbox.className = "msg-checkbox";

                const bubble = document.createElement('div');
                bubble.className = "bubble " + (isCopilot ? "copilot" : "user");

                function escapeHTML(str) {
                    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }
                const safeText = escapeHTML(msg.text).replace(/\n/g, "<br>");
                const safeSpeaker = escapeHTML(msg.speaker);

                if (isCopilot) {
                    bubble.innerHTML = `<div class="speaker">🤖 ${safeSpeaker}</div>${safeText}`;
                } else {
                    bubble.innerHTML = `<div class="speaker">${safeSpeaker}</div>${safeText}`;
                }

                row.appendChild(checkbox);
                row.appendChild(bubble);
                chatDiv.appendChild(row);
            });

            document.getElementById('inputSection').classList.add('hidden');
            document.getElementById('chatSection').classList.remove('hidden');
            returnBtn.classList.remove('hidden');
        } catch (e) {
            console.error('Error in convert:', e);
            alert('An error occurred during conversion.');
        }
    });

    printBtn.addEventListener('click', function() {
        try {
            const chatDiv = document.getElementById('chat');
            const checkboxes = chatDiv.querySelectorAll('.msg-checkbox');
            const bubbles = chatDiv.querySelectorAll('.bubble');
            let html = "<html><head><title>Selected Conversation</title><style>";
            html += ".bubble{padding:12px 18px;border-radius:18px;max-width:80%;margin:10px 0;font-size:1rem;line-height:1.5;}";
            html += ".user{background:#d4edda;} .copilot{background:#fff;border:1px solid #e0e0e0;} .speaker{font-size:0.85em;color:#888;margin-bottom:4px;}";
            html += "</style></head><body>";
            checkboxes.forEach(function(cb, idx) {
                if (cb.checked && bubbles[idx]) {
                    html += bubbles[idx].outerHTML;
                }
            });
            html += "</body></html>";
            const w = window.open("", "", "width=800,height=600");
            if (!w) {
                alert('Please allow pop-ups for printing.');
                return;
            }
            w.document.write(html);
            w.document.close();
            w.print();
        } catch (e) {
            console.error('Error in print:', e);
            alert('An error occurred during printing.');
        }
    });
});

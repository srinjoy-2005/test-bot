/* ═══════════════════════════════════════════════════════════════
   Wellness AI — app.js
   WebSocket client + orb animation + UI state management + sessions
   ═══════════════════════════════════════════════════════════════ */

// ─── Emotion map ─────────────────────────────────────────────────────────────
const EMOTION_ICONS = {
    anxiety: "😟", sadness: "😔", anger: "😤", fear: "😨",
    loneliness: "🌧️", shame: "😶", guilt: "😓", grief: "💔",
    frustration: "😤", hopelessness: "😶‍🌫️", overwhelm: "🌊",
    joy: "✨", relief: "🌤️", unknown: "◈",
};

function getEmotionIcon(emotion) {
    return EMOTION_ICONS[emotion?.toLowerCase()] ?? "◈";
}

function formatTime() {
    return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function generateId() {
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Session Storage Helpers ──────────────────────────────────────────────────
function getUserMap() {
    return JSON.parse(localStorage.getItem("wellness_userMap") || "{}");
}

function saveUserMap(map) {
    localStorage.setItem("wellness_userMap", JSON.stringify(map));
}

// Same name always resolves to the same userId
function getUserIdForName(name) {
    const map = getUserMap();
    if (map[name]) return map[name];
    const newId = generateId();
    map[name] = newId;
    saveUserMap(map);
    return newId;
}

function loadUserSessions(userId) {
    // Try user-scoped key first
    const scoped = localStorage.getItem(`wellness_sessions_${userId}`);
    if (scoped) return JSON.parse(scoped);

    // Migration: if old shared key exists, adopt those sessions for this user
    const old = localStorage.getItem("wellness_sessions");
    if (old) {
        const parsed = JSON.parse(old);
        if (parsed.length > 0) {
            localStorage.setItem(`wellness_sessions_${userId}`, old);
            localStorage.removeItem("wellness_sessions");
            return parsed;
        }
    }
    return [];
}

// ─── State ────────────────────────────────────────────────────────────────────
let ws = null;
let isWaiting = false;
let currentUserName = localStorage.getItem("wellness_userName") || "there";
// Resolve userId from the name map (same name → same userId → same sessions)
let currentUserId = currentUserName !== "there"
    ? getUserIdForName(currentUserName)
    : (localStorage.getItem("wellness_userId") || generateId());
let currentSessionId = null;
let sessions = loadUserSessions(currentUserId);
let orbAnimId = null;
let currentTheme = localStorage.getItem("wellness_theme") || "dark";
let isVoiceOutputEnabled = false;

// ─── Web Speech API Setup ─────────────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        document.getElementById("mic-btn")?.classList.add("recording");
    };

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join('');
        const input = document.getElementById("message-input");
        if (input) {
            input.value = transcript;
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 120) + "px";
        }
    };

    recognition.onend = () => {
        document.getElementById("mic-btn")?.classList.remove("recording");
    };

    recognition.onerror = (e) => {
        console.error("Speech recognition error", e);
        document.getElementById("mic-btn")?.classList.remove("recording");
    };
}

let systemVoices = [];
const voiceSelect = document.getElementById("voice-select");

function populateVoices() {
    if (!window.speechSynthesis) return;
    systemVoices = window.speechSynthesis.getVoices();
    if (!voiceSelect) return;
    
    voiceSelect.innerHTML = "";
    
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default Voice";
    voiceSelect.appendChild(defaultOption);

    systemVoices.forEach(voice => {
        const option = document.createElement("option");
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})`;
        voiceSelect.appendChild(option);
    });

    const savedVoice = localStorage.getItem("wellness_voice");
    if (savedVoice) {
        voiceSelect.value = savedVoice;
    }
}

if (window.speechSynthesis) {
    populateVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoices;
    }
}

voiceSelect?.addEventListener("change", (e) => {
    localStorage.setItem("wellness_voice", e.target.value);
});

function speakText(text, force = false) {
    if (!force && (!isVoiceOutputEnabled || !window.speechSynthesis)) return;
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    // Strip thought blocks
    const contentToSpeak = text.replace(/<thought>[\s\S]*?<\/thought>/i, '');

    // Clean text: remove markdown tags, URLs, etc.
    const cleanText = contentToSpeak.replace(/[#*`_]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.5;

    const savedVoice = localStorage.getItem("wellness_voice");
    if (savedVoice && systemVoices.length > 0) {
        const selectedVoice = systemVoices.find(v => v.name === savedVoice);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
    }

    window.speechSynthesis.speak(utterance);
}

// Persist
localStorage.setItem("wellness_userId", currentUserId);
document.getElementById("name-input").value = localStorage.getItem("wellness_userName") || "";

// Initialize theme on page load
function initTheme() {
    if (currentTheme === "light") {
        document.documentElement.classList.add("light-mode");
    } else {
        document.documentElement.classList.remove("light-mode");
    }
}

function toggleTheme() {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem("wellness_theme", currentTheme);
    initTheme();
}

// Initialize theme on load
initTheme();

// ─── Sessions ─────────────────────────────────────────────────────────────────
function saveSessions() {
    localStorage.setItem(`wellness_sessions_${currentUserId}`, JSON.stringify(sessions));
}

function createNewSession() {
    currentSessionId = generateId();
    sessions.unshift({
        id: currentSessionId,
        userId: currentUserId,
        title: "New Chat",
        updatedAt: Date.now(),
        messages: []
    });
    saveSessions();
    loadSession(currentSessionId);
}

function loadSession(id) {
    currentSessionId = id;
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    // Clear chat
    const messagesEl = document.getElementById("messages");
    messagesEl.innerHTML = "";
    document.querySelector(".empty-state")?.remove();

    if (session.messages.length === 0) {
        messagesEl.innerHTML = `<div class="empty-state">Hi ${currentUserName}! Start whenever you're ready.</div>`;
    } else {
        session.messages.forEach(msg => {
            appendMessageDOM(msg.role, msg.content, msg.isCrisis, msg.time || formatTime());
        });
        scrollToBottom();
    }

    renderSessionList();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "init",
            userId: currentUserId,
            userName: currentUserName,
            sessionId: currentSessionId
        }));
    }

    // Reset emotion view
    document.getElementById("emotion-display").innerHTML = `
        <div class="emotion-bar-row">
            <div class="emotion-bar-top">
                <div class="emotion-bar-label">◈ Listening...</div>
                <div class="emotion-bar-pct">100%</div>
            </div>
            <div class="emotion-bar-container"><div class="emotion-bar-fill" style="width: 100%; opacity: 0.2;"></div></div>
        </div>`;

    // Clear the chart grid too
    const chart = document.getElementById("emotion-chart");
    if (chart) chart.innerHTML = "";

    document.getElementById("cognitive-load-status").textContent = "OPTIMAL STATUS";
    document.getElementById("cognitive-load-status").style.color = "var(--live-green)";
}

function saveMessage(role, content, isCrisis = false) {
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session) return;

    const time = formatTime();
    session.messages.push({ role, content, isCrisis, time });
    session.updatedAt = Date.now();

    if (session.title === "New Chat" && role === "user") {
        session.title = content.slice(0, 26) + (content.length > 26 ? "..." : "");
    }

    sessions = [session, ...sessions.filter(s => s.id !== currentSessionId)];
    saveSessions();
    renderSessionList();
    return time;
}

function renderSessionList() {
    const list = document.getElementById("session-list");
    if (!list) return;
    list.innerHTML = "";
    sessions.forEach(s => {
        const div = document.createElement("div");
        div.className = `session-item ${s.id === currentSessionId ? "active" : ""}`;
        div.textContent = s.title;
        div.onclick = () => loadSession(s.id);
        list.appendChild(div);
    });
}

document.getElementById("new-chat-btn")?.addEventListener("click", createNewSession);

// ─── WebSocket ───────────────────────────────────────────────────────────────
function connectWS() {
    if (ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/chat`);

    ws.onopen = () => {
        setLiveDot(true);
        ws.send(JSON.stringify({
            type: "init",
            userId: currentUserId,
            userName: currentUserName,
            sessionId: currentSessionId
        }));
    };

    ws.onmessage = (event) => {
        try { handleServerMessage(JSON.parse(event.data)); }
        catch (e) { console.error("[WS] Bad JSON", e); }
    };

    ws.onclose = () => {
        setLiveDot(false);
        ws = null;
        setTimeout(connectWS, 3000);
    };

    ws.onerror = (e) => console.error("[WS] Error", e);
}

function handleServerMessage(data) {
    switch (data.type) {
        case "ready":
            setLiveDot(true);
            break;
        case "status":
            if (data.message === "thinking") showTypingIndicator();
            break;
        case "response":
            removeTypingIndicator();
            appendMessage("ai", data.message, data.isCrisis);
            speakText(data.message);
            updateEmotion(data.emotion);
            if (data.isCrisis) document.getElementById("crisis-banner").classList.remove("hidden");
            setWaiting(false);
            break;
        case "error":
            removeTypingIndicator();
            appendMessage("ai", "Something went wrong — please try again.");
            setWaiting(false);
            break;
    }
}

// ─── Live Dot & Cognitive Load ────────────────────────────────────────────────
function setLiveDot(online) {
    const dot = document.getElementById("live-dot");
    const text = document.getElementById("live-text");
    const load = document.getElementById("cognitive-load-status");
    if (!dot || !text || !load) return;

    if (online) {
        dot.classList.add("online");
        text.classList.add("online");
        text.textContent = "LIVE";
        // FIX 8: reset cognitive load whenever connection comes back online,
        // not only when text is exactly "RECONNECTING" or "INITIALISING"
        if (load.textContent !== "ELEVATED LOAD" && load.textContent !== "MODERATE LOAD") {
            load.textContent = "OPTIMAL STATUS";
            load.style.color = "var(--live-green)";
        }
    } else {
        dot.classList.remove("online");
        text.classList.remove("online");
        text.textContent = "OFFLINE";
        load.textContent = "RECONNECTING";
        load.style.color = "var(--offline-red, #f87171)";
    }
}

// ─── Emotion Sidebar ──────────────────────────────────────────────────────────
// ─── Emotion Chart Update ─────────────────────────────────────────────────────
function updateEmotionChart(emotionProfile) {
    if (!emotionProfile || !emotionProfile.emotions) return;

    // FIX 2: #emotion-chart now exists in HTML; this will find it correctly
    const chart = document.getElementById("emotion-chart");
    if (!chart) return;

    const sorted = [...emotionProfile.emotions]
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 6); // Show top 6 emotions

    chart.innerHTML = "";
    sorted.forEach((emotion) => {
        const item = document.createElement("div");
        item.className = "emotion-chart-item";

        const icon = document.createElement("div");
        icon.className = "emotion-chart-icon";
        icon.textContent = getEmotionIcon(emotion.label);

        const label = document.createElement("div");
        label.className = "emotion-chart-label";
        label.textContent = emotion.label.charAt(0).toUpperCase() + emotion.label.slice(1);

        const bar = document.createElement("div");
        bar.className = "emotion-chart-bar";
        const fill = document.createElement("div");
        fill.className = "emotion-chart-fill";
        fill.style.width = Math.min(100, Math.max(0, emotion.percentage)) + "%";
        bar.appendChild(fill);

        const pct = document.createElement("div");
        pct.className = "emotion-chart-pct";
        pct.textContent = emotion.percentage + "%";

        item.appendChild(icon);
        item.appendChild(label);
        item.appendChild(bar);
        item.appendChild(pct);
        chart.appendChild(item);
    });
}

function updateEmotion(emotionProfile) {
    if (!emotionProfile || !emotionProfile.emotions) return;

    // Update emotion chart
    updateEmotionChart(emotionProfile);

    const display = document.getElementById("emotion-display");
    if (!display) return;

    display.innerHTML = "";
    const sorted = [...emotionProfile.emotions].sort((a, b) => b.percentage - a.percentage);
    let maxIntensity = 0;

    sorted.forEach((e) => {
        const row = document.createElement("div");
        row.className = "emotion-bar-row";

        const labelDiv = document.createElement("div");
        labelDiv.className = "emotion-bar-label";
        const icon = getEmotionIcon(e.label);
        labelDiv.textContent = `${icon} ${e.label.charAt(0).toUpperCase() + e.label.slice(1)}`;

        const pctDiv = document.createElement("div");
        pctDiv.className = "emotion-bar-pct";
        pctDiv.textContent = `${e.percentage}%`;

        const barContainer = document.createElement("div");
        barContainer.className = "emotion-bar-container";
        const barFill = document.createElement("div");
        barFill.className = "emotion-bar-fill";
        barFill.style.width = `${Math.min(100, Math.max(0, e.percentage))}%`;

        barContainer.appendChild(barFill);

        const topRow = document.createElement("div");
        topRow.className = "emotion-bar-top";
        topRow.appendChild(labelDiv);
        topRow.appendChild(pctDiv);

        row.appendChild(topRow);
        row.appendChild(barContainer);
        display.appendChild(row);

        if (e.percentage > maxIntensity) maxIntensity = e.percentage;
    });

    const load = document.getElementById("cognitive-load-status");
    if (!load) return;

    if (maxIntensity > 75) {
        load.textContent = "ELEVATED LOAD";
        load.style.color = "var(--crisis-red, #ff4f6b)";
    } else if (maxIntensity > 45) {
        load.textContent = "MODERATE LOAD";
        load.style.color = "#facc15";
    } else {
        load.textContent = "OPTIMAL STATUS";
        load.style.color = "var(--live-green)";
    }
}

// ─── Orb Canvas Animation ─────────────────────────────────────────────────────
// FIX 1: #orb-canvas now exists in the HTML sidebar, so initOrb() will find it
(function initOrb() {
    const canvas = document.getElementById("orb-canvas");
    if (!canvas) return; // graceful guard retained

    const DPR = window.devicePixelRatio || 1;
    // FIX 1b: read the CSS display size at runtime rather than hardcoding 130
    const SIZE = 110;
    canvas.width = SIZE * DPR;
    canvas.height = SIZE * DPR;
    canvas.style.width = SIZE + "px";
    canvas.style.height = SIZE + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    let t = 0;

    function blobPoint(angle, base, amp, freq, phase) {
        const r = base + amp * Math.sin(freq * angle + phase);
        return {
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
        };
    }

    function drawOrb() {
        ctx.clearRect(0, 0, SIZE, SIZE);

        const POINTS = 8;
        const angleStep = (Math.PI * 2) / POINTS;
        const phase1 = t * 0.7;

        ctx.beginPath();
        for (let i = 0; i <= POINTS; i++) {
            const angle = i * angleStep;
            const p = blobPoint(angle, 38, 10, 3, phase1 + Math.sin(t * 0.4 + i));
            if (i === 0) ctx.moveTo(p.x, p.y);
            else {
                const prev = blobPoint((i - 1) * angleStep, 38, 10, 3, phase1 + Math.sin(t * 0.4 + i - 1));
                const midX = (prev.x + p.x) / 2;
                const midY = (prev.y + p.y) / 2;
                ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
            }
        }
        ctx.closePath();

        const grad = ctx.createRadialGradient(cx - 8, cy - 8, 3, cx, cy, 45);
        grad.addColorStop(0.0, "#e879f9");
        grad.addColorStop(0.4, "#a855f7");
        grad.addColorStop(0.75, "#7c3aed");
        grad.addColorStop(1.0, "#4c1d95");
        ctx.fillStyle = grad;

        ctx.shadowColor = "rgba(168,85,247,0.55)";
        ctx.shadowBlur = 22;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(cx - 12, cy - 12, 13, 0, Math.PI * 2);
        const hl = ctx.createRadialGradient(cx - 12, cy - 12, 2, cx - 12, cy - 12, 13);
        hl.addColorStop(0, "rgba(255,255,255,0.18)");
        hl.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = hl;
        ctx.fill();

        t += 0.012;
        orbAnimId = requestAnimationFrame(drawOrb);
    }

    drawOrb();
})();

// ─── Message helpers ──────────────────────────────────────────────────────────
function appendMessage(role, content, isCrisis = false) {
    const time = saveMessage(role, content, isCrisis);
    appendMessageDOM(role, content, isCrisis, time);
}

function appendMessageDOM(role, content, isCrisis = false, time) {
    document.querySelector(".empty-state")?.remove();

    const messages = document.getElementById("messages");
    if (!messages) return;

    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user-row" : "ai-row"}${isCrisis ? " crisis" : ""}`;

    const avatarEl = document.createElement("div");
    avatarEl.className = `avatar ${role === "user" ? "user-avatar" : "ai-avatar"}`;
    avatarEl.textContent = role === "user"
        ? (currentUserName.charAt(0).toUpperCase() || "U")
        : "AI";

    const body = document.createElement("div");
    body.className = "message-body";

    const senderName = document.createElement("div");
    senderName.className = "sender-name";
    senderName.textContent = role === "user" ? currentUserName : "Wellness AI";

    let displayContent = content;
    let thoughtContent = null;

    if (role === "ai" || role === "assistant") {
        const thoughtMatch = content.match(/<thought>([\s\S]*?)<\/thought>/i);
        if (thoughtMatch) {
            thoughtContent = thoughtMatch[1].trim();
            displayContent = content.replace(/<thought>[\s\S]*?<\/thought>/i, '').trim();
        }
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (thoughtContent) {
        const details = document.createElement("details");
        details.className = "ai-thought-box";
        const summary = document.createElement("summary");
        summary.textContent = "AI Reasoning (Dev Mode)";
        const thoughtText = document.createElement("div");
        thoughtText.className = "ai-thought-content";
        thoughtText.textContent = thoughtContent;
        details.appendChild(summary);
        details.appendChild(thoughtText);
        bubble.appendChild(details);
    }

    // Safely parse basic markdown (bold, italics, newlines)
    let formattedHtml = displayContent
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // escape HTML
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br/>');

    const textSpan = document.createElement("span");
    textSpan.innerHTML = formattedHtml;
    bubble.appendChild(textSpan);

    const msgFooter = document.createElement("div");
    msgFooter.className = "msg-footer";

    const timEl = document.createElement("div");
    timEl.className = "msg-time";
    timEl.textContent = time;

    const speakBtn = document.createElement("button");
    speakBtn.className = "read-aloud-btn";
    speakBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Read Aloud`;
    speakBtn.title = "Read aloud";
    speakBtn.onclick = () => speakText(displayContent, true);

    msgFooter.appendChild(timEl);
    msgFooter.appendChild(speakBtn);

    body.appendChild(senderName);
    body.appendChild(bubble);
    body.appendChild(msgFooter);
    row.appendChild(avatarEl);
    row.appendChild(body);
    messages.appendChild(row);
    scrollToBottom();
}

function showTypingIndicator() {
    removeTypingIndicator();
    const messages = document.getElementById("messages");
    if (!messages) return;
    const row = document.createElement("div");
    row.className = "message-row ai-row";
    row.id = "typing-wrapper";

    const avatar = document.createElement("div");
    avatar.className = "avatar ai-avatar";
    avatar.textContent = "AI";

    const body = document.createElement("div");
    body.className = "message-body";

    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;

    body.appendChild(indicator);
    row.appendChild(avatar);
    row.appendChild(body);
    messages.appendChild(row);
    scrollToBottom();
}

function removeTypingIndicator() {
    document.getElementById("typing-wrapper")?.remove();
}

function scrollToBottom() {
    const area = document.getElementById("chat-area");
    if (area) area.scrollTop = area.scrollHeight;
}

function setWaiting(val) {
    isWaiting = val;
    const sendBtn = document.getElementById("send-btn");
    const input = document.getElementById("message-input");
    if (sendBtn) sendBtn.disabled = val;
    if (input) input.disabled = val;
}

// ─── Send ─────────────────────────────────────────────────────────────────────
function sendMessage() {
    const input = document.getElementById("message-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text || isWaiting || !ws || ws.readyState !== WebSocket.OPEN) return;

    appendMessage("user", text);
    input.value = "";
    input.style.height = "auto";
    setWaiting(true);
    ws.send(JSON.stringify({ type: "chat", message: text, sessionId: currentSessionId }));
}

// ─── Setup Form ───────────────────────────────────────────────────────────────
document.getElementById("start-btn")?.addEventListener("click", () => {
    const name = document.getElementById("name-input").value.trim() || "there";

    // Resolve userId from name map — same name always gets the same identity
    currentUserId = getUserIdForName(name);
    localStorage.setItem("wellness_userId", currentUserId);
    sessions = loadUserSessions(currentUserId);

    currentUserName = name;
    localStorage.setItem("wellness_userName", name);

    document.getElementById("setup-modal").style.display = "none";
    document.getElementById("app").classList.remove("hidden");

    renderSessionList();
    if (sessions.length > 0) {
        loadSession(sessions[0].id);
    } else {
        createNewSession();
    }

    connectWS();
});

// Enter to send; Shift+Enter for newline
document.getElementById("message-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-resize textarea
document.getElementById("message-input")?.addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
});

// Enter in name input
document.getElementById("name-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("start-btn").click();
});

document.getElementById("send-btn")?.addEventListener("click", sendMessage);

// Voice and Mic handlers
document.getElementById("voice-toggle")?.addEventListener("click", () => {
    isVoiceOutputEnabled = !isVoiceOutputEnabled;
    const btn = document.getElementById("voice-toggle");
    const iconOn = btn.querySelector(".voice-icon");
    const iconOff = btn.querySelector(".voice-icon-off");
    if (isVoiceOutputEnabled) {
        iconOn.classList.remove("hidden");
        iconOff.classList.add("hidden");
        btn.style.color = "var(--accent)";
        btn.style.borderColor = "var(--accent)";
    } else {
        iconOn.classList.add("hidden");
        iconOff.classList.remove("hidden");
        btn.style.color = "";
        btn.style.borderColor = "";
        window.speechSynthesis?.cancel();
    }
});

document.getElementById("mic-btn")?.addEventListener("click", () => {
    if (!recognition) {
        alert("Speech recognition is not supported in this browser.");
        return;
    }
    const btn = document.getElementById("mic-btn");
    if (btn.classList.contains("recording")) {
        recognition.stop();
    } else {
        recognition.start();
    }
});

// Theme toggle
document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
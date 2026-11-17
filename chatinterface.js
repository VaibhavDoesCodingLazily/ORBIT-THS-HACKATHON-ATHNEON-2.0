// Use the local server when testing on your computer,
// and the Render server when the site is online.
const API = window.ORBIT_API_BASE;

const LOGIN_PAGE = "login.html";
const TOKEN_KEY = "orbitToken";
const USERNAME_KEY = "username";

const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const messages = document.getElementById("chat-messages");
const sendButton = document.getElementById("send-button");

const newChatButton = document.querySelector(".but1");
const listContainer = document.getElementById("conversation-container");
const speechCheckbox = document.getElementById("abcdefg");

const voiceSelect = document.getElementById("voice-select");
const rateRange = document.getElementById("rate-range");
const rateValue = document.getElementById("rate-value");
const voiceTestButton = document.getElementById("voice-test");

const attachButton = document.getElementById("attach-button");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const previewImg = document.getElementById("preview-img");
const previewName = document.getElementById("preview-name");
const removeImageButton = document.getElementById("remove-image");

const userNameLabel = document.getElementById("user-name");
const logoutButton = document.getElementById("logout-button");

let currentConversationId = null;
let isSending = false;
let isSpeaking = false;
let contextMenu = null;

// "thinking" or "searching" - what ORBIT is doing while it works.
let workStatus = "thinking";

// The image waiting to be sent: { dataUrl, name } or null.
let pendingImage = null;

const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGE_SIDE = 1600; // pixels
const DEFAULT_IMAGE_PROMPT = "Please describe and analyze this image.";

// --------------------------------------------------
// LOGIN
// Every request carries your login token, so the server
// only ever shows you your own chats.
// --------------------------------------------------

function getToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch (error) {
        return null;
    }
}

function getStoredUsername() {
    try {
        return localStorage.getItem(USERNAME_KEY) || "";
    } catch (error) {
        return "";
    }
}

function clearLogin() {
    try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USERNAME_KEY);
    } catch (error) {
        // Ignore.
    }
}

function redirectToLogin(force) {
clearLogin();

    window.location.href = LOGIN_PAGE;
}

// Like fetch(), but adds your token and sends you back to the
// login page if the server says you are not logged in.
async function authFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers, {
        Authorization: "Bearer " + getToken()
    });

    const response = await fetch(
        url,
        Object.assign({}, options, { headers: headers })
    );

    if (response.status === 401) {
        redirectToLogin();

        throw new Error("Please log in again.");
    }

    return response;
}

// Not logged in? Go to the login page right away.
if (!getToken()) {
    redirectToLogin();
}

userNameLabel.textContent = getStoredUsername();

logoutButton.addEventListener("click", async () => {
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    try {
        await fetch(`${API}/logout`, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + getToken()
            }
        });
    } catch (error) {
        // Even if the server can't be reached, log out here.
    }

    redirectToLogin(true);
});

// --------------------------------------------------
// INPUT POSITION
// Empty chat: the input box sits in the middle of the page.
// Once any message exists: it moves to the bottom.
// The CSS does the moving; this just toggles a class on <body>.
// --------------------------------------------------

function updateLayout() {
    document.body.classList.toggle(
        "has-messages",
        messages.children.length > 0
    );
}

// Runs whenever messages are added or removed (new chat,
// opening an old chat, deleting a chat, sending, errors...).
new MutationObserver(updateLayout).observe(messages, {
    childList: true
});

updateLayout();

// --------------------------------------------------
// LOAD MARKDOWN, HTML SANITIZER AND KATEX
// (versions are pinned so a CDN update can't break the app)
// --------------------------------------------------

const MARKED_JS = "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js";
const PURIFY_JS = "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js";
const KATEX_JS = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
const KATEX_AUTO_JS = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js";
const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");

        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
            reject(new Error("Could not load script: " + src));
        };

        document.head.appendChild(script);
    });
}

function loadStylesheet(href) {
    const link = document.createElement("link");

    link.rel = "stylesheet";
    link.href = href;

    // Not fatal: math just looks unstyled if this fails.
    link.onerror = () => {
        console.error("Could not load stylesheet:", href);
    };

    document.head.appendChild(link);
}

const librariesReady = (async () => {
    loadStylesheet(KATEX_CSS);

    await Promise.all([
        loadScript(MARKED_JS),
        loadScript(PURIFY_JS),
        loadScript(KATEX_JS)
    ]);

    // auto-render needs KaTeX to be loaded first.
    await loadScript(KATEX_AUTO_JS);

    if (
        !window.marked ||
        !window.DOMPurify ||
        !window.renderMathInElement
    ) {
        throw new Error("A formatting library failed to initialize.");
    }

    window.marked.setOptions({
        gfm: true,
        breaks: true
    });
})();

librariesReady.catch(error => {
    console.error("Formatting libraries failed to load:", error);
});

// --------------------------------------------------
// INTERACTION LOCK
// While ORBIT is thinking or searching, the input and button
// are locked. While ORBIT is speaking, the input is locked and
// the button becomes a STOP button.
// --------------------------------------------------

const SEND_ARROW =
    '<svg class="send-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>';

function setSendLabel(mode, text) {
    if (mode === "arrow") {
        if (sendButton.dataset.mode !== "arrow") {
            sendButton.innerHTML = SEND_ARROW;
            sendButton.dataset.mode = "arrow";
        }
    } else {
        sendButton.textContent = text;
        sendButton.dataset.mode = "text";
    }
}

function updateInterface() {
    const locked = isSending || isSpeaking;

    input.disabled = locked;
    attachButton.disabled = locked;
    sendButton.disabled = isSending;

    if (isSending) {
        setSendLabel("text", workStatus === "searching" ? "SEARCHING..." : "THINKING...");
    } else if (isSpeaking) {
        setSendLabel("text", "STOP");
    } else {
        setSendLabel("arrow");
    }
}

// Text shown inside the loading bubble for each status.
function statusLabel(status) {
    return status === "searching"
        ? "Searching the web..."
        : "Thinking...";
}

// Updates the button and the loading bubble to match the status.
function setWorkStatus(status, loadingMessage) {
    workStatus = status === "searching" ? "searching" : "thinking";

    updateInterface();

    if (loadingMessage) {
        const content = loadingMessage.querySelector(".message-content");

        if (content) {
            content.textContent = statusLabel(workStatus);
        }

        loadingMessage.classList.toggle(
            "searching",
            workStatus === "searching"
        );
    }
}

// --------------------------------------------------
// IMAGE ATTACHMENTS
// Pick, paste or drag an image. It is shrunk in the browser
// and sent to the backend as a data URL along with your message.
// --------------------------------------------------

function loadImageElement(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => resolve(image);
        image.onerror = () => {
            reject(
                new Error(
                    "Could not read this image. Try a PNG, JPG, WEBP or GIF file."
                )
            );
        };

        image.src = url;
    });
}

// Returns a JPEG data URL, scaled down so the longest side
// is at most MAX_IMAGE_SIDE pixels.
async function prepareImage(file) {
    if (!file.type.startsWith("image/")) {
        throw new Error(
            "Please choose an image file (PNG, JPG, WEBP or GIF)."
        );
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
        throw new Error("That image is too large. The limit is 20 MB.");
    }

    const objectUrl = URL.createObjectURL(file);

    try {
        const image = await loadImageElement(objectUrl);

        const scale = Math.min(
            1,
            MAX_IMAGE_SIDE /
                Math.max(image.naturalWidth, image.naturalHeight)
        );

        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));

        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        // White background so transparent PNGs don't turn black.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        return canvas.toDataURL("image/jpeg", 0.85);

    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function setPendingImage(image) {
    pendingImage = image;

    if (image) {
        previewImg.src = image.dataUrl;
        previewName.textContent = image.name;
        imagePreview.hidden = false;
    } else {
        previewImg.removeAttribute("src");
        previewName.textContent = "";
        imagePreview.hidden = true;
    }
}

async function handleImageFile(file) {
    if (!file || isSending || isSpeaking) {
        return;
    }

    try {
        const dataUrl = await prepareImage(file);

        setPendingImage({
            dataUrl: dataUrl,
            name: file.name || "Pasted image"
        });

        input.focus();

    } catch (error) {
        console.error(error);

        alert(error.message);
    }
}

attachButton.addEventListener("click", () => {
    imageInput.click();
});

imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];

    // Reset so choosing the same file again still triggers "change".
    imageInput.value = "";

    handleImageFile(file);
});

removeImageButton.addEventListener("click", () => {
    setPendingImage(null);
    input.focus();
});

// Paste an image straight into the message box (Ctrl+V).
input.addEventListener("paste", event => {
    const items = event.clipboardData ? event.clipboardData.items : [];

    for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
            event.preventDefault();

            handleImageFile(item.getAsFile());

            return;
        }
    }
});

// Drag an image anywhere onto the page.
document.addEventListener("dragover", event => {
    if (
        event.dataTransfer &&
        Array.from(event.dataTransfer.types).includes("Files")
    ) {
        event.preventDefault();

        document.body.classList.add("dragging");
    }
});

document.addEventListener("dragleave", event => {
    if (!event.relatedTarget) {
        document.body.classList.remove("dragging");
    }
});

document.addEventListener("drop", event => {
    document.body.classList.remove("dragging");

    if (!event.dataTransfer || event.dataTransfer.files.length === 0) {
        return;
    }

    event.preventDefault();

    handleImageFile(event.dataTransfer.files[0]);
});

// --------------------------------------------------
// SAVED SETTINGS
// localStorage can throw in some browsers or privacy modes.
// --------------------------------------------------

function loadSetting(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function saveSetting(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {
        // Ignore: the setting just won't persist.
    }
}

// --------------------------------------------------
// TEXT TO SPEECH
// --------------------------------------------------

let speakMode = loadSetting("orbitSpeakMode") === "true";

let selectedVoiceURI = loadSetting("orbitVoice") || "";

let speechRate = parseFloat(loadSetting("orbitRate"));

if (!(speechRate >= 0.5 && speechRate <= 1.5)) {
    speechRate = 1;
}

let availableVoices = [];

// Identifies the current speech run, so a stopped run
// can't keep going or interfere with a new one.
let speechToken = 0;
let finishCurrentSpeech = null;

function stopSpeaking() {
    speechToken++;

    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }

    if (finishCurrentSpeech) {
        finishCurrentSpeech();
    }
}

if (speechCheckbox) {
    speechCheckbox.checked = speakMode;

    speechCheckbox.addEventListener("change", function () {
        speakMode = speechCheckbox.checked;

        saveSetting("orbitSpeakMode", speakMode);

        if (!speakMode) {
            stopSpeaking();
        }
    });
}

// --------------------------------------------------
// VOICE SETTINGS (voice model + speed)
// Only the voices in this list are shown, in this order.
// To add or remove a voice, edit the list.
// --------------------------------------------------

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";

const VOICE_PROFILES = [
    { name: "Aria",  tag: "Warm and friendly \u00b7 UK English",     lang: "en-GB", pitch: 1.05, rate: 1.0, color: "#65e6a0",
      prefer: [/Google UK English Female/i, /Libby|Sonia|Hazel|Serena|Susan/i] },
    { name: "Atlas", tag: "Calm and steady \u00b7 UK English",       lang: "en-GB", pitch: 0.95, rate: 0.98, color: "#7da9ff",
      prefer: [/Google UK English Male/i, /Ryan|George|Daniel|Arthur/i] },
    { name: "Nova",  tag: "Bright and clear \u00b7 US English",      lang: "en-US", pitch: 1.1,  rate: 1.02, color: "#c28cff",
      prefer: [/Google US English/i, /Aria|Jenny|Samantha|Zira/i] },
    { name: "Asha",  tag: "Soft and gentle \u00b7 Indian English",   lang: "en-IN", pitch: 1.0,  rate: 0.97, color: "#ffb86b",
      prefer: [/Neerja|Heera|Veena|India/i] },
    { name: "Sage",  tag: "Deep and smooth \u00b7 US English",       lang: "en-US", pitch: 0.8,  rate: 0.96, color: "#67d9e8",
      prefer: [/Guy|David|Mark|Alex|Fred/i] }
];

let voiceIndex = parseInt(loadSetting("orbitVoiceProfile"), 10);

if (!(voiceIndex >= 0 && voiceIndex < VOICE_PROFILES.length)) {
    voiceIndex = 0;
}

function pickVoice(profile) {
    for (const pattern of profile.prefer) {
        const found = availableVoices.find(
            voice => pattern.test(voice.name) && voice.lang.toLowerCase().startsWith("en")
        );

        if (found) return found;
    }

    const lang = profile.lang.toLowerCase();

    return (
        availableVoices.find(voice => voice.lang.toLowerCase().replace("_", "-") === lang) ||
        availableVoices.find(voice => voice.lang.toLowerCase().startsWith("en")) ||
        null
    );
}

function getSelectedVoice() {
    return pickVoice(VOICE_PROFILES[voiceIndex]);
}

// Applies the chosen voice and speed to an utterance.
function applyVoice(utterance, profile) {
    profile = profile || VOICE_PROFILES[voiceIndex];

    const voice = pickVoice(profile);

    if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
    } else {
        utterance.lang = profile.lang;
    }

    utterance.rate = Math.min(2, speechRate * profile.rate);
    utterance.pitch = profile.pitch;
    utterance.volume = 1;
}

function updateVoiceLabel() {
    const label = document.getElementById("voice-current");

    if (label) label.textContent = VOICE_PROFILES[voiceIndex].name;
}

function populateVoices() {
    if (!("speechSynthesis" in window)) return;

    availableVoices = window.speechSynthesis.getVoices();

    updateVoiceLabel();
}

function updateRateLabel() {
    if (rateValue) {
        rateValue.textContent = speechRate.toFixed(1) + "x";
    }
}

function previewVoice(profile) {
    if (!("speechSynthesis" in window)) {
        return;
    }

    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(SAMPLE_TEXT);

    applyVoice(utterance, profile);

    // Small delay: some browsers drop speech started right after cancel().
    setTimeout(() => {
        window.speechSynthesis.speak(utterance);
    }, 60);
}

if ("speechSynthesis" in window) {
    // Voices often load a moment after the page does.
    window.speechSynthesis.addEventListener(
        "voiceschanged",
        populateVoices
    );

    populateVoices();
}

if (rateRange) {
    rateRange.value = String(speechRate);

    rateRange.addEventListener("input", function () {
        speechRate = parseFloat(rateRange.value);

        saveSetting("orbitRate", speechRate);
        updateRateLabel();
    });
}

updateRateLabel();

// Remove Markdown and LaTeX symbols before reading aloud.
function cleanForSpeech(text) {
    return text
        // Don't read the "Videos" and "Sources" link lists out loud.
        .split("\n\n**Images**\n")[0]
        .split("\n\n**Videos**\n")[0]
        .split("\n\n**Sources**\n")[0]
        .replace(/```[\s\S]*?```/g, " Code block omitted. ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Don't read raw web addresses out loud.
        .replace(/https?:\/\/\S+/g, "")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
        .replace(/\$([^$\n]+)\$/g, "$1")
        .replace(/\\([#$%&_{}])/g, "$1")
        .replace(/\\([.,;:!?])/g, "$1")
        .replace(/\\text\{([^}]*)\}/g, "$1")
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1 divided by $2")
        .replace(/\\times/g, " times ")
        .replace(/\\div/g, " divided by ")
        .replace(/\\cdot/g, " times ")
        .replace(/\\sqrt\{([^}]*)\}/g, " square root of $1")
        .replace(/\\pi/g, " pi ")
        .replace(/\\checkmark/g, " correct ")
        .replace(/\\quad/g, " ")
        .replace(/\\,/g, " ")
        .replace(/\\\[/g, " ")
        .replace(/\\\]/g, " ")
        .replace(/\\\(/g, " ")
        .replace(/\\\)/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function breakLongText(sentence, maxLength) {
    const pieces = [];
    let piece = "";

    sentence.split(" ").forEach(word => {
        if (piece && (piece + " " + word).length > maxLength) {
            pieces.push(piece);
            piece = word;
        } else {
            piece = piece ? piece + " " + word : word;
        }
    });

    if (piece) {
        pieces.push(piece);
    }

    return pieces;
}

// Browsers (especially Chrome) can cut off or hang on long
// utterances, so the reply is spoken in short chunks.
function splitIntoChunks(text, maxLength = 200) {
    const sentences = text
        .split(/(?<=[.!?:;])\s+|\n+/)
        .map(sentence => sentence.trim())
        .filter(Boolean)
        .flatMap(sentence =>
            sentence.length > maxLength
                ? breakLongText(sentence, maxLength)
                : [sentence]
        );

    const chunks = [];
    let current = "";

    sentences.forEach(sentence => {
        if (current && (current + " " + sentence).length > maxLength) {
            chunks.push(current);
            current = sentence;
        } else {
            current = current ? current + " " + sentence : sentence;
        }
    });

    if (current) {
        chunks.push(current);
    }

    return chunks;
}

// Resolves when the reply has finished, or when speech is stopped.
function speakText(text) {
    return new Promise(resolve => {
        if (!speakMode || !("speechSynthesis" in window)) {
            resolve();
            return;
        }

        const chunks = splitIntoChunks(cleanForSpeech(text));

        if (chunks.length === 0) {
            resolve();
            return;
        }

        if (
            window.speechSynthesis.speaking ||
            window.speechSynthesis.pending
        ) {
            window.speechSynthesis.cancel();
        }

        const token = ++speechToken;

        let index = 0;
        let finished = false;
        let watchdog = null;

        function finish() {
            if (finished) {
                return;
            }

            finished = true;

            clearTimeout(watchdog);

            if (finishCurrentSpeech === finish) {
                finishCurrentSpeech = null;
            }

            isSpeaking = false;
            updateInterface();

            resolve();
        }

        function speakNext() {
            if (token !== speechToken || index >= chunks.length) {
                finish();
                return;
            }

            const chunk = chunks[index++];
            const utterance = new SpeechSynthesisUtterance(chunk);

            // Uses the voice and speed chosen in the sidebar.
            applyVoice(utterance);

            let advanced = false;

            function advance() {
                if (advanced) {
                    return;
                }

                advanced = true;
                clearTimeout(watchdog);
                speakNext();
            }

            utterance.onend = advance;

            utterance.onerror = () => {
                if (advanced) {
                    return;
                }

                advanced = true;
                finish();
            };

            // Safety net: if the browser never reports that this
            // chunk ended, move on so the interface can't stay locked.
            watchdog = setTimeout(() => {
                if (advanced) {
                    return;
                }

                window.speechSynthesis.cancel();
                advance();
            }, (5000 + chunk.length * 150) / Math.min(speechRate, 1));

            window.speechSynthesis.speak(utterance);
        }

        finishCurrentSpeech = finish;

        isSpeaking = true;
        updateInterface();

        speakNext();
    });
}

// --------------------------------------------------
// SCROLLING
// --------------------------------------------------

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

// --------------------------------------------------
// RENDER MARKDOWN AND MATHEMATICAL EQUATIONS
// Also turns links to videos and pictures into players
// and images, instead of leaving them as plain links.
// --------------------------------------------------

const MAX_EMBEDS_PER_MESSAGE = 4;

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO_FILE = /\.(mp4|webm|ogg|mov)$/i;

// Returns the YouTube video id for a link, or null.
function getYouTubeId(url) {
    const host = url.hostname.replace(/^(www|m)\./, "");

    let id = null;

    if (host === "youtu.be") {
        id = url.pathname.slice(1).split("/")[0];

    } else if (host === "youtube.com" || host === "music.youtube.com") {
        if (url.pathname === "/watch") {
            id = url.searchParams.get("v");
        } else {
            const match = url.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/);

            id = match ? match[2] : null;
        }
    }

    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// Returns the Vimeo video id for a link, or null.
function getVimeoId(url) {
    const host = url.hostname.replace(/^www\./, "");

    if (host !== "vimeo.com") {
        return null;
    }

    const match = url.pathname.match(/^\/(\d+)/);

    return match ? match[1] : null;
}

function makeVideoFrame(src, title) {
    const wrapper = document.createElement("div");

    wrapper.className = "media-embed video-embed";

    const frame = document.createElement("iframe");

    frame.src = src;
    frame.title = title;
    frame.loading = "lazy";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute(
        "allow",
        "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
    );

    wrapper.appendChild(frame);

    return wrapper;
}

// Turns a web link into an image / video element, or null if the
// link is not media. Only https links are embedded.
function makeMediaElement(href) {
    let url;

    try {
        url = new URL(href);
    } catch (error) {
        return null;
    }

    if (url.protocol !== "https:") {
        return null;
    }

    const youtubeId = getYouTubeId(url);

    if (youtubeId) {
        return makeVideoFrame(
            "https://www.youtube-nocookie.com/embed/" + youtubeId,
            "YouTube video"
        );
    }

    const vimeoId = getVimeoId(url);

    if (vimeoId) {
        return makeVideoFrame(
            "https://player.vimeo.com/video/" + vimeoId,
            "Vimeo video"
        );
    }

    if (IMAGE_FILE.test(url.pathname)) {
        const wrapper = document.createElement("div");

        wrapper.className = "media-embed image-embed";

        const picture = document.createElement("img");

        picture.src = url.href;
        picture.alt = "Image from the web";
        picture.loading = "lazy";
        picture.referrerPolicy = "no-referrer";

        picture.addEventListener("load", scrollToBottom);

        // If the site blocks the image, just keep the link.
        picture.addEventListener("error", () => wrapper.remove());

        wrapper.appendChild(picture);

        return wrapper;
    }

    if (VIDEO_FILE.test(url.pathname)) {
        const wrapper = document.createElement("div");

        wrapper.className = "media-embed file-video-embed";

        const video = document.createElement("video");

        video.src = url.href;
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;

        video.addEventListener("loadedmetadata", scrollToBottom);
        video.addEventListener("error", () => wrapper.remove());

        wrapper.appendChild(video);

        return wrapper;
    }

    return null;
}

// Finds links to videos and pictures in a rendered reply and shows
// them inline. Links in the "Sources" list are left as links.
function embedMedia(contentElement) {
    // Everything after the "Sources" heading is skipped.
    let sourcesHeading = null;

    for (const child of contentElement.children) {
        if (
            child.tagName === "P" &&
            child.textContent.trim() === "Sources"
        ) {
            sourcesHeading = child;
            break;
        }
    }

    const done = new Set();
    let count = 0;

    // Pictures written as Markdown ![...](...) are already <img> tags.
    // Make them tidy and safe to load from other sites.
    contentElement.querySelectorAll("img").forEach(picture => {
        picture.loading = "lazy";
        picture.referrerPolicy = "no-referrer";
        picture.classList.add("message-web-image");

        picture.addEventListener("load", scrollToBottom);
        picture.addEventListener("error", () => {
            picture.alt = picture.alt || "Image could not be loaded";
            picture.classList.add("broken");
        });
    });

    contentElement.querySelectorAll("a").forEach(link => {
        if (count >= MAX_EMBEDS_PER_MESSAGE) {
            return;
        }

        if (
            sourcesHeading &&
            (sourcesHeading.compareDocumentPosition(link) &
                Node.DOCUMENT_POSITION_FOLLOWING)
        ) {
            return;
        }

        const href = link.href;

        if (done.has(href)) {
            return;
        }

        const media = makeMediaElement(href);

        if (!media) {
            return;
        }

        done.add(href);
        count++;

        // The paragraph or list item that holds the link.
        const block = link.closest("p, li") || link;

        const onlyLink =
            block !== link &&
            block.textContent.trim() === link.textContent.trim();

        if (onlyLink && block.tagName === "P") {
            // The link was alone on its line: replace it with the media.
            block.replaceWith(media);
        } else {
            // Keep the sentence and show the media right below it.
            block.after(media);
        }
    });
}

async function renderMessage(contentElement, text) {
    try {
        await librariesReady;

        const html = window.marked.parse(text);

        contentElement.innerHTML = window.DOMPurify.sanitize(html);

        // Open links in a new tab instead of leaving the chat.
        contentElement.querySelectorAll("a").forEach(link => {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        });

        window.renderMathInElement(contentElement, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "\\[", right: "\\]", display: true },
                { left: "\\(", right: "\\)", display: false },
                { left: "$", right: "$", display: false }
            ],

            throwOnError: false,
            strict: "ignore"
        });

        // Last step: show videos and pictures instead of plain links.
        embedMedia(contentElement);

    } catch (error) {
        console.error("Message formatting error:", error);

        contentElement.textContent = text;
    }

    // The message got taller after formatting, so scroll again.
    scrollToBottom();
}

// --------------------------------------------------
// DISPLAY MESSAGES
// Your own messages and status messages stay plain text.
// Only ORBIT's real replies are formatted.
// --------------------------------------------------

function addMessage(sender, text, plain = false, imageUrl = null) {
    const isUser = sender === "You";

    const message = document.createElement("div");

    message.className = isUser ? "user-message" : "ai-message";

    // ORBIT's messages get a small logo avatar.
    if (!isUser) {
        const avatar = document.createElement("div");

        avatar.className = "avatar";
        avatar.innerHTML =
            '<svg aria-hidden="true"><use href="#orbit-logo"></use></svg>';

        message.appendChild(avatar);
    }

    const body = document.createElement("div");
    body.className = "message-body";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = sender;

    const content = document.createElement("div");
    content.className = "message-content";

    body.appendChild(label);

    // An attached image is shown above the text of the message.
    if (imageUrl) {
        const picture = document.createElement("img");

        picture.className = "message-image";
        picture.src = imageUrl;
        picture.alt = isUser ? "Attached image" : "Image from ORBIT";

        // Keep the chat scrolled to the bottom once the image loads.
        picture.addEventListener("load", scrollToBottom);

        body.appendChild(picture);
    }

    body.appendChild(content);

    message.appendChild(body);

    messages.appendChild(message);

    if (isUser || plain) {
        content.textContent = text;
    } else {
        renderMessage(content, text);
    }

    scrollToBottom();

    return message;
}

// --------------------------------------------------
// CLEAR THE CURRENT CHAT DISPLAY
// --------------------------------------------------

function clearMessages() {
    messages.replaceChildren();
}

// --------------------------------------------------
// LOAD PREVIOUS CHATS (only yours)
// --------------------------------------------------

async function loadConversationList() {
    try {
        const response = await authFetch(`${API}/conversations`);

        if (!response.ok) {
            throw new Error("Could not load previous chats.");
        }

        const data = await response.json();

        const list = document.createElement("div");
        list.className = "conversation-list";

        data.conversations.forEach(conversation => {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "conversation-item";
            button.textContent = conversation.title;
            button.title = conversation.title;

            if (conversation.id === currentConversationId) {
                button.classList.add("active");
            }

            button.addEventListener("click", () => {
                openConversation(conversation.id);
            });

            button.addEventListener("contextmenu", event => {
                event.preventDefault();

                showContextMenu(
                    event.clientX,
                    event.clientY,
                    conversation
                );
            });

            list.appendChild(button);
        });

        if (data.conversations.length === 0) {
            const empty = document.createElement("p");

            empty.className = "empty-list";
            empty.textContent = "No chats yet.";

            listContainer.replaceChildren(empty);
        } else {
            listContainer.replaceChildren(list);
        }

    } catch (error) {
        console.error("Conversation list error:", error);
    }
}

// --------------------------------------------------
// CREATE A CONVERSATION
// --------------------------------------------------

async function createConversation() {
    const response = await authFetch(`${API}/conversations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.error || "Could not create a conversation."
        );
    }

    return data.id;
}

// --------------------------------------------------
// START A NEW CHAT
// --------------------------------------------------

async function startNewChat() {
    if (isSending || isSpeaking) {
        return;
    }

    currentConversationId = null;

    clearMessages();
    setPendingImage(null);

    input.value = "";
    input.focus();

    await loadConversationList();
}

// --------------------------------------------------
// OPEN AN EXISTING CHAT
// --------------------------------------------------

async function openConversation(conversationId) {
    if (isSending || isSpeaking) {
        return;
    }

    try {
        const response = await authFetch(
            `${API}/conversations/${conversationId}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not open this conversation."
            );
        }

        currentConversationId = data.conversation.id;

        clearMessages();
        setPendingImage(null);

        // Old messages are displayed without being spoken.
        // Saved images are shown too.
        data.messages.forEach(message => {
            const sender =
                message.role === "user" ? "You" : "ORBIT";

            addMessage(
                sender,
                message.content,
                false,
                message.image || null
            );
        });

        await loadConversationList();

        input.focus();

    } catch (error) {
        console.error(error);

        alert(
            "Could not open this chat. Please try again."
        );
    }
}

// --------------------------------------------------
// RIGHT-CLICK MENU + DELETE CHAT
// --------------------------------------------------

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
}

function showContextMenu(x, y, conversation) {
    hideContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";

    const deleteItem = document.createElement("button");

    deleteItem.type = "button";
    deleteItem.className = "context-menu-item";
    deleteItem.textContent = "Delete chat";

    deleteItem.addEventListener("click", () => {
        hideContextMenu();
        deleteConversation(conversation);
    });

    menu.appendChild(deleteItem);

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();

    menu.style.left =
        Math.max(
            0,
            Math.min(x, window.innerWidth - rect.width - 8)
        ) + "px";

    menu.style.top =
        Math.max(
            0,
            Math.min(y, window.innerHeight - rect.height - 8)
        ) + "px";

    contextMenu = menu;
}

async function deleteConversation(conversation) {
    if (isSending || isSpeaking) {
        return;
    }

    const confirmed = confirm(
        `Delete "${conversation.title}"? This can't be undone.`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await authFetch(
            `${API}/conversations/${conversation.id}`,
            { method: "DELETE" }
        );

        if (!response.ok) {
            throw new Error(
                "Delete failed with status " + response.status
            );
        }

        if (conversation.id === currentConversationId) {
            currentConversationId = null;
            clearMessages();
        }

        await loadConversationList();

    } catch (error) {
        console.error(error);

        alert(
            "Could not delete this chat. Please try again."
        );
    }
}

// --------------------------------------------------
// CLOSE THE CONTEXT MENU
// --------------------------------------------------

document.addEventListener("click", hideContextMenu);

document.addEventListener("contextmenu", event => {
    if (!event.target.closest(".conversation-item")) {
        hideContextMenu();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        hideContextMenu();
    }
});

window.addEventListener("resize", hideContextMenu);

listContainer.addEventListener("scroll", hideContextMenu);

// --------------------------------------------------
// READ THE LIVE PROGRESS FROM THE SERVER
// /chat/stream sends one JSON object per line, for example:
//   {"type":"status","status":"searching"}
//   {"type":"done","reply":"..."}
// --------------------------------------------------

async function readEventStream(response, onEvent) {
    function handleLine(line) {
        const trimmed = line.trim();

        if (!trimmed) {
            return;
        }

        let event;

        try {
            event = JSON.parse(trimmed);
        } catch (error) {
            console.error("Bad stream line:", trimmed);
            return;
        }

        onEvent(event);
    }

    // Older browsers without streaming: read everything at once.
    if (!response.body || !response.body.getReader) {
        const text = await response.text();

        text.split("\n").forEach(handleLine);

        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");

        // The last piece may be unfinished, so keep it for later.
        buffer = lines.pop();

        lines.forEach(handleLine);
    }

    buffer += decoder.decode();

    handleLine(buffer);
}

// --------------------------------------------------
// SEND A MESSAGE
// --------------------------------------------------

form.addEventListener("submit", async function (event) {
    event.preventDefault();

    // While ORBIT is speaking, the button works as STOP.
    if (isSpeaking) {
        stopSpeaking();
        return;
    }

    if (isSending) {
        return;
    }

    const typed = input.value.trim();
    const imageToSend = pendingImage;

    // You can send text, an image, or both.
    if (!typed && !imageToSend) {
        return;
    }

    // An image with no text gets a default request.
    const userMessage = typed || DEFAULT_IMAGE_PROMPT;

    // Always start with "Thinking..."; the server switches it to
    // "Searching the web..." only when it really searches.
    workStatus = "thinking";
    isSending = true;
    updateInterface();

    let userBubble = null;
    let loading = null;
    let reply = null;

    try {
        if (currentConversationId === null) {
            currentConversationId = await createConversation();
        }

        userBubble = addMessage(
            "You",
            userMessage,
            false,
            imageToSend ? imageToSend.dataUrl : null
        );

        input.value = "";
        setPendingImage(null);

        loading = addMessage("ORBIT", statusLabel("thinking"), true);
        loading.classList.add("thinking");

        const payload = {
            message: userMessage,
            conversation_id: currentConversationId
        };

        // Lets the server use your local time and timezone.
        try {
            payload.timezone =
                Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (error) {
            // Ignore: the server uses its default timezone.
        }

        if (imageToSend) {
            payload.image = imageToSend.dataUrl;
        }

        const response = await authFetch(`${API}/chat/stream`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        let finalEvent = null;
        let failure = null;

        if (!response.ok) {
            // Problems with the request itself come back as plain JSON.
            let data = {};

            try {
                data = await response.json();
            } catch (error) {
                // Ignore: a default message is used below.
            }

            failure = data.error || "Something went wrong.";

        } else {
            await readEventStream(response, streamEvent => {
                if (streamEvent.type === "status") {
                    setWorkStatus(streamEvent.status, loading);

                } else if (streamEvent.type === "done") {
                    finalEvent = streamEvent;

                } else if (streamEvent.type === "error") {
                    failure = streamEvent.error || "Something went wrong.";
                }
            });

            if (!finalEvent && !failure) {
                failure = "ORBIT did not finish its answer. Please try again.";
            }
        }

        loading.remove();
        loading = null;

        if (failure) {
            userBubble.remove();
            userBubble = null;

            // Put everything back so nothing is lost.
            input.value = typed;
            setPendingImage(imageToSend);

            addMessage("ORBIT", failure, true);

        } else {
            addMessage(
                "ORBIT",
                finalEvent.reply,
                false,
                finalEvent.image || null
            );

            reply = finalEvent.reply;

            // Refresh titles and order before any speech starts.
            await loadConversationList();
        }

    } catch (error) {
        console.error(error);

        if (loading) {
            loading.remove();
        }

        if (userBubble) {
            userBubble.remove();

            input.value = typed;
            setPendingImage(imageToSend);
        }

        addMessage("ORBIT", "Error: " + error.message, true);

    } finally {
        isSending = false;
        workStatus = "thinking";
        updateInterface();
    }

    // Speak the new reply. This sets isSpeaking itself and resolves
    // when speech finishes or the user presses STOP.
    if (reply !== null) {
        await speakText(reply);
    }

    input.focus();
});

// --------------------------------------------------
// NEW CHAT BUTTON
// --------------------------------------------------

if (newChatButton) {
    newChatButton.addEventListener("click", startNewChat);
}

// --------------------------------------------------
// INITIALIZE ORBIT
// --------------------------------------------------

async function initializeOrbit() {
    if (!getToken()) {
        return;
    }

    await loadConversationList();

    input.focus();
}

initializeOrbit();

// ==================================================
// ORBIT SIMULATOR
// ==================================================


const COLORS = ["#7c8cff", "#4ade80", "#fbbf24", "#f472b6"];

const METRIC_LABELS = {
    speed: "Speed",
    cost_efficiency: "Low cost",
    low_risk: "Safety",
    impact: "Impact",
    ease: "Ease"
};

const $ = selector => document.querySelector(selector);

let projects = [];
let currentId = null;     // active project id, or null
let detail = null;        // data of the active project

// --------------------------------------------------
// HELPERS
// --------------------------------------------------



// Builds an element safely (text is never treated as HTML).
function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (key === "class") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value);
    }

    kids.flat().forEach(kid => {
        if (kid === null || kid === undefined) return;
        el.append(kid.nodeType ? kid : document.createTextNode(kid));
    });

    return el;
}

async function api(path, method = "GET", body = null) {
    const response = await fetch(API + path, {
        method: method,
        headers: {
            Authorization: "Bearer " + getToken(),
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
        location.href = "login.html";
        throw new Error("Please log in again.");
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

let toastTimer = null;

function toast(message, isError = false) {
    const el = $("#toast");

    el.textContent = message;
    el.className = "toast" + (isError ? " error" : "");
    el.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// Runs an async action and shows any error as a toast.
async function safe(action) {
    try {
        return await action();
    } catch (error) {
        console.error(error);
        toast(error.message, true);
    }
}

function fmtDate(iso) {
    const d = new Date(iso);

    return isNaN(d) ? "" : d.toLocaleString([], {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

// --------------------------------------------------
// TABS
// --------------------------------------------------

document.querySelectorAll("#sim-app .tab").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll("#sim-app .tab").forEach(b =>
            b.classList.toggle("active", b === button));

        document.querySelectorAll("#sim-app .panel").forEach(panel => {
            panel.hidden = panel.id !== "tab-" + button.dataset.tab;
        });

        if (button.dataset.tab === "projects") drawProgress();
    });
});

// --------------------------------------------------
// PROJECTS
// --------------------------------------------------

async function loadProjects() {
    const data = await api("/projects");

    projects = data.projects;

    if (currentId !== null && !projects.some(p => p.id === currentId)) {
        currentId = null;
    }

    if (currentId === null && projects.length) {
        currentId = projects[0].id;
    }

    renderProjectList();
    await loadDetail();
}

function renderProjectList() {
    const select = $("#project-select");

    select.replaceChildren(h("option", { value: "", text: "No project" }));

    projects.forEach(p => {
        const option = h("option", { value: String(p.id), text: p.name });
        select.append(option);
    });

    select.value = currentId === null ? "" : String(currentId);

    const box = $("#project-cards");

    if (!projects.length) {
        box.replaceChildren(h("p", { class: "muted", text: "No projects yet. Create your first one above." }));
        return;
    }

    box.replaceChildren(...projects.map(p =>
        h("button", {
            class: "project-card" + (p.id === currentId ? " active" : ""),
            type: "button",
            onclick: () => selectProject(p.id)
        },
            h("b", { text: p.name }),
            h("div", { class: "bar" }, h("div", { style: `width:${p.progress}%` })),
            h("small", { text: `${p.progress}% done · ${p.status}` })
        )
    ));
}

$("#project-select").addEventListener("change", event => {
    selectProject(event.target.value ? Number(event.target.value) : null);
});

async function selectProject(id) {
    currentId = id;

    renderProjectList();

    await safe(loadDetail);
}

async function loadDetail() {
    if (currentId === null) {
        detail = null;
        $("#project-detail").hidden = true;
        renderTimeline();
        renderHistory();
        return;
    }

    detail = await api(`/projects/${currentId}`);

    const p = detail.project;

    $("#project-detail").hidden = false;
    $("#edit-name").value = p.name;
    $("#edit-desc").value = p.description;
    $("#edit-status").value = p.status;
    $("#progress-fill").style.width = p.progress + "%";
    $("#progress-text").textContent =
        `${p.progress}% complete (${p.milestones_done} of ${p.milestones_total} milestones)`;

    renderMilestones();
    renderTimeline();
    renderHistory();

    const progress = await api(`/projects/${currentId}/progress`);

    drawProgress(progress.points);
}

$("#new-create").addEventListener("click", () => safe(async () => {
    const name = $("#new-name").value.trim();

    const data = await api("/projects", "POST", {
        name: name,
        description: $("#new-desc").value.trim()
    });

    $("#new-name").value = "";
    $("#new-desc").value = "";

    currentId = data.id;

    await loadProjects();

    toast("Project created.");
}));

$("#save-project").addEventListener("click", () => safe(async () => {
    const data = await api(`/projects/${currentId}`, "PUT", {
        name: $("#edit-name").value,
        description: $("#edit-desc").value,
        status: $("#edit-status").value
    });

    await loadProjects();

    toast(data.updated ? "Saved as a new version." : "Nothing changed.");
}));

$("#delete-project").addEventListener("click", () => safe(async () => {
    if (!confirm(`Delete "${detail.project.name}" and all its history? This can't be undone.`)) {
        return;
    }

    await api(`/projects/${currentId}`, "DELETE");

    currentId = null;

    await loadProjects();
}));

// --------------------------------------------------
// MILESTONES
// --------------------------------------------------

function renderMilestones() {
    const list = $("#ms-list");

    if (!detail.milestones.length) {
        list.replaceChildren(h("li", {}, h("span", { class: "muted", text: "No milestones yet." })));
        return;
    }

    list.replaceChildren(...detail.milestones.map(m => {
        const box = h("input", { type: "checkbox" });

        box.checked = !!m.done;

        box.addEventListener("change", () => safe(async () => {
            await api(`/milestones/${m.id}/toggle`, "POST");
            await loadProjects();
        }));

        return h("li", { class: m.done ? "done" : "" },
            box,
            h("span", { text: m.title }),
            h("button", {
                class: "x", type: "button", title: "Delete",
                onclick: () => safe(async () => {
                    await api(`/milestones/${m.id}`, "DELETE");
                    await loadProjects();
                })
            }, "\u00d7")
        );
    }));
}

$("#ms-add").addEventListener("click", () => safe(async () => {
    const title = $("#ms-title").value.trim();

    await api(`/projects/${currentId}/milestones`, "POST", { title: title });

    $("#ms-title").value = "";

    await loadProjects();
}));

$("#ms-title").addEventListener("keydown", event => {
    if (event.key === "Enter") $("#ms-add").click();
});

$("#ms-suggest").addEventListener("click", () => safe(async () => {
    const button = $("#ms-suggest");

    button.disabled = true;
    button.textContent = "Thinking...";

    try {
        const data = await api(`/projects/${currentId}/suggest`, "POST");

        await loadProjects();

        toast(data.added ? `Added ${data.added} milestones.` : "No new milestones to add.");
    } finally {
        button.disabled = false;
        button.textContent = "\u2728 Suggest with AI";
    }
}));

// --------------------------------------------------
// CHARTS (drawn on <canvas>, no library needed)
// --------------------------------------------------

function setupCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const ctx = canvas.getContext("2d");

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    return { ctx, width, height };
}

let lastPoints = [];

function drawProgress(points) {
    if (points) lastPoints = points;

    const canvas = $("#progress-chart");

    if (canvas.offsetParent === null) return;

    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { l: 40, r: 16, t: 14, b: 26 };
    const w = width - pad.l - pad.r;
    const hh = height - pad.t - pad.b;

    ctx.font = "11px Manrope, sans-serif";
    ctx.fillStyle = "#6f778c";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.textAlign = "right";

    [0, 25, 50, 75, 100].forEach(v => {
        const y = pad.t + hh - (v / 100) * hh;

        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(width - pad.r, y);
        ctx.stroke();
        ctx.fillText(v + "%", pad.l - 6, y + 4);
    });

    if (!lastPoints.length) {
        ctx.textAlign = "center";
        ctx.fillText("Add and finish milestones to see your progress here.", width / 2, height / 2);
        return;
    }

    // Progress changes in steps, so the line is drawn as a staircase.
    const times = lastPoints.map(p => new Date(p.t).getTime());
    const t0 = times[0];
    const span = Math.max(1, times[times.length - 1] - t0);
    const xOf = t => pad.l + ((t - t0) / span) * w;
    const yOf = p => pad.t + hh - (p / 100) * hh;

    ctx.beginPath();
    ctx.moveTo(xOf(times[0]), yOf(0));

    let previous = 0;

    lastPoints.forEach((point, i) => {
        ctx.lineTo(xOf(times[i]), yOf(previous));
        ctx.lineTo(xOf(times[i]), yOf(point.p));
        previous = point.p;
    });

    ctx.lineTo(pad.l + w, yOf(previous));

    ctx.strokeStyle = "#7c8cff";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.lineTo(pad.l + w, yOf(0));
    ctx.lineTo(xOf(times[0]), yOf(0));
    ctx.fillStyle = "rgba(124,140,255,0.15)";
    ctx.fill();

    lastPoints.forEach((point, i) => {
        ctx.beginPath();
        ctx.arc(xOf(times[i]), yOf(point.p), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#98a5ff";
        ctx.fill();
    });

    ctx.fillStyle = "#6f778c";
    ctx.textAlign = "left";
    ctx.fillText(new Date(t0).toLocaleDateString(), pad.l, height - 8);
    ctx.textAlign = "right";
    ctx.fillText(new Date(t0 + span).toLocaleDateString(), width - pad.r, height - 8);
}

window.addEventListener("resize", () => {
    drawProgress();
    if (lastResult) drawComparison(lastResult.result);
});

function drawComparison(result) {
    const canvas = $("#compare-chart");

    if (!canvas) return;

    const { ctx, width, height } = setupCanvas(canvas);
    const metrics = Object.keys(METRIC_LABELS);
    const pad = { l: 34, r: 10, t: 10, b: 28 };
    const w = width - pad.l - pad.r;
    const hh = height - pad.t - pad.b;
    const groupW = w / metrics.length;
    const count = result.options.length;
    const barW = Math.min(26, (groupW - 14) / count);

    ctx.font = "11px Manrope, sans-serif";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "#6f778c";
    ctx.textAlign = "right";

    [0, 50, 100].forEach(v => {
        const y = pad.t + hh - (v / 100) * hh;

        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(width - pad.r, y);
        ctx.stroke();
        ctx.fillText(String(v), pad.l - 6, y + 4);
    });

    metrics.forEach((metric, m) => {
        const startX = pad.l + m * groupW + (groupW - barW * count) / 2;

        result.options.forEach((option, o) => {
            const value = option.scores[metric];
            const barH = (value / 100) * hh;
            const x = startX + o * barW;

            ctx.fillStyle = COLORS[o % COLORS.length];
            ctx.beginPath();
            ctx.roundRect(x + 1, pad.t + hh - barH, barW - 2, barH, 3);
            ctx.fill();
        });

        ctx.fillStyle = "#a2a9bd";
        ctx.textAlign = "center";
        ctx.fillText(METRIC_LABELS[metric], pad.l + m * groupW + groupW / 2, height - 9);
    });
}

// --------------------------------------------------
// SIMULATOR
// --------------------------------------------------

let lastResult = null;

function addOptionRow(value = "") {
    const box = $("#sim-options");

    if (box.children.length >= 4) {
        toast("You can compare up to 4 options.", true);
        return;
    }

    const input = h("input", {
        type: "text", maxlength: "150",
        placeholder: "Option " + (box.children.length + 1)
    });

    input.value = value;

    const row = h("div", { class: "opt-row" }, input,
        h("button", {
            type: "button", title: "Remove",
            onclick: () => { if (box.children.length > 2) row.remove(); }
        }, "\u00d7"));

    box.append(row);
}

addOptionRow();
addOptionRow();

$("#sim-add-option").addEventListener("click", () => addOptionRow());

$("#sim-run").addEventListener("click", () => safe(async () => {
    const button = $("#sim-run");
    const options = [...document.querySelectorAll("#sim-options input")]
        .map(i => i.value.trim()).filter(Boolean);

    button.disabled = true;
    $("#sim-status").textContent = "Simulating outcomes... this can take up to a minute.";

    try {
        const data = await api("/simulate", "POST", {
            question: $("#sim-question").value.trim(),
            options: options,
            project_id: currentId
        });

        lastResult = data;
        renderResult(data);

        if (currentId !== null) await loadDetail();

    } finally {
        button.disabled = false;
        $("#sim-status").textContent = "";
    }
}));

function renderResult(data) {
    const result = data.result;
    const box = $("#sim-result");

    const best = result.recommendation.toLowerCase();

    const cards = result.options.map((option, i) => {
        const isBest = option.name.toLowerCase() === best;

        return h("div", { class: "opt-card" + (isBest ? " best" : "") },
            h("h4", {},
                h("i", { style: `width:10px;height:10px;border-radius:3px;background:${COLORS[i % COLORS.length]}` }),
                option.name,
                isBest ? h("span", { class: "badge", text: "RECOMMENDED" }) : null
            ),
            option.outcome ? h("p", { class: "muted", text: option.outcome }) : null,
            option.timeline ? h("p", { class: "muted", text: "Estimated time: " + option.timeline }) : null,
            option.pros.length ? h("ul", { class: "pros" }, option.pros.map(t => h("li", { text: t }))) : null,
            option.cons.length ? h("ul", { class: "cons" }, option.cons.map(t => h("li", { text: t }))) : null,
            h("button", {
                type: "button",
                onclick: () => safe(async () => {
                    await api(`/simulations/${data.id}/choose`, "POST", { option: option.name });
                    toast(`Saved "${option.name}" as your decision.`);
                    if (currentId !== null) await loadDetail();
                })
            }, "Choose this")
        );
    });

    box.replaceChildren(h("div", { class: "result-card" },
        h("h2", { text: "Simulation result" }),
        result.summary ? h("p", { text: result.summary }) : null,
        h("div", { class: "legend" }, result.options.map((o, i) =>
            h("span", {}, h("i", { style: `background:${COLORS[i % COLORS.length]}` }), o.name))),
        h("canvas", { id: "compare-chart", class: "chart" }),
        h("p", { class: "muted", text: "Scores are AI estimates from 0 to 100. Higher is always better." }),
        result.recommendation
            ? h("div", { class: "recommend" },
                h("b", { text: "Recommended: " + result.recommendation }),
                result.reason ? h("div", { text: result.reason }) : null)
            : null,
        h("div", { class: "grid" }, cards)
    ));

    box.hidden = false;

    drawComparison(result);

    box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHistory() {
    const box = $("#sim-history");

    if (!detail) {
        box.replaceChildren("Select a project to see its simulations.");
        return;
    }

    if (!detail.simulations.length) {
        box.replaceChildren("No simulations for this project yet.");
        return;
    }

    box.replaceChildren(...detail.simulations.map(sim =>
        h("div", {
            class: "history-item",
            onclick: () => {
                if (!sim.result) return;
                lastResult = { id: sim.id, question: sim.question, result: sim.result };
                renderResult(lastResult);
            },
            style: "cursor:pointer"
        },
            sim.question,
            h("small", { text: (sim.chosen ? "Chosen: " + sim.chosen + " · " : "Not decided · ") + fmtDate(sim.created_at) })
        )
    ));
}

// --------------------------------------------------
// TIMELINE
// --------------------------------------------------

const KIND_LABEL = {
    version: "Version",
    decision: "Decision",
    milestone: "Milestone",
    note: "Note"
};

function renderTimeline() {
    const box = $("#timeline-list");

    if (!detail) {
        box.replaceChildren(h("p", { class: "muted", text: "Choose a project at the top to see its history." }));
        return;
    }

    if (!detail.timeline.length) {
        box.replaceChildren(h("p", { class: "muted", text: "Nothing here yet." }));
        return;
    }

    box.replaceChildren(h("div", { class: "tl" }, detail.timeline.map(item =>
        h("div", { class: "tl-item " + item.kind },
            h("div", { class: "tl-kind", text: KIND_LABEL[item.kind] || item.kind }),
            h("div", { class: "tl-title", text: item.title }),
            item.detail ? h("p", { class: "tl-detail", text: item.detail }) : null,
            h("div", { class: "tl-time", text: fmtDate(item.created_at) })
        )
    )));
}

$("#tl-add").addEventListener("click", () => safe(async () => {
    if (currentId === null) throw new Error("Choose a project first.");

    await api(`/projects/${currentId}/timeline`, "POST", {
        kind: $("#tl-kind").value,
        title: $("#tl-title").value.trim()
    });

    $("#tl-title").value = "";

    await loadDetail();
}));

$("#tl-export").addEventListener("click", () => {
    if (!detail) return toast("Choose a project first.", true);

    const lines = [
        detail.project.name,
        "Progress: " + detail.project.progress + "%",
        "=".repeat(40),
        ""
    ];

    [...detail.timeline].reverse().forEach(item => {
        lines.push(`[${fmtDate(item.created_at)}] ${(KIND_LABEL[item.kind] || item.kind).toUpperCase()}: ${item.title}`);

        if (item.detail) lines.push(item.detail);

        lines.push("");
    });

    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    const link = h("a", { href: url, download: detail.project.name.replace(/\W+/g, "_") + "_history.txt" });

    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
});

// --------------------------------------------------
// MEMORY & STYLE
// --------------------------------------------------

async function loadProfile() {
    const profile = await api("/profile");

    $("#pf-name").value = profile.name;
    $("#pf-interests").value = profile.interests;
    $("#pf-notes").value = profile.notes;
    $("#pf-custom").value = profile.custom_style;

    const radio = document.querySelector(`input[name="style"][value="${profile.style}"]`);

    if (radio) radio.checked = true;
}

$("#pf-save").addEventListener("click", () => safe(async () => {
    const style = document.querySelector('input[name="style"]:checked').value;

    if (style === "custom" && !$("#pf-custom").value.trim()) {
        throw new Error("Describe your custom style first.");
    }

    await api("/profile", "PUT", {
        name: $("#pf-name").value,
        interests: $("#pf-interests").value,
        notes: $("#pf-notes").value,
        style: style,
        custom_style: $("#pf-custom").value
    });

    $("#pf-status").textContent = "Saved. ORBIT will use this in your next message.";

    toast("Saved.");
}));

// --------------------------------------------------
// OPEN / CLOSE THE SIMULATOR (sidebar button)
// --------------------------------------------------

const simApp = document.getElementById("sim-app");

function openSimulator() {
    simApp.hidden = false;

    safe(async () => {
        await loadProfile();
        await loadProjects();
    });
}

function closeSimulator() {
    simApp.hidden = true;
}

document.getElementById("sim-open").addEventListener("click", openSimulator);
document.getElementById("sim-close").addEventListener("click", closeSimulator);

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !simApp.hidden) {
        closeSimulator();
    }
});

// ==================================================
// SCREEN WATCH
// Share a tab or window (for example Google Docs). The analysis is
// shown in a small floating window that stays on top of your other
// windows (Chrome / Edge "Picture-in-Picture window"). While you are
// looking at the ORBIT page itself, analysis pauses; when you leave
// ORBIT, it analyzes the new screen once it changes and settles.
// ==================================================

(function () {
    const watchButton = document.getElementById("screen-button");

    if (!watchButton) return;

    // ----- Settings you can tune -----
    const CHECK_MS = 500;           // how often the screen is compared
    const THUMB_W = 80;             // comparison picture size (small = fast)
    const THUMB_H = 45;
    const PIXEL_DELTA = 28;         // how different a pixel must be (0-255)
    const CHANGE_RATIO = 0.015;     // share of pixels that must change
    const SETTLE_TICKS = 2;         // screen must stay still this many checks
    const MAX_WAIT_MS = 6000;       // analyze anyway if it never settles
    const MIN_GAP_MS = 2500;        // at least this long between analyses
    const SEND_MAX_SIDE = 1280;     // pixels of the picture sent to ORBIT
    const RESUME_DELAY_MS = 800;    // wait after leaving ORBIT before looking
    const POP_WIDTH = 380;          // floating window size
    const POP_HEIGHT = 480;

    const canPopOut = "documentPictureInPicture" in window;

    let mediaStream = null;
    let video = null;
    let panel = null;
    let pipWindow = null;

    let tickWorker = null;
    let tickWorkerUrl = null;
    let fallbackTimer = null;

    let refThumb = null;      // the screen as last analyzed
    let prevThumb = null;     // the screen at the previous check
    let stableTicks = 0;
    let changeStart = 0;
    let lastSent = 0;
    let controller = null;
    let lastAnswer = "";

    let paused = false;       // true while you are looking at ORBIT
    let resumeAt = 0;         // do not look before this time
    let isAnalyzing = false;

    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = THUMB_W;
    thumbCanvas.height = THUMB_H;

    const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true });

    // ---------- extra styles (also copied into the floating window) ----------

    const extraStyle = document.createElement("style");

    extraStyle.textContent =
        "#screen-panel.in-pip{position:static;width:100%;max-width:none;" +
        "height:100vh;max-height:none;border:none;border-radius:0;" +
        "box-shadow:none;animation:none;}" +
        ".pip-body{display:block !important;margin:0 !important;" +
        "height:100vh !important;overflow:hidden !important;" +
        "background:#050807 !important;background-image:none !important;}" +
        ".pip-body::before,.pip-body::after{display:none !important;}" +
        "#sp-pop{padding:5px 10px;background:transparent;color:#86efac;" +
        "border:1px solid rgba(74,222,128,0.42);border-radius:9px;" +
        "font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;}" +
        "#sp-pop:hover{background:rgba(74,222,128,0.12);}" +
        "#sp-pop[hidden]{display:none;}";

    document.head.appendChild(extraStyle);

    // ---------- panel ----------

    // The panel can live in the ORBIT page or in the floating window,
    // so its parts are always looked up inside the panel itself.
    function el(id) {
        return panel ? panel.querySelector("#" + id) : null;
    }

    function buildPanel() {
        panel = document.createElement("div");
        panel.id = "screen-panel";
        panel.hidden = true;

        panel.innerHTML =
            '<div class="sp-head">' +
            '<span class="sp-dot" id="sp-dot"></span>' +
            '<span class="sp-title">SCREEN WATCH</span>' +
            '<span class="sp-status" id="sp-status">Starting...</span>' +
            '<button type="button" id="sp-pop" hidden ' +
            'title="Keep this window on top of your other windows">' +
            "Float over other windows</button>" +
            '<button type="button" id="sp-stop">Stop</button>' +
            "</div>" +
            '<input type="text" id="sp-focus" maxlength="300" ' +
            'placeholder="Optional: what should ORBIT focus on? (press Enter)">' +
            '<div id="sp-answer" class="message-content"></div>' +
            '<div class="sp-time" id="sp-time"></div>';

        document.body.appendChild(panel);

        el("sp-stop").addEventListener("click", stopWatching);

        el("sp-pop").addEventListener("click", () => {
            popOut();
        });

        // Pressing Enter in the focus box analyzes again the next time
        // you leave ORBIT (the screen you are on right now is ORBIT).
        el("sp-focus").addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                refThumb = null;
            }
        });
    }

    function setStatus(text, busy) {
        const status = el("sp-status");
        const dot = el("sp-dot");

        if (status) status.textContent = text;
        if (dot) dot.classList.toggle("busy", !!busy);
    }

    function idleStatus() {
        return paused ? "Paused (you are in ORBIT)" : "Watching";
    }

    function updatePopButton() {
        const button = el("sp-pop");

        if (button) {
            button.hidden = !canPopOut || !!pipWindow || !mediaStream;
        }
    }

    // ---------- floating window ----------

    async function popOut() {
        if (!canPopOut || !panel || pipWindow) return !!pipWindow;

        try {
            pipWindow = await window.documentPictureInPicture.requestWindow({
                width: POP_WIDTH,
                height: POP_HEIGHT
            });
        } catch (error) {
            // Browsers only allow this right after a click.
            console.warn("Floating window not opened:", error);

            pipWindow = null;
            updatePopButton();

            return false;
        }

        const pipDoc = pipWindow.document;

        pipDoc.body.className = "pip-body";

        // Copy the page's styles into the floating window.
        Array.from(document.styleSheets).forEach(sheet => {
            try {
                if (sheet.href) {
                    const link = pipDoc.createElement("link");

                    link.rel = "stylesheet";
                    link.href = sheet.href;

                    pipDoc.head.appendChild(link);

                } else {
                    const style = pipDoc.createElement("style");

                    style.textContent = Array.from(sheet.cssRules)
                        .map(rule => rule.cssText)
                        .join("\n");

                    pipDoc.head.appendChild(style);
                }
            } catch (error) {
                // A style sheet we cannot read: skip it.
            }
        });

        panel.classList.add("in-pip");
        pipDoc.body.appendChild(panel);

        pipWindow.addEventListener("pagehide", onPopClosed);

        updatePopButton();

        return true;
    }

    // The floating window was closed: bring the panel back to ORBIT.
    function onPopClosed() {
        pipWindow = null;

        if (!panel) return;

        panel.classList.remove("in-pip");
        document.body.appendChild(panel);

        panel.hidden = !mediaStream;

        updatePopButton();
    }

    // ---------- reading the screen ----------

    function takeThumb() {
        thumbCtx.drawImage(video, 0, 0, THUMB_W, THUMB_H);

        const data = thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H).data;
        const gray = new Uint8Array(THUMB_W * THUMB_H);

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            gray[p] = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) | 0;
        }

        return gray;
    }

    function difference(a, b) {
        let changed = 0;

        for (let i = 0; i < a.length; i++) {
            if (Math.abs(a[i] - b[i]) > PIXEL_DELTA) changed++;
        }

        return changed / a.length;
    }

    function captureFrame() {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (!width || !height) return null;

        const scale = Math.min(1, SEND_MAX_SIDE / Math.max(width, height));

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);

        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL("image/jpeg", 0.72);
    }

    // ---------- the watching loop ----------

    function tick() {
        if (!video || video.readyState < 2) return;

        // Are you looking at the ORBIT page right now? Another tab,
        // another window (including the floating one) or another
        // monitor all count as "not ORBIT".
        const onOrbit =
            document.hasFocus() && document.visibilityState === "visible";

        if (onOrbit) {
            if (!paused) {
                paused = true;
                stableTicks = 0;
                changeStart = 0;
                prevThumb = null;

                if (!isAnalyzing) setStatus(idleStatus(), false);
            }

            // Do nothing: the shared screen may be showing ORBIT itself.
            return;
        }

        if (paused) {
            paused = false;

            // Give the screen a moment to switch before looking at it.
            resumeAt = Date.now() + RESUME_DELAY_MS;

            if (!isAnalyzing) setStatus(idleStatus(), false);
        }

        if (Date.now() < resumeAt) return;

        const current = takeThumb();

        if (!refThumb) {
            // Nothing analyzed yet (or the focus box was used).
            prevThumb = current;
            analyze(current);
            return;
        }

        if (!prevThumb) {
            prevThumb = current;
            return;
        }

        const changedFromRef = difference(current, refThumb) > CHANGE_RATIO;
        const stillMoving = difference(current, prevThumb) > CHANGE_RATIO / 2;

        prevThumb = current;

        if (!changedFromRef) {
            stableTicks = 0;
            changeStart = 0;
            return;
        }

        if (!changeStart) changeStart = Date.now();

        if (stillMoving) {
            stableTicks = 0;
        } else {
            stableTicks++;
        }

        const settled = stableTicks >= SETTLE_TICKS;
        const waitedTooLong = Date.now() - changeStart > MAX_WAIT_MS;

        if ((settled || waitedTooLong) && Date.now() - lastSent >= MIN_GAP_MS) {
            analyze(current);
        }
    }

    // A background worker keeps time, so Chrome does not slow the
    // checks down while the ORBIT tab sits in the background.
    function startTicking() {
        try {
            tickWorkerUrl = URL.createObjectURL(new Blob(
                ["setInterval(function(){postMessage(0)}," + CHECK_MS + ");"],
                { type: "text/javascript" }
            ));

            tickWorker = new Worker(tickWorkerUrl);
            tickWorker.onmessage = () => tick();

        } catch (error) {
            console.warn("Worker timer not available:", error);

            tickWorker = null;
            fallbackTimer = setInterval(tick, CHECK_MS);
        }
    }

    function stopTicking() {
        if (tickWorker) {
            tickWorker.terminate();
            tickWorker = null;
        }

        if (tickWorkerUrl) {
            URL.revokeObjectURL(tickWorkerUrl);
            tickWorkerUrl = null;
        }

        if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        }
    }

    async function analyze(thumb) {
        const image = captureFrame();

        if (!image) return;

        refThumb = thumb;
        stableTicks = 0;
        changeStart = 0;
        lastSent = Date.now();

        // A newer change cancels an answer that is still being written.
        if (controller) controller.abort();

        controller = new AbortController();

        const myController = controller;
        const answerBox = el("sp-answer");
        const focusBox = el("sp-focus");

        isAnalyzing = true;
        setStatus("Analyzing...", true);

        const payload = {
            image: image,
            focus: focusBox ? focusBox.value.trim() : "",
            previous: lastAnswer.slice(0, 700)
        };

        try {
            payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (error) {
            // Ignore.
        }

        try {
            const response = await authFetch(`${API}/screen/analyze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: myController.signal
            });

            if (!response.ok) {
                let data = {};

                try { data = await response.json(); } catch (error) { /* ignore */ }

                throw new Error(data.error || "Screen analysis failed.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let text = "";

            answerBox.textContent = "";

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                text += decoder.decode(value, { stream: true });

                answerBox.textContent = text;
                answerBox.scrollTop = answerBox.scrollHeight;
            }

            text += decoder.decode();

            if (text.trim()) {
                lastAnswer = text;

                // Nicely formatted version once the answer is complete.
                await renderMessage(answerBox, text);

                answerBox.scrollTop = answerBox.scrollHeight;

                const timeBox = el("sp-time");

                if (timeBox) {
                    timeBox.textContent =
                        "Updated " + new Date().toLocaleTimeString();
                }
            }

            isAnalyzing = false;
            setStatus(idleStatus(), false);

        } catch (error) {
            // A newer analysis took over: it handles the status itself.
            if (error.name === "AbortError") return;

            console.error(error);

            if (answerBox) answerBox.textContent = error.message;

            isAnalyzing = false;
            setStatus(idleStatus(), false);
        }
    }

    // ---------- start / stop ----------

    async function startWatching() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert("Your browser can't share the screen. Try Chrome, Edge or Firefox on a computer.");
            return;
        }

        try {
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 5 },
                audio: false,
                // Do not offer the ORBIT tab itself, and let the person
                // switch the shared tab from the browser's own bar.
                selfBrowserSurface: "exclude",
                surfaceSwitching: "include"
            });
        } catch (error) {
            // The person closed the picker: nothing to do.
            mediaStream = null;
            return;
        }

        if (!panel) buildPanel();

        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = mediaStream;

        try {
            await video.play();
        } catch (error) {
            console.error(error);
        }

        // Stops when the person clicks the browser's own "Stop sharing".
        mediaStream.getVideoTracks()[0].addEventListener("ended", stopWatching);

        refThumb = null;
        prevThumb = null;
        lastAnswer = "";
        paused = false;
        resumeAt = 0;
        isAnalyzing = false;

        el("sp-answer").textContent =
            "Switch to the tab or window you shared. ORBIT will analyze it " +
            "as soon as you leave this page.";
        el("sp-time").textContent = "";

        panel.hidden = false;
        watchButton.classList.add("on");

        setStatus("Watching", false);

        updatePopButton();

        startTicking();

        // Try to open the floating window right away. If the browser
        // refuses (it needs a fresh click), the "Float over other
        // windows" button stays visible in the panel.
        popOut();
    }

    function stopWatching() {
        stopTicking();

        if (controller) controller.abort();
        controller = null;

        isAnalyzing = false;
        paused = false;

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        if (video) {
            video.srcObject = null;
            video = null;
        }

        if (pipWindow) {
            try { pipWindow.close(); } catch (error) { /* ignore */ }
        }

        if (panel) {
            panel.hidden = true;
        }

        watchButton.classList.remove("on");
    }

    watchButton.addEventListener("click", () => {
        if (mediaStream) {
            stopWatching();
        } else {
            startWatching();
        }
    });
})();

// ==================================================
// VOICE INPUT
// The microphone button next to the message box. Speak, and your words
// appear in the box live. Uses the browser's built-in speech recognition,
// so no server code and no extra API are needed.
// ==================================================

(function () {
    "use strict";

    const micButton = document.getElementById("mic-button");
    const micSettings = document.getElementById("mic-settings");
    const langSelect = document.getElementById("mic-lang");
    const autoCheckbox = document.getElementById("mic-auto");

    if (!micButton) return;

    const SpeechRecognitionClass =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    // Firefox and some other browsers can't listen. Hide the mic controls.
    if (!SpeechRecognitionClass) {
        micButton.hidden = true;

        if (micSettings) micSettings.hidden = true;

        console.info("Voice input is not supported in this browser.");

        return;
    }

    // --------------------------------------------------
    // SETTINGS (remembered in the browser)
    // --------------------------------------------------

    let language = loadSetting("orbitMicLang") || "en-IN";
    let autoSend = loadSetting("orbitMicAuto") === "true";

    if (langSelect) {
        langSelect.value = language;

        // A saved language that is no longer in the list: use the first one.
        if (langSelect.value !== language) {
            language = langSelect.value;
        }

        langSelect.addEventListener("change", () => {
            language = langSelect.value;

            saveSetting("orbitMicLang", language);
        });
    }

    if (autoCheckbox) {
        autoCheckbox.checked = autoSend;

        autoCheckbox.addEventListener("change", () => {
            autoSend = autoCheckbox.checked;

            saveSetting("orbitMicAuto", autoSend);
        });
    }

    // --------------------------------------------------
    // LISTENING
    // --------------------------------------------------

    const IS_ANDROID = /Android/i.test(navigator.userAgent);

    const originalPlaceholder = input.placeholder;

    let recognition = null;
    let listening = false;
    let baseText = "";
    let finalText = "";
    let heardSomething = false;
    let cancelled = false;   // stopped on purpose, so do not auto-send
    let failed = false;      // an error happened, so do not auto-send

    function setListening(on) {
        listening = on;

        micButton.classList.toggle("listening", on);
        micButton.setAttribute("aria-pressed", String(on));
        micButton.title = on ? "Stop listening" : "Speak your message";

        input.placeholder = on ? "Listening..." : originalPlaceholder;
    }

    function explain(error) {
        if (error === "not-allowed" || error === "service-not-allowed") {
            alert(
                "ORBIT can't use your microphone. Allow microphone access " +
                "for this site in your browser settings, then try again."
            );
        } else if (error === "audio-capture") {
            alert("No microphone was found. Connect one and try again.");
        } else if (error === "network") {
            alert(
                "The speech service could not be reached. Check your " +
                "internet connection and try again."
            );
        } else if (error === "language-not-supported") {
            alert("Your browser doesn't support that mic language.");
        }

        // "no-speech" and "aborted" are normal, so nothing is shown.
    }

    function startListening() {
        if (listening || input.disabled) {
            return;
        }

        recognition = new SpeechRecognitionClass();

        recognition.lang = language;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        // Auto-send listens for one phrase and stops when you pause.
        // Android repeats words in continuous mode, so it uses one phrase too.
        recognition.continuous = !autoSend && !IS_ANDROID;

        baseText = input.value.trim();
        finalText = "";
        heardSomething = false;
        cancelled = false;
        failed = false;

        recognition.onstart = () => setListening(true);

        recognition.onresult = event => {
            let interim = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];

                if (result.isFinal) {
                    finalText += result[0].transcript;
                } else {
                    interim += result[0].transcript;
                }
            }

            const spoken = (finalText + " " + interim)
                .replace(/\s+/g, " ")
                .trim();

            heardSomething = spoken.length > 0;

            input.value = [baseText, spoken].filter(Boolean).join(" ");
        };

        recognition.onerror = event => {
            if (event.error !== "no-speech" && event.error !== "aborted") {
                failed = true;
            }

            explain(event.error);
        };

        recognition.onend = () => {
            setListening(false);

            recognition = null;

            // Send automatically only if the user asked for it, something
            // was heard, and nothing went wrong or was cancelled.
            if (
                autoSend &&
                heardSomething &&
                !cancelled &&
                !failed &&
                !input.disabled &&
                input.value.trim()
            ) {
                form.requestSubmit();
            } else if (heardSomething) {
                input.focus();
            }
        };

        try {
            recognition.start();
        } catch (error) {
            console.error("Could not start voice input:", error);

            recognition = null;

            setListening(false);
        }
    }

    function stopListening() {
        if (recognition) {
            // stop() still delivers the last words before ending.
            recognition.stop();
        }
    }

    function cancelListening() {
        if (recognition) {
            cancelled = true;

            recognition.abort();
        }
    }

    micButton.addEventListener("click", () => {
        if (listening) {
            stopListening();
        } else {
            startListening();
        }
    });

    // Pressing SEND or Enter while listening ends the recording first,
    // so no extra words are added after the message is sent.
    form.addEventListener("submit", cancelListening, true);

    // ORBIT locks the message box while it thinks or reads aloud. The mic
    // follows that, so it never records ORBIT's own voice.
    function syncDisabled() {
        micButton.disabled = input.disabled;

        if (input.disabled) {
            cancelListening();
        }
    }

    new MutationObserver(syncDisabled).observe(input, {
        attributes: true,
        attributeFilter: ["disabled"]
    });

    syncDisabled();

    window.addEventListener("beforeunload", cancelListening);
})();
// ==================================================
// IMAGE FIX FOR PHONE PHOTOS (add at the very end)
// Replaces the old prepareImage with a version that
// works with big phone photos and blank file types.
// ==================================================

function fixLoadImg(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("decode failed"));

        img.src = url;
    });
}

function fixReadDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("read failed"));

        reader.readAsDataURL(file);
    });
}

function fixLooksLikeImage(file) {
    return (
        (file.type && file.type.startsWith("image/")) ||
        /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(file.name || "")
    );
}

async function fixDecode(file) {
    // 1. createImageBitmap: best for large phone photos.
    if (window.createImageBitmap) {
        try {
            const bmp = await createImageBitmap(file, {
                imageOrientation: "from-image"
            });

            return {
                source: bmp,
                width: bmp.width,
                height: bmp.height,
                cleanup: () => bmp.close && bmp.close()
            };
        } catch (e1) {
            try {
                const bmp = await createImageBitmap(file);

                return {
                    source: bmp,
                    width: bmp.width,
                    height: bmp.height,
                    cleanup: () => bmp.close && bmp.close()
                };
            } catch (e2) {
                // Try the next method.
            }
        }
    }

    // 2. <img> with an object URL.
    const objectUrl = URL.createObjectURL(file);

    try {
        const img = await fixLoadImg(objectUrl);

        return {
            source: img,
            width: img.naturalWidth,
            height: img.naturalHeight,
            cleanup: () => URL.revokeObjectURL(objectUrl)
        };
    } catch (e3) {
        URL.revokeObjectURL(objectUrl);
    }

    // 3. <img> with a data URL.
    const dataUrl = await fixReadDataUrl(file);
    const img = await fixLoadImg(dataUrl);

    return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        cleanup: () => {}
    };
}

prepareImage = async function (file) {
    if (!fixLooksLikeImage(file)) {
        throw new Error(
            "Please choose an image file (PNG, JPG, WEBP or GIF)."
        );
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
        throw new Error("That image is too large. The limit is 20 MB.");
    }

    let decoded;

    try {
        decoded = await fixDecode(file);
    } catch (error) {
        console.error("Image decode failed:", error, file.type, file.name);

        const isHeic =
            /hei[cf]/i.test(file.type) ||
            /\.hei[cf]$/i.test(file.name || "");

        throw new Error(
            isHeic
                ? "This is a HEIC photo, which this browser can't read. On iPhone, use Safari, or set Camera > Formats > Most Compatible."
                : "Could not read this image. Try a PNG, JPG, WEBP or GIF file."
        );
    }

    try {
        const scale = Math.min(
            1,
            MAX_IMAGE_SIDE / Math.max(decoded.width, decoded.height)
        );

        const width = Math.max(1, Math.round(decoded.width * scale));
        const height = Math.max(1, Math.round(decoded.height * scale));

        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(decoded.source, 0, 0, width, height);

        return canvas.toDataURL("image/jpeg", 0.85);

    } finally {
        decoded.cleanup();
    }
};
// DIAGNOSTIC v2: shows why the image failed
handleImageFile = async function (file) {
    if (!file || isSending || isSpeaking) {
        return;
    }

    try {
        const dataUrl = await prepareImage(file);

        setPendingImage({
            dataUrl: dataUrl,
            name: file.name || "Pasted image"
        });

        input.focus();

    } catch (error) {
        console.error(error);

        alert(
            "v2 | " + error.message +
            "\n\nname: " + (file.name || "none") +
            "\ntype: " + (file.type || "blank") +
            "\nsize: " + Math.round(file.size / 1024) + " KB"
        );
    }
};
// DIAGNOSTIC v3
prepareImage = async function (file) {
    const log = [];
    let blob = file;

    try {
        const buf = await file.arrayBuffer();
        const head = Array.from(new Uint8Array(buf.slice(0, 4)))
            .map(b => b.toString(16))
            .join(" ");

        log.push("read ok (" + buf.byteLength + " bytes, starts " + head + ")");

        blob = new Blob([buf], { type: file.type || "image/jpeg" });
    } catch (e) {
        log.push("read FAILED: " + e.name + " " + e.message);
    }

    let source = null;
    let width = 0;
    let height = 0;
    let cleanup = () => {};

    try {
        const bmp = await createImageBitmap(blob);

        source = bmp;
        width = bmp.width;
        height = bmp.height;
        cleanup = () => bmp.close && bmp.close();

        log.push("bitmap ok");
    } catch (e) {
        log.push("bitmap failed: " + e.name + " " + e.message);
    }

    if (!source) {
        const url = URL.createObjectURL(blob);

        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();

                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error("img error"));

                i.src = url;
            });

            source = img;
            width = img.naturalWidth;
            height = img.naturalHeight;
            cleanup = () => URL.revokeObjectURL(url);

            log.push("img ok");
        } catch (e) {
            URL.revokeObjectURL(url);

            log.push("img failed: " + e.message);
        }
    }

    if (!source) {
        throw new Error("v3 | " + log.join(" | "));
    }

    try {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement("canvas");

        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(source, 0, 0, w, h);

        return canvas.toDataURL("image/jpeg", 0.85);
    } finally {
        cleanup();
    }
};
// ==================================================
// NVIDIA FEATURES (frontend)
//  1. Deep Think button
//  2. Knowledge Base ("My files") panel
//  3. Project Coach button inside each project
// Safety Shield needs no UI: the server does it.
// Paste this at the very end of chatinterface.js
// ==================================================

// ---------- 1. DEEP THINK ----------
(function () {
    let deepOn = false;

    const button = document.createElement("button");

    button.type = "button";
    button.id = "deep-button";
    button.title = "Deep Think: for hard maths and logic (slower)";
    button.setAttribute("aria-label", "Deep Think");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

    // Sits just before the microphone button.
    const anchor =
        document.getElementById("mic-button") ||
        document.getElementById("send-button");

    anchor.before(button);

    button.addEventListener("click", () => {
        deepOn = !deepOn;

        button.classList.toggle("on", deepOn);
        button.setAttribute("aria-pressed", String(deepOn));
        button.title = deepOn
            ? "Deep Think is ON (click to turn off)"
            : "Deep Think: for hard maths and logic (slower)";

        input.focus();
    });

    // When Deep Think is on, add deep_think: true to the chat request.
    const plainAuthFetch = authFetch;

    authFetch = function (url, options = {}) {
        if (
            deepOn &&
            typeof url === "string" &&
            url.endsWith("/chat/stream") &&
            typeof options.body === "string"
        ) {
            try {
                const payload = JSON.parse(options.body);

                payload.deep_think = true;

                options = Object.assign({}, options, {
                    body: JSON.stringify(payload)
                });
            } catch (error) {
                // Send the request unchanged.
            }
        }

        return plainAuthFetch(url, options);
    };

    // Honest loading text, because Deep Think can take a minute.
    const plainStatusLabel = statusLabel;

    statusLabel = function (status) {
        if (deepOn && status !== "searching") {
            return "Thinking deeply... this can take a minute";
        }

        return plainStatusLabel(status);
    };

    // Do not read the reasoning box or the "Matched from your files"
    // note out loud.
    const plainCleanForSpeech = cleanForSpeech;

    cleanForSpeech = function (text) {
        return plainCleanForSpeech(
            String(text)
                .split("\n\n<details>")[0]
                .split("\n\n\u{1F4DA} *Matched")[0]
        );
    };
})();

// ---------- 2. KNOWLEDGE BASE ("My files") ----------
(function () {
    const MAX_TEXT_BYTES = 1024 * 1024;        // plain text files
    const MAX_DOC_BYTES = 10 * 1024 * 1024;    // PDF / Word
    const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

    const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;

    const sidebarButton = document.createElement("button");

    sidebarButton.type = "button";
    sidebarButton.className = "but2";
    sidebarButton.id = "kb-open";
    sidebarButton.innerHTML = "&#128218; My files";

    document.getElementById("sim-open").after(sidebarButton);

    const fileInput = h("input", {
        type: "file",
        id: "kb-file",
        multiple: "",
        accept:
            ".pdf,.docx,image/*,.txt,.md,.markdown,.csv,.json,.py,.js,.ts," +
            ".html,.css,.java,.c,.cpp,.cs,.go,.rs,.sql,.xml,.yml,.yaml,.log,text/*"
    });

    fileInput.hidden = true;

    const status = h("p", { class: "kb-status" });
    const list = h("div", { class: "kb-list" });
    const count = h("span", { class: "kb-count" });

    const uploadButton = h("button", {
        type: "button",
        class: "kb-upload",
        text: "+ Upload files"
    });

    const closeButton = h("button", {
        type: "button",
        class: "kb-close",
        "aria-label": "Close",
        text: "\u00d7"
    });

    const modal = h("div", { class: "kb-modal", hidden: "" },
        h("div", { class: "kb-card", role: "dialog", "aria-label": "My files" },
            h("div", { class: "kb-head" },
                h("h2", { text: "My files" }),
                count,
                closeButton
            ),
            h("p", {
                class: "kb-hint",
                text: "Upload PDFs, Word (.docx) files, images, notes or code. " +
                    "When you ask a question, ORBIT automatically uses the " +
                    "parts that match."
            }),
            h("div", { class: "kb-actions" }, uploadButton, fileInput),
            status,
            list
        )
    );

    document.body.appendChild(modal);

    let busy = false;
    let maxDocs = 6;

    function say(text, isError) {
        status.textContent = text || "";
        status.classList.toggle("error", !!isError);
    }

    // An error caused by the file itself (not the server): skip it and
    // carry on with the next file.
    function localError(message) {
        const error = new Error(message);

        error.local = true;

        return error;
    }

    function kindOf(file) {
        const name = (file.name || "").toLowerCase();

        if ((file.type || "").startsWith("image/") || IMAGE_EXT.test(name)) {
            return "image";
        }

        if (name.endsWith(".pdf") || file.type === "application/pdf") {
            return "pdf";
        }

        if (name.endsWith(".docx")) return "docx";
        if (name.endsWith(".doc")) return "olddoc";

        return "text";
    }

    function renderList(docs) {
        count.textContent = docs.length + " / " + maxDocs;

        if (!docs.length) {
            list.replaceChildren(
                h("p", { class: "kb-empty", text: "No files yet." })
            );
            return;
        }

        list.replaceChildren(...docs.map(doc =>
            h("div", { class: "kb-item" },
                h("div", { class: "kb-info" },
                    h("b", { text: doc.name }),
                    h("small", {
                        text: doc.chars.toLocaleString() + " characters \u00b7 " +
                            doc.chunks + " pieces"
                    })
                ),
                h("button", {
                    type: "button",
                    class: "kb-del",
                    title: "Delete this file",
                    text: "Delete",
                    onclick: () => removeDoc(doc)
                })
            )
        ));
    }

    async function refresh() {
        try {
            const data = await api("/kb");

            maxDocs = data.max_docs || maxDocs;

            renderList(data.docs);

            uploadButton.disabled = !data.ready;

            if (!data.ready) {
                say(
                    "The knowledge base is switched off on the server " +
                    "(NVIDIA_API_KEY is missing).",
                    true
                );
            }
        } catch (error) {
            console.error(error);
            say(error.message, true);
        }
    }

    async function removeDoc(doc) {
        if (busy) return;

        if (!confirm('Delete "' + doc.name + '"? This can\'t be undone.')) {
            return;
        }

        try {
            await api("/kb/" + doc.id, "DELETE");

            say('Deleted "' + doc.name + '".');

            await refresh();
        } catch (error) {
            say(error.message, true);
        }
    }

    // Sends one file to the right place. Returns the server's answer.
    async function uploadOne(file) {
        const kind = kindOf(file);

        if (kind === "olddoc") {
            throw localError(
                "old .doc files are not supported. Save it as .docx or PDF."
            );
        }

        if (kind === "image") {
            if (file.size > MAX_IMAGE_BYTES) {
                throw localError("that image is too large (limit 20 MB).");
            }

            say("Looking at " + file.name + "...");

            // Shrinks big phone photos and converts them to JPEG.
            const dataUrl = await prepareImage(file);

            return api("/kb/file", "POST", { name: file.name, data: dataUrl });
        }

        if (kind === "pdf" || kind === "docx") {
            if (file.size > MAX_DOC_BYTES) {
                throw localError("that file is too large (limit 10 MB).");
            }

            say("Reading " + file.name + "...");

            const dataUrl = await fixReadDataUrl(file);

            return api("/kb/file", "POST", { name: file.name, data: dataUrl });
        }

        // Plain text and code.
        if (file.size > MAX_TEXT_BYTES) {
            throw localError("that file is too large (limit 1 MB).");
        }

        say("Reading " + file.name + "...");

        const text = await file.text();

        if (text.includes("\u0000")) {
            throw localError("that is not a text file.");
        }

        return api("/kb", "POST", { name: file.name, text: text });
    }

    async function uploadFiles(files) {
        if (busy) return;

        busy = true;
        uploadButton.disabled = true;

        try {
            for (const file of files) {
                try {
                    say("Adding " + file.name + " (this can take a little while)...");

                    const data = await uploadOne(file);

                    say(
                        "Added " + file.name + " (" + data.chunks + " pieces)." +
                        (data.truncated
                            ? " It was long, so only the first part was kept."
                            : "")
                    );
                } catch (error) {
                    say(file.name + ": " + error.message, true);

                    // A server problem will probably affect the next file too.
                    if (!error.local) break;

                    continue;
                }

                await refresh();
            }
        } finally {
            busy = false;
            uploadButton.disabled = false;

            fileInput.value = "";

            await refresh();
        }
    }

    function open() {
        say("");
        modal.hidden = false;
        refresh();
    }

    function close() {
        modal.hidden = true;
    }

    sidebarButton.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    uploadButton.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length) {
            uploadFiles(Array.from(fileInput.files));
        }
    });

    modal.addEventListener("click", event => {
        if (event.target === modal) close();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) close();
    });
})();

// ---------- 3. PROJECT COACH ----------
(function () {
    const heading = Array.from(
        document.querySelectorAll("#project-detail h3")
    ).find(item => item.textContent.trim() === "Milestones");

    if (!heading) return;

    const coachButton = h("button", {
        type: "button",
        id: "coach-run",
        text: "\u{1F9ED} Ask ORBIT Coach"
    });

    const note = h("span", {
        class: "muted",
        text: "Health score, risks, next 3 actions and a short plan."
    });

    const output = h("div", { class: "message-content coach-out" });

    output.hidden = true;

    heading.before(
        h("h3", { text: "Project Coach" }),
        h("div", { class: "row" }, coachButton, note),
        output
    );

    let coachFor = null; // which project the shown review belongs to

    // Switching to another project clears the old review.
    const plainLoadDetail = loadDetail;

    loadDetail = async function () {
        await plainLoadDetail();

        if (coachFor !== currentId) {
            output.hidden = true;
            output.replaceChildren();
            coachFor = null;
        }
    };

    coachButton.addEventListener("click", () => safe(async () => {
        if (currentId === null) {
            throw new Error("Choose a project first.");
        }

        const projectId = currentId;

        coachButton.disabled = true;
        coachButton.textContent = "Reviewing... (up to a minute)";

        try {
            const data = await api("/projects/" + projectId + "/coach", "POST");

            // The person may have switched project while waiting.
            if (projectId !== currentId) return;

            coachFor = projectId;
            output.hidden = false;

            await renderMessage(output, data.analysis);

            output.append(h("p", {
                class: "muted",
                text: data.engine === "nvidia"
                    ? "Reviewed by NVIDIA Nemotron."
                    : "Reviewed by the standard ORBIT model (Nemotron was unavailable)."
            }));

            // The review adds a note to the timeline, so refresh it.
            await loadDetail();
        } finally {
            coachButton.disabled = false;
            coachButton.textContent = "\u{1F9ED} Ask ORBIT Coach";
        }
    }));
})();
// ==================================================
// KNOWLEDGE BASE: clearer errors, server check, drag-and-drop
// ==================================================

// 1. Every server call now says WHAT went wrong.
api = async function (path, method = "GET", body = null) {
    let response;

    try {
        response = await fetch(API + path, {
            method: method,
            headers: {
                Authorization: "Bearer " + getToken(),
                "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (error) {
        throw new Error(
            "Could not reach the server. It may be offline, still starting " +
            "up, or the upload took too long and the server gave up."
        );
    }

    if (response.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
        location.href = "login.html";
        throw new Error("Please log in again.");
    }

    const text = await response.text();

    let data = {};

    try { data = JSON.parse(text); } catch (e) { /* not JSON */ }

    if (!response.ok) {
        let hint = "";

        if (response.status === 404) {
            hint = " (the server does not have this feature: update app.py, then restart or redeploy)";
        } else if (response.status === 413) {
            hint = " (the file is too big for the server)";
        } else if (response.status >= 500) {
            hint = " (the server crashed or timed out)";
        }

        throw new Error(data.error || ("Server error " + response.status + hint));
    }

    return data;
};

// 2. A check line in the "My files" panel + PDFs can be dropped onto it.
(function () {
    const modal = document.querySelector(".kb-modal");
    const openButton = document.getElementById("kb-open");
    const fileInput = document.getElementById("kb-file");
    const hint = modal ? modal.querySelector(".kb-hint") : null;

    if (!modal || !openButton || !fileInput || !hint) return;

    const check = document.createElement("p");

    check.style.cssText =
        "margin:0;font-size:12px;font-weight:700;color:#9aaa9f;";

    hint.after(check);

    function show(text, good) {
        check.textContent = text;
        check.style.color = good ? "#86efac" : "#ff7b7b";
    }

    openButton.addEventListener("click", async () => {
        check.textContent = "Checking the server...";
        check.style.color = "#9aaa9f";

        try {
            const info = await api("/kb/status");

            if (!info.ready) {
                show("Server check: the knowledge base is off (NVIDIA_API_KEY missing on the server).", false);
            } else if (!info.pdf_ready) {
                show("Server check: PDF reading is NOT installed (pypdf missing). Add pypdf to requirements.txt and redeploy.", false);
            } else {
                show("Server check passed: PDF, Word and image files are supported (version " + info.version + ").", true);
            }
        } catch (error) {
            if (/not found|404|does not have/i.test(error.message)) {
                show("Server check: this server is running an OLD app.py without the file upload code. Update it, then restart or redeploy.", false);
            } else {
                show("Server check failed: " + error.message, false);
            }
        }
    });

    // Dropping a file on the panel uploads it (the old image drop handler
    // used to grab it and reject anything that was not a picture).
    modal.addEventListener("dragover", event => {
        event.preventDefault();
        event.stopPropagation();
    });

    modal.addEventListener("drop", event => {
        event.preventDefault();
        event.stopPropagation();

        document.body.classList.remove("dragging");

        const files = event.dataTransfer && event.dataTransfer.files;

        if (files && files.length) {
            fileInput.files = files;
            fileInput.dispatchEvent(new Event("change"));
        }
    });
})();
// ==================================================
// FORECAST: finish-date simulation
// Button in the sidebar + panel over the chat. The AI makes the task
// list (server); the simulation runs here, so what-ifs are instant.
// Typing "forecast my project" or "will I finish by December 20?"
// opens the panel with your message filled in.
// ==================================================
(function () {
    const RUNS = 3000;
    const MAX_BINS = 24;

    const MONTHS = [
        "january", "february", "march", "april", "may", "june", "july",
        "august", "september", "october", "november", "december"
    ];

    const TRIGGER =
        /\bforecast\b|\bwill i (?:be able to |still )?(?:finish|complete|meet|hit|make)\b|\b(?:can|could) i (?:finish|complete|meet)\b.*\bby\b/i;

    const state = {
        tasks: [],
        dropped: new Set(),
        team: 1,
        deadline: null,
        extraWeeks: 0,
        start: null,
        sim: null,
        chance: null,
        description: ""
    };

    // ---------- styles ----------
    const style = document.createElement("style");

    style.textContent = `
.fc-card{width:min(720px,100%);overflow-y:auto;color:#e6efe9;font-family:inherit;}
.fc-card textarea,.fc-card input,.fc-card select{background:rgba(4,7,5,.8);color:#e6efe9;
 border:1px solid rgba(160,230,190,.22);border-radius:9px;padding:8px 10px;
 font-family:inherit;font-size:14px;}
.fc-card textarea{width:100%;min-height:80px;resize:vertical;box-sizing:border-box;}
.fc-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}
.fc-row label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aaa9f;}
.fc-btn{padding:8px 14px;border-radius:9px;border:1px solid rgba(74,222,128,.5);
 background:rgba(74,222,128,.14);color:#86efac;font-weight:700;cursor:pointer;
 font-family:inherit;font-size:13px;}
.fc-btn:hover{background:rgba(74,222,128,.25);}
.fc-btn:disabled{opacity:.5;cursor:default;}
.fc-btn.small{padding:4px 9px;font-size:12px;}
.fc-status{margin:0;font-size:13px;color:#9aaa9f;}
.fc-status.error{color:#ff7b7b;}
.fc-big{font-size:42px;font-weight:800;line-height:1;}
.fc-big.good{color:#4ade80;}.fc-big.mid{color:#fbbf24;}.fc-big.bad{color:#f87171;}
.fc-muted{color:#9aaa9f;font-size:13px;margin:0;}
.fc-chart{width:100%;height:200px;display:block;}
.fc-risk{display:flex;align-items:center;gap:10px;padding:8px 10px;
 background:rgba(255,255,255,.04);border-radius:9px;font-size:13px;}
.fc-risk b{flex:1;}
.fc-chips{display:flex;flex-wrap:wrap;gap:6px;}
.fc-hist{display:flex;justify-content:space-between;gap:8px;padding:6px 0;
 border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;}
.fc-section{margin:4px 0 0;font-size:14px;font-weight:700;}
`;

    document.head.appendChild(style);

    // ---------- date helpers ----------
    const pad = n => String(n).padStart(2, "0");
    const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

    function parseISO(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");

        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }

    function today() {
        const d = new Date();

        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

    // The date that is n working days after start.
    function addWorkdays(start, n) {
        const d = new Date(start);
        let left = Math.ceil(n);

        while (left > 0) {
            d.setDate(d.getDate() + 1);

            if (!isWeekend(d)) left--;
        }

        return d;
    }

    // Working days after `start`, up to and including `end`.
    function workdaysBetween(start, end) {
        const d = new Date(start);
        let count = 0;

        for (let i = 0; i < 3650 && d < end; i++) {
            d.setDate(d.getDate() + 1);

            if (!isWeekend(d)) count++;
        }

        return count;
    }

    function fmtDay(d) {
        const sameYear = d.getFullYear() === new Date().getFullYear();

        return d.toLocaleDateString([], sameYear
            ? { day: "numeric", month: "short" }
            : { day: "numeric", month: "short", year: "numeric" });
    }

    // Finds "December 20", "20th of Dec" or 2026-12-20 inside a sentence.
    function findDate(text) {
        const t = text.toLowerCase();

        let m = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);

        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

        const names = MONTHS.concat(MONTHS.map(n => n.slice(0, 3)));
        const alt = names.join("|");

        const re = new RegExp(
            "\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(" + alt + ")|(" +
            alt + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b"
        );

        m = t.match(re);

        if (!m) return null;

        const day = +(m[1] || m[4]);
        const name = m[2] || m[3];
        const month = MONTHS.findIndex(n => n.startsWith(name.slice(0, 3)));

        if (month < 0 || day < 1 || day > 31) return null;

        const now = today();

        let date = new Date(now.getFullYear(), month, day);

        if (date < now) date = new Date(now.getFullYear() + 1, month, day);

        return date;
    }

    // Finds "3 people", "team of 4", "2 of us" in a sentence.
    function findTeam(text) {
        const m = /\b(\d{1,2})\s*(?:people|persons|members|of us|students|friends|developers|devs)\b|\bteam of (\d{1,2})\b/i.exec(text);

        return m ? Math.max(1, Math.min(10, +(m[1] || m[2]))) : null;
    }

    // ---------- simulation ----------
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;

            let t = Math.imul(a ^ (a >>> 15), 1 | a);

            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function triangular(a, m, b, rand) {
        if (b <= a) return a;

        const u = rand();
        const f = (m - a) / (b - a);

        return u < f
            ? a + Math.sqrt(u * (b - a) * (m - a))
            : b - Math.sqrt((1 - u) * (b - a) * (b - m));
    }

    function correlation(x, y) {
        const n = x.length;

        let mx = 0, my = 0;

        for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }

        mx /= n; my /= n;

        let sxy = 0, sxx = 0, syy = 0;

        for (let i = 0; i < n; i++) {
            const dx = x[i] - mx, dy = y[i] - my;

            sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
        }

        return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    }

    function simulate() {
        const active = state.tasks.map((_, i) => i).filter(i => !state.dropped.has(i));

        if (!active.length) return null;

        // Same seed every time, so only your what-ifs change the numbers.
        const rand = mulberry32(20261114);
        const totals = new Float64Array(RUNS);
        const cols = active.map(() => new Float64Array(RUNS));
        const finish = new Array(state.tasks.length).fill(0);

        for (let r = 0; r < RUNS; r++) {
            const workers = new Array(state.team).fill(0);

            let total = 0;

            active.forEach((i, k) => {
                const t = state.tasks[i];
                const dur = triangular(t.best, t.likely, t.worst, rand);

                cols[k][r] = dur;

                let ready = 0;

                t.after.forEach(d => {
                    if (!state.dropped.has(d)) ready = Math.max(ready, finish[d]);
                });

                // The person who becomes free first takes the task.
                let w = 0;

                for (let j = 1; j < workers.length; j++) {
                    if (workers[j] < workers[w]) w = j;
                }

                const end = Math.max(ready, workers[w]) + dur;

                workers[w] = end;
                finish[i] = end;

                if (end > total) total = end;
            });

            totals[r] = total;
        }

        const sorted = Float64Array.from(totals).sort();
        const pct = q => Math.ceil(sorted[Math.min(RUNS - 1, Math.floor(q * RUNS))]);

        const raw = active.map((i, k) => ({
            index: i, corr: Math.max(0, correlation(cols[k], totals))
        }));

        const sumSq = raw.reduce((s, x) => s + x.corr * x.corr, 0) || 1;

        const risks = raw
            .map(x => ({
                index: x.index,
                share: Math.round(100 * x.corr * x.corr / sumSq)
            }))
            .sort((a, b) => b.share - a.share)
            .slice(0, 3);

        return { sorted, p50: pct(0.5), p80: pct(0.8), p90: pct(0.9), risks };
    }

    function effectiveDeadline() {
        if (!state.deadline) return null;

        const d = new Date(state.deadline);

        d.setDate(d.getDate() + 7 * state.extraWeeks);

        return d;
    }

    function chanceOfDeadline(sim) {
        const deadline = effectiveDeadline();

        if (!deadline) return { chance: null, allowed: null };

        const allowed = workdaysBetween(state.start, deadline);

        let hit = 0;

        for (let i = 0; i < sim.sorted.length; i++) {
            if (Math.ceil(sim.sorted[i]) <= allowed) hit++;
        }

        return { chance: Math.round(100 * hit / RUNS), allowed: allowed };
    }

    // The tasks that are still active, with dependency numbers fixed
    // so they still point at the right tasks after some were dropped.
    function activeTasksRenumbered() {
        const map = new Map();

        let next = 0;

        state.tasks.forEach((_, i) => {
            if (!state.dropped.has(i)) map.set(i, next++);
        });

        return state.tasks
            .filter((_, i) => map.has(i))
            .map(t => ({
                name: t.name,
                best: t.best,
                likely: t.likely,
                worst: t.worst,
                after: t.after.filter(d => map.has(d)).map(d => map.get(d))
            }));
    }

    // ---------- chart ----------
    function drawChart(canvas, sim, allowed) {
        const { ctx, width, height } = setupCanvas(canvas);
        const pad = { l: 28, r: 10, t: 10, b: 24 };
        const w = width - pad.l - pad.r;
        const hh = height - pad.t - pad.b;

        const min = Math.ceil(sim.sorted[0]);
        const max = Math.ceil(sim.sorted[sim.sorted.length - 1]);
        const span = max - min + 1;
        const step = Math.max(1, Math.ceil(span / MAX_BINS));
        const bins = Math.ceil(span / step);
        const counts = new Array(bins).fill(0);

        sim.sorted.forEach(v => {
            const b = Math.min(bins - 1, Math.floor((Math.ceil(v) - min) / step));

            counts[b]++;
        });

        const top = Math.max(...counts) || 1;
        const barW = w / bins;

        counts.forEach((c, b) => {
            const lastDay = min + (b + 1) * step - 1;
            const barH = (c / top) * hh;

            ctx.fillStyle = allowed !== null && lastDay <= allowed ? "#4ade80" : "#7c8cff";
            ctx.beginPath();
            ctx.roundRect(pad.l + b * barW + 1, pad.t + hh - barH, Math.max(1, barW - 2), barH, 3);
            ctx.fill();
        });

        if (allowed !== null) {
            const x = pad.l + ((allowed - min + 1) / (bins * step)) * w;

            if (x >= pad.l && x <= pad.l + w) {
                ctx.strokeStyle = "#fbbf24";
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(x, pad.t);
                ctx.lineTo(x, pad.t + hh);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "#fbbf24";
                ctx.font = "11px Manrope, sans-serif";
                ctx.textAlign = x > width - 60 ? "right" : "left";
                ctx.fillText("Deadline", x + (x > width - 60 ? -4 : 4), pad.t + 10);
            }
        }

        ctx.fillStyle = "#9aaa9f";
        ctx.font = "11px Manrope, sans-serif";

        [[0, "left"], [0.5, "center"], [1, "right"]].forEach(([f, align]) => {
            ctx.textAlign = align;
            ctx.fillText(
                fmtDay(addWorkdays(state.start, min + f * (max - min))),
                pad.l + f * w, height - 7
            );
        });
    }

    // ---------- panel ----------
    const descBox = h("textarea", {
        placeholder: "Describe your project in plain words, e.g. 'Build a school website with a login page, a gallery and a contact form.'"
    });
    const deadlineInput = h("input", { type: "date" });
    const teamInput = h("input", { type: "number", min: "1", max: "10", value: "1", style: "width:70px" });
    const projectSelect = h("select", {}, h("option", { value: "", text: "No project" }));
    const runBtn = h("button", { type: "button", class: "kb-upload", text: "Run forecast" });
    const closeBtn = h("button", { type: "button", class: "kb-close", "aria-label": "Close", text: "\u00d7" });
    const status = h("p", { class: "fc-status" });
    const result = h("div", { class: "fc-result" });
    const history = h("div", {});

    result.hidden = true;

    const modal = h("div", { class: "kb-modal", hidden: "" },
        h("div", { class: "kb-card fc-card", role: "dialog", "aria-label": "Forecast" },
            h("div", { class: "kb-head" }, h("h2", { text: "Forecast" }), closeBtn),
            descBox,
            h("div", { class: "fc-row" },
                h("label", {}, "Deadline (optional)", deadlineInput),
                h("label", {}, "People working", teamInput),
                h("label", {}, "Save to project", projectSelect),
                runBtn
            ),
            status,
            result,
            history
        )
    );

    document.body.appendChild(modal);

    function say(text, isError) {
        status.textContent = text || "";
        status.className = "fc-status" + (isError ? " error" : "");
    }

    function readInputs() {
        state.team = Math.max(1, Math.min(10, parseInt(teamInput.value, 10) || 1));
        state.deadline = parseISO(deadlineInput.value);
        state.start = today();
    }

    // ---------- results ----------
    function summaryForSave(sim, chance) {
        const day = n => iso(addWorkdays(state.start, n));

        return {
            p50: day(sim.p50), p80: day(sim.p80), p90: day(sim.p90),
            chance: chance,
            team: state.team,
            dropped: state.dropped.size,
            extra_weeks: state.extraWeeks
        };
    }

    function restoreChips() {
        if (!state.dropped.size) return h("span", {});

        return h("div", { class: "fc-chips" }, [...state.dropped].map(i =>
            h("button", {
                type: "button", class: "fc-btn small", text: "Restore: " + state.tasks[i].name,
                onclick: () => { state.dropped.delete(i); renderResult(); }
            })
        ));
    }

    function renderResult() {
        const sim = simulate();

        state.sim = sim;

        if (!sim) {
            result.replaceChildren(h("p", {
                class: "fc-muted",
                text: "Every task was dropped. Restore one to see a forecast."
            }), restoreChips());

            result.hidden = false;

            return;
        }

        const { chance, allowed } = chanceOfDeadline(sim);

        state.chance = chance;

        const day = n => fmtDay(addWorkdays(state.start, n));
        const deadline = effectiveDeadline();

        const tone = chance === null ? "" : chance >= 80 ? "good" : chance >= 50 ? "mid" : "bad";

        const risky = sim.risks.filter(r => r.share > 0).map(r => {
            const t = state.tasks[r.index];

            return h("div", { class: "fc-risk" },
                h("b", { text: t.name }),
                h("span", { class: "fc-muted", text: `${t.best}-${t.worst} days \u00b7 ${r.share}% of the uncertainty` }),
                h("button", {
                    type: "button", class: "fc-btn small", text: "Drop",
                    onclick: () => { state.dropped.add(r.index); renderResult(); }
                })
            );
        });

        const saveBtn = h("button", {
            type: "button", class: "kb-upload", text: "Save to project",
            onclick: () => saveForecast(saveBtn)
        });

        result.replaceChildren(
            chance === null
                ? h("p", { class: "fc-muted", text: "Add a deadline above to see your chance of meeting it." })
                : h("div", {},
                    h("div", { class: "fc-big " + tone, text: chance + "%" }),
                    h("p", { class: "fc-muted", text: `chance of finishing by ${fmtDay(deadline)}` + (state.extraWeeks ? ` (deadline moved +${state.extraWeeks} week${state.extraWeeks > 1 ? "s" : ""})` : "") })
                ),
            h("canvas", { class: "fc-chart" }),
            h("p", { class: "fc-muted", text: `Likely finish: 50% by ${day(sim.p50)} \u00b7 80% by ${day(sim.p80)} \u00b7 90% by ${day(sim.p90)}. Green bars finish on time. Weekends are skipped. Planned for ${state.team} ${state.team === 1 ? "person" : "people"}.` }),
            h("p", { class: "fc-section", text: "Riskiest tasks" }),
            ...risky,
            h("p", { class: "fc-section", text: "What if...?" }),
            h("div", { class: "fc-chips" },
                state.deadline ? h("button", {
                    type: "button", class: "fc-btn small", text: "Add a week to the deadline",
                    onclick: () => { state.extraWeeks++; renderResult(); }
                }) : null,
                h("button", {
                    type: "button", class: "fc-btn small", text: "Reset what-ifs",
                    onclick: () => { state.dropped.clear(); state.extraWeeks = 0; renderResult(); }
                })
            ),
            restoreChips(),
            h("details", {},
                h("summary", { class: "fc-muted", text: `All ${state.tasks.length} tasks` }),
                ...state.tasks.map((t, i) => h("p", {
                    class: "fc-muted",
                    text: `${i + 1}. ${t.name} (${t.best} / ${t.likely} / ${t.worst} days)` +
                        (t.after.length ? ` \u2013 after ${t.after.map(d => d + 1).join(", ")}` : "") +
                        (state.dropped.has(i) ? " \u2013 dropped" : "")
                }))
            ),
            h("div", { class: "fc-row" }, saveBtn)
        );

        result.hidden = false;

        drawChart(result.querySelector("canvas"), sim, allowed);
    }

    async function saveForecast(button) {
        if (!projectSelect.value) {
            say("Choose a project in \"Save to project\" first.", true);
            return;
        }

        if (!state.sim) return;

        button.disabled = true;

        try {
            await api("/forecast/save", "POST", {
                project_id: Number(projectSelect.value),
                description: state.description,
                deadline: state.deadline ? iso(state.deadline) : "",
                tasks: activeTasksRenumbered(),
                summary: summaryForSave(state.sim, state.chance)
            });

            say("Saved. It now appears in the project timeline.");

            await loadHistory();
        } catch (error) {
            say(error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    // ---------- saved forecasts (compared with each other) ----------
    async function loadHistory() {
        history.replaceChildren();

        if (!projectSelect.value) return;

        try {
            const data = await api("/projects/" + projectSelect.value + "/forecasts");
            const list = data.forecasts;

            if (!list.length) return;

            history.replaceChildren(
                h("p", { class: "fc-section", text: "Saved forecasts for this project" }),
                ...list.map((item, i) => {
                    const s = item.summary;
                    const older = list[i + 1] ? list[i + 1].summary : null;

                    let change = "";

                    if (older && s.chance !== null && older.chance !== null) {
                        const diff = s.chance - older.chance;

                        change = diff === 0 ? " (no change)" : ` (${diff > 0 ? "+" : ""}${diff}% vs before)`;
                    } else if (older && s.p80 && older.p80) {
                        const days = Math.round((parseISO(s.p80) - parseISO(older.p80)) / 86400000);

                        change = days === 0 ? " (no change)" : ` (${days > 0 ? "+" : ""}${days} days vs before)`;
                    }

                    return h("div", { class: "fc-hist" },
                        h("span", { text: fmtDate(item.created_at) }),
                        h("span", {
                            text: (s.chance !== null ? `${s.chance}% by ${item.deadline}` : "No deadline") +
                                ` \u00b7 80% by ${s.p80 || "?"}` + change
                        })
                    );
                })
            );
        } catch (error) {
            console.error(error);
        }
    }

    // ---------- events ----------
    runBtn.addEventListener("click", async () => {
        const description = descBox.value.trim();

        if (description.length < 10) {
            say("Describe your project in a sentence or two.", true);
            return;
        }

        readInputs();

        runBtn.disabled = true;
        runBtn.textContent = "Planning tasks...";
        say("The AI is turning your description into tasks (up to a minute).");

        try {
            const data = await api("/forecast/tasks", "POST", {
                description: description,
                team: state.team,
                project_id: projectSelect.value ? Number(projectSelect.value) : null
            });

            state.tasks = data.tasks;
            state.description = description;
            state.dropped.clear();
            state.extraWeeks = 0;

            say("");
            renderResult();
        } catch (error) {
            say(error.message, true);
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = "Run forecast";
        }
    });

    // Changing the deadline or team size updates the numbers instantly.
    // (Click Run forecast again to let the AI re-split the tasks for a new team size.)
    [deadlineInput, teamInput].forEach(control => {
        control.addEventListener("change", () => {
            if (!state.tasks.length) return;

            readInputs();
            state.extraWeeks = 0;
            renderResult();
        });
    });

    projectSelect.addEventListener("change", loadHistory);

    async function loadProjectList() {
        try {
            const data = await api("/projects");
            const wanted = projectSelect.value || (currentId !== null ? String(currentId) : "");

            projectSelect.replaceChildren(
                h("option", { value: "", text: "No project" }),
                ...data.projects.map(p => h("option", { value: String(p.id), text: p.name }))
            );

            projectSelect.value = wanted;

            if (projectSelect.value !== wanted) projectSelect.value = "";

            await loadHistory();
        } catch (error) {
            console.error(error);
        }
    }

    function openForecast(text) {
        modal.hidden = false;
        say("");

        if (text) {
            descBox.value = text;

            const date = findDate(text);
            const team = findTeam(text);

            if (date) deadlineInput.value = iso(date);
            if (team) teamInput.value = String(team);
        }

        loadProjectList();
        descBox.focus();
    }

    function closeForecast() {
        modal.hidden = true;
    }

    closeBtn.addEventListener("click", closeForecast);

    modal.addEventListener("click", event => {
        if (event.target === modal) closeForecast();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) closeForecast();
    });

    window.addEventListener("resize", () => {
        if (!modal.hidden && state.sim) {
            const canvas = result.querySelector("canvas");

            if (canvas) drawChart(canvas, state.sim, chanceOfDeadline(state.sim).allowed);
        }
    });

    // ---------- sidebar button ----------
    const sidebarButton = document.createElement("button");

    sidebarButton.type = "button";
    sidebarButton.className = "but2";
    sidebarButton.id = "forecast-open";
    sidebarButton.innerHTML = "&#128202; Forecast";

    (document.getElementById("kb-open") || document.getElementById("sim-open"))
        .after(sidebarButton);

    sidebarButton.addEventListener("click", () => openForecast(""));

    // ---------- open from the chat ----------
    // Runs before the normal send handler (capture phase) and stops it.
    form.addEventListener("submit", event => {
        const typed = input.value.trim();

        if (!typed || pendingImage || isSending || isSpeaking) return;

        if (typed.length > 300 || typed.includes("```") || !TRIGGER.test(typed)) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        input.value = "";

        openForecast(typed);
    }, true);
})();

// ==================================================
// VOICE DIALOG: browse 5 voices, preview, and pick one
// ==================================================
(function () {
    const openButton = document.getElementById("voice-open");

    if (!openButton) return;

    let view = voiceIndex;

    const chevron = points =>
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="' +
        points + '"/></svg>';

    const prev = h("button", { type: "button", class: "vd-arrow prev", "aria-label": "Previous voice" });
    const next = h("button", { type: "button", class: "vd-arrow next", "aria-label": "Next voice" });

    prev.innerHTML = chevron("15 18 9 12 15 6");
    next.innerHTML = chevron("9 6 15 12 9 18");

    const nameEl = h("div", { class: "vd-name" });
    const tagEl = h("div", { class: "vd-desc" });
    const countEl = h("div", { class: "vd-count" });
    const sampleEl = h("div", { class: "vd-sample", text: "“Hello. I'm ORBIT. Ready when you are.”" });
    const swatchEl = h("span", { class: "vd-swatch", "aria-hidden": "true" });
    const dots = h("div", { class: "vd-dots" });

    const previewButton = h("button", { type: "button", class: "vd-preview", text: "Preview Voice" });
    const useButton = h("button", { type: "button", class: "vd-use", text: "Use This Voice!" });
    const closeButton = h("button", { type: "button", class: "kb-close", "aria-label": "Close", text: "\u00d7" });

    const modal = h("div", { class: "kb-modal", hidden: "" },
        h("div", { class: "kb-card", role: "dialog", "aria-label": "Choose a voice" },
            h("div", { class: "kb-head" }, h("h2", { text: "Choose a voice" }), closeButton),
            h("p", { class: "kb-hint", text: "Use the arrows to browse voices, then preview one before you pick it." }),
            h("div", { class: "vd-stage" },
                prev,
                h("div", { class: "vd-card" }, swatchEl, nameEl, tagEl, sampleEl, countEl),
                next
            ),
            dots,
            h("div", { class: "vd-actions" }, previewButton, useButton)
        )
    );

    document.body.appendChild(modal);

    const voiceCard = modal.querySelector(".vd-card");
    voiceCard.addEventListener("pointermove", event => {
        const r = voiceCard.getBoundingClientRect();
        const x = (event.clientX - r.left) / r.width;
        const y = (event.clientY - r.top) / r.height;
        voiceCard.style.setProperty("--tilt-x", ((0.5 - y) * 7).toFixed(2) + "deg");
        voiceCard.style.setProperty("--tilt-y", ((x - 0.5) * 9).toFixed(2) + "deg");
        voiceCard.style.setProperty("--glow-x", (x * 100).toFixed(1) + "%");
        voiceCard.style.setProperty("--glow-y", (y * 100).toFixed(1) + "%");
    });
    voiceCard.addEventListener("pointerleave", () => {
        voiceCard.style.setProperty("--tilt-x", "0deg");
        voiceCard.style.setProperty("--tilt-y", "0deg");
        voiceCard.style.setProperty("--glow-x", "50%");
        voiceCard.style.setProperty("--glow-y", "50%");
    });

    function render() {
        const profile = VOICE_PROFILES[view];

        nameEl.textContent = profile.name;
        tagEl.textContent = profile.tag;
        const accent = profile.color || "#65e6a0";
        modal.style.setProperty("--voice-accent", accent);
        swatchEl.style.background = accent;
        swatchEl.style.boxShadow = "0 0 22px " + accent;
        nameEl.style.color = accent;
        countEl.textContent =
            (view + 1) + " / " + VOICE_PROFILES.length + (view === voiceIndex ? " \u00b7 In use" : "");

        dots.replaceChildren(...VOICE_PROFILES.map((_, i) =>
            h("span", { class: "vd-dot" + (i === view ? " on" : "") })
        ));
    }

    function go(step) {
        view = (view + step + VOICE_PROFILES.length) % VOICE_PROFILES.length;
        render();
    }

    function open() {
        view = voiceIndex;
        render();
        modal.hidden = false;
    }

    function close() {
        modal.hidden = true;
        stopSpeaking();
    }

    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    previewButton.addEventListener("click", () => previewVoice(VOICE_PROFILES[view]));

    useButton.addEventListener("click", () => {
        voiceIndex = view;

        saveSetting("orbitVoiceProfile", voiceIndex);
        updateVoiceLabel();
        close();
    });

    openButton.addEventListener("click", open);
    closeButton.addEventListener("click", close);

    modal.addEventListener("click", event => {
        if (event.target === modal) close();
    });

    document.addEventListener("keydown", event => {
        if (modal.hidden) return;

        if (event.key === "Escape") close();
        else if (event.key === "ArrowLeft") go(-1);
        else if (event.key === "ArrowRight") go(1);
    });

    updateVoiceLabel();
})();
// ==================================================
// SETTINGS (gear button, top right)
// Theme (Dark / Light / Cosmic / Auto), text size, reduced motion,
// web search control, voice settings, export / delete chats, log out.

// ==================================================
(function () {
    const STORE_KEY = "orbitSettings";

    const DEFAULTS = {
        theme: "dark",        // dark | light | cosmic | auto
        textSize: "1",        // zoom of the chat messages
        reduceMotion: false,
        webSearch: "auto"     // auto | always | never
    };

    let settings = Object.assign({}, DEFAULTS);

    try {
        const saved = JSON.parse(loadSetting(STORE_KEY) || "{}");

        if (saved && typeof saved === "object") {
            settings = Object.assign(settings, saved);
        }
    } catch (error) {
        // Ignore: defaults are used.
    }

    function save() {
        saveSetting(STORE_KEY, JSON.stringify(settings));
    }

    // ---------- styles ----------
    const style = document.createElement("style");

    style.textContent = `
/* Light mode: flips the whole page, then flips pictures back. */
html.theme-light{filter:invert(1) hue-rotate(180deg);}
html.theme-light img,html.theme-light video,html.theme-light iframe,
html.theme-light .st-keep{filter:invert(1) hue-rotate(180deg);}

/* Cosmic mode: the green accents become deep space purple. */
html.theme-cosmic{filter:hue-rotate(115deg) saturate(1.15);}
html.theme-cosmic img,html.theme-cosmic video,html.theme-cosmic iframe{filter:hue-rotate(-115deg);}

html.st-no-motion *,html.st-no-motion *::before,html.st-no-motion *::after{
 animation:none !important;transition:none !important;scroll-behavior:auto !important;}

#st-gear{position:fixed;top:130px;right:18px;z-index:900;width:40px;height:40px;
 display:flex;align-items:center;justify-content:center;border-radius:12px;
 background:rgba(8,14,10,.85);color:#86efac;border:1px solid rgba(74,222,128,.4);
 cursor:pointer;backdrop-filter:blur(6px);transition:transform .25s,background .2s;}
#st-gear:hover{background:rgba(74,222,128,.18);transform:rotate(45deg);}
#st-gear svg{width:21px;height:21px;}

.st-modal{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;
 justify-content:flex-end;padding:64px 18px 18px;background:rgba(0,0,0,.45);}
.st-modal[hidden]{display:none;}
.st-card{width:min(400px,100%);max-height:calc(100vh - 90px);overflow-y:auto;
 background:#0b110d;color:#e6efe9;border:1px solid rgba(160,230,190,.22);
 border-radius:16px;padding:16px 18px 18px;font-family:inherit;
 box-shadow:0 20px 60px rgba(0,0,0,.55);}
.st-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.st-head h2{margin:0;font-size:18px;}
.st-x{background:none;border:none;color:#9aaa9f;font-size:26px;line-height:1;cursor:pointer;}
.st-x:hover{color:#fff;}
.st-sec{margin:16px 0 6px;font-size:11px;font-weight:800;letter-spacing:.12em;
 text-transform:uppercase;color:#65e6a0;}
.st-row{display:flex;align-items:center;justify-content:space-between;gap:12px;
 padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);}
.st-row b{display:block;font-size:14px;font-weight:700;}
.st-row small{display:block;font-size:12px;color:#9aaa9f;margin-top:2px;}
.st-seg{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px;}
.st-seg button{flex:1;min-width:80px;padding:8px 6px;border-radius:10px;cursor:pointer;
 font-family:inherit;font-size:13px;font-weight:700;color:#cfe0d5;
 background:rgba(255,255,255,.04);border:1px solid rgba(160,230,190,.2);}
.st-seg button:hover{background:rgba(74,222,128,.12);}
.st-seg button.on{background:rgba(74,222,128,.22);color:#86efac;border-color:rgba(74,222,128,.7);}
.st-card select,.st-card input[type=range]{font-family:inherit;}
.st-card select{background:#050807;color:#e6efe9;border:1px solid rgba(160,230,190,.25);
 border-radius:9px;padding:6px 8px;font-size:13px;max-width:170px;}
.st-switch{position:relative;width:42px;height:24px;flex:none;}
.st-switch input{opacity:0;width:0;height:0;}
.st-switch span{position:absolute;inset:0;border-radius:999px;cursor:pointer;
 background:rgba(255,255,255,.15);transition:.2s;}
.st-switch span::before{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;
 border-radius:50%;background:#fff;transition:.2s;}
.st-switch input:checked + span{background:#22c55e;}
.st-switch input:checked + span::before{transform:translateX(18px);}
.st-btn{padding:8px 12px;border-radius:10px;cursor:pointer;font-family:inherit;
 font-size:13px;font-weight:700;color:#86efac;background:rgba(74,222,128,.12);
 border:1px solid rgba(74,222,128,.45);}
.st-btn:hover{background:rgba(74,222,128,.24);}
.st-btn:disabled{opacity:.5;cursor:default;}
.st-btn.danger{color:#ff8a8a;background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.5);}
.st-btn.danger:hover{background:rgba(248,113,113,.22);}
.st-msg{margin:10px 0 0;font-size:12px;color:#9aaa9f;min-height:16px;}
.st-msg.error{color:#ff7b7b;}
@media (max-width:520px){.st-modal{padding:60px 10px 10px;}}
`;

    document.head.appendChild(style);

    // ---------- apply settings ----------
    const darkQuery = window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    function resolvedTheme() {
        if (settings.theme === "auto") {
            return darkQuery && !darkQuery.matches ? "light" : "dark";
        }

        return settings.theme;
    }

    function applySettings() {
        const root = document.documentElement;

        root.classList.remove("theme-light", "theme-cosmic");

        const theme = resolvedTheme();

        if (theme === "light") root.classList.add("theme-light");
        if (theme === "cosmic") root.classList.add("theme-cosmic");

        root.classList.toggle("st-no-motion", !!settings.reduceMotion);

        const zoom = parseFloat(settings.textSize) || 1;

        messages.style.zoom = zoom === 1 ? "" : String(zoom);
    }

    if (darkQuery) {
        const onChange = () => { if (settings.theme === "auto") applySettings(); };

        if (darkQuery.addEventListener) darkQuery.addEventListener("change", onChange);
    }

    applySettings();

    // ---------- web search: auto / always / never ----------
    const previousAuthFetch = authFetch;

    authFetch = function (url, options = {}) {
        if (
            settings.webSearch !== "auto" &&
            typeof url === "string" &&
            url.endsWith("/chat/stream") &&
            typeof options.body === "string"
        ) {
            try {
                const payload = JSON.parse(options.body);

                payload.web_search = settings.webSearch === "always";

                options = Object.assign({}, options, {
                    body: JSON.stringify(payload)
                });
            } catch (error) {
                // Send the request unchanged.
            }
        }

        return previousAuthFetch(url, options);
    };

    // ---------- small UI helpers ----------
    const msg = h("p", { class: "st-msg" });

    function say(text, isError) {
        msg.textContent = text || "";
        msg.className = "st-msg" + (isError ? " error" : "");
    }

    function row(title, hint, control) {
        return h("div", { class: "st-row" },
            h("div", {}, h("b", { text: title }), hint ? h("small", { text: hint }) : null),
            control
        );
    }

    function toggle(checked, onChange) {
        const box = h("input", { type: "checkbox" });

        box.checked = !!checked;
        box.addEventListener("change", () => onChange(box.checked));

        return { box, el: h("label", { class: "st-switch" }, box, h("span", {})) };
    }

    function segmented(options, current, onPick) {
        const wrap = h("div", { class: "st-seg" });

        function paint(value) {
            wrap.querySelectorAll("button").forEach(b => {
                b.classList.toggle("on", b.dataset.value === value);
            });
        }

        options.forEach(([value, label]) => {
            const b = h("button", { type: "button", text: label });

            b.dataset.value = value;
            b.addEventListener("click", () => { onPick(value); paint(value); });
            wrap.append(b);
        });

        paint(current);

        return wrap;
    }

    function select(options, current, onPick) {
        const el = h("select", {});

        options.forEach(([value, label]) => {
            el.append(h("option", { value: value, text: label }));
        });

        el.value = current;
        el.addEventListener("change", () => onPick(el.value));

        return el;
    }

    // ---------- the panel ----------
    const closeBtn = h("button", { type: "button", class: "st-x", "aria-label": "Close", text: "\u00d7" });
    const body = h("div", {});

    const card = h("div", { class: "st-card", role: "dialog", "aria-label": "Settings" },
        h("div", { class: "st-head" }, h("h2", { text: "Settings" }), closeBtn),
        body
    );

    const modal = h("div", { class: "st-modal", hidden: "" }, card);

    document.body.appendChild(modal);

    function build() {
        body.replaceChildren();

        // --- Appearance ---
        body.append(h("div", { class: "st-sec", text: "Appearance" }));

        body.append(segmented(
            [
                ["dark", "\u{1F319} Dark"],
                ["light", "\u2600\uFE0F Light"],
                ["cosmic", "\u{1F52E} Cosmic"],
                ["auto", "\u{1F5A5}\uFE0F Auto"]
            ],
            settings.theme,
            value => { settings.theme = value; save(); applySettings(); }
        ));

        body.append(h("small", {
            class: "st-msg",
            text: "Cosmic is a deep-space purple look. Auto follows your device."
        }));

        body.append(row(
            "Text size", "Size of the messages in the chat",
            select(
                [["0.9", "Small"], ["1", "Normal"], ["1.15", "Large"], ["1.3", "Extra large"]],
                settings.textSize,
                value => { settings.textSize = value; save(); applySettings(); }
            )
        ));

        body.append(row(
            "Reduce motion", "Turns off animations and fades",
            toggle(settings.reduceMotion, on => {
                settings.reduceMotion = on; save(); applySettings();
            }).el
        ));

        // --- Chat ---
        body.append(h("div", { class: "st-sec", text: "Chat" }));

        body.append(row(
            "Web search", "Auto lets ORBIT decide when to search",
            select(
                [["auto", "Auto"], ["always", "Always"], ["never", "Never"]],
                settings.webSearch,
                value => { settings.webSearch = value; save(); }
            )
        ));

        // --- Voice ---
        body.append(h("div", { class: "st-sec", text: "Voice" }));

        const speakToggle = toggle(
            speechCheckbox ? speechCheckbox.checked : speakMode,
            on => {
                if (speechCheckbox) {
                    speechCheckbox.checked = on;
                    speechCheckbox.dispatchEvent(new Event("change"));
                } else {
                    speakMode = on;
                    saveSetting("orbitSpeakMode", on);
                    if (!on) stopSpeaking();
                }
            }
        );

        body.append(row("Read replies aloud", "ORBIT speaks every answer", speakToggle.el));

        const rate = h("input", { type: "range", min: "0.5", max: "1.5", step: "0.1" });
        const rateLabel = h("span", { text: speechRate.toFixed(1) + "x", style: "font-size:12px;color:#9aaa9f;width:34px;text-align:right" });

        rate.value = String(speechRate);
        rate.style.width = "110px";
        rate.addEventListener("input", () => {
            speechRate = parseFloat(rate.value);
            saveSetting("orbitRate", speechRate);
            rateLabel.textContent = speechRate.toFixed(1) + "x";

            if (typeof updateRateLabel === "function") updateRateLabel();
            if (rateRange) rateRange.value = String(speechRate);
        });

        body.append(row("Speaking speed", "", h("div", { style: "display:flex;align-items:center;gap:6px" }, rate, rateLabel)));

        const voiceOpen = document.getElementById("voice-open");

        if (voiceOpen) {
            const current = document.getElementById("voice-current");

            body.append(row(
                "ORBIT's voice",
                current && current.textContent ? "Now: " + current.textContent : "",
                h("button", {
                    type: "button", class: "st-btn", text: "Change",
                    onclick: () => { closePanel(); voiceOpen.click(); }
                })
            ));
        }

        const micAuto = document.getElementById("mic-auto");
        const micLang = document.getElementById("mic-lang");

        if (micAuto) {
            body.append(row(
                "Send voice messages automatically", "Sends when you stop talking",
                toggle(micAuto.checked, on => {
                    micAuto.checked = on;
                    micAuto.dispatchEvent(new Event("change"));
                }).el
            ));
        }

        if (micLang) {
            const options = Array.from(micLang.options).map(o => [o.value, o.textContent]);

            body.append(row(
                "Microphone language", "",
                select(options, micLang.value, value => {
                    micLang.value = value;
                    micLang.dispatchEvent(new Event("change"));
                })
            ));
        }

        // --- Your data ---
        body.append(h("div", { class: "st-sec", text: "Your data" }));

        const exportBtn = h("button", { type: "button", class: "st-btn", text: "Export" });
        const deleteBtn = h("button", { type: "button", class: "st-btn danger", text: "Delete all" });

        exportBtn.addEventListener("click", () => exportChats(exportBtn));
        deleteBtn.addEventListener("click", () => deleteAllChats(deleteBtn));

        body.append(row("Export chats", "Download all your chats as a file", exportBtn));
        body.append(row("Delete all chats", "This can't be undone", deleteBtn));

        // --- Account ---
        body.append(h("div", { class: "st-sec", text: "Account" }));

        body.append(row(
            getStoredUsername() || "Signed in", "Log out on this device",
            h("button", {
                type: "button", class: "st-btn", text: "Log out",
                onclick: () => logoutButton.click()
            })
        ));

        body.append(row(
            "Reset settings", "Back to the default look and options",
            h("button", {
                type: "button", class: "st-btn", text: "Reset",
                onclick: () => {
                    settings = Object.assign({}, DEFAULTS);
                    save();
                    applySettings();
                    build();
                    say("Settings were reset.");
                }
            })
        ));

        body.append(msg);
    }

    // ---------- export / delete chats ----------
    async function exportChats(button) {
        button.disabled = true;
        say("Collecting your chats...");

        try {
            const list = await (await authFetch(`${API}/conversations`)).json();
            const out = [];

            for (const item of list.conversations || []) {
                const res = await authFetch(`${API}/conversations/${item.id}`);
                const data = await res.json();

                out.push({
                    title: item.title,
                    created_at: item.created_at,
                    messages: (data.messages || []).map(m => ({
                        role: m.role,
                        content: m.content,
                        created_at: m.created_at
                    }))
                });
            }

            const url = URL.createObjectURL(new Blob(
                [JSON.stringify({ exported_at: new Date().toISOString(), chats: out }, null, 2)],
                { type: "application/json" }
            ));

            const link = h("a", { href: url, download: "orbit-chats.json" });

            document.body.append(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            say("Exported " + out.length + " chat" + (out.length === 1 ? "" : "s") + ".");
        } catch (error) {
            console.error(error);
            say("Export failed: " + error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    async function deleteAllChats(button) {
        if (isSending || isSpeaking) {
            say("Wait for ORBIT to finish first.", true);
            return;
        }

        if (!confirm("Delete ALL your chats? This can't be undone.")) return;
        if (!confirm("Are you really sure? Every chat will be removed.")) return;

        button.disabled = true;
        say("Deleting...");

        try {
            const list = await (await authFetch(`${API}/conversations`)).json();

            for (const item of list.conversations || []) {
                await authFetch(`${API}/conversations/${item.id}`, { method: "DELETE" });
            }

            currentConversationId = null;
            clearMessages();
            await loadConversationList();

            say("All chats were deleted.");
        } catch (error) {
            console.error(error);
            say("Could not delete everything: " + error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    // ---------- gear button ----------
    const gear = document.createElement("button");

    gear.type = "button";
    gear.id = "st-gear";
    gear.title = "Settings";
    gear.setAttribute("aria-label", "Settings");
    gear.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
        "</svg>";

    document.body.appendChild(gear);

    function openPanel() {
        say("");
        build();
        modal.hidden = false;
    }

    function closePanel() {
        modal.hidden = true;
    }

    gear.addEventListener("click", () => {
        if (modal.hidden) openPanel(); else closePanel();
    });

    closeBtn.addEventListener("click", closePanel);

    modal.addEventListener("click", event => {
        if (event.target === modal) closePanel();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) closePanel();
    });
})();
// ==================================================
// REGENERATE + COPY BUTTONS
//  * "Regenerate" and "Copy" under ORBIT's latest reply
//  * "Copy code" button on every code block

// (needs the /last-exchange route in app.py)
// ==================================================
(function () {
    // ---------- styles ----------
    const style = document.createElement("style");

    style.textContent = `
.code-wrap{margin:10px 0;border-radius:10px;overflow:hidden;
 border:1px solid rgba(160,230,190,.22);background:rgba(0,0,0,.35);}
.code-head{display:flex;align-items:center;justify-content:space-between;
 padding:5px 10px;background:rgba(255,255,255,.07);font-size:12px;
 color:#9aaa9f;font-family:inherit;}
.code-copy,.regen-btn{display:inline-flex;align-items:center;gap:5px;
 padding:4px 10px;border-radius:8px;cursor:pointer;font-family:inherit;
 font-size:12px;font-weight:700;color:#86efac;background:transparent;
 border:1px solid rgba(74,222,128,.4);}
.code-copy:hover,.regen-btn:hover{background:rgba(74,222,128,.15);}
.code-copy.done,.regen-btn.done{color:#fff;background:rgba(34,197,94,.35);}
.code-wrap pre{margin:0 !important;border:none !important;border-radius:0 !important;
 overflow-x:auto;}
.regen-bar{display:flex;gap:8px;margin-top:8px;}
.regen-btn svg{width:13px;height:13px;}
`;

    document.head.appendChild(style);

    // ---------- copy helper ----------
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            // Fallback for browsers/pages without clipboard permission.
            const area = document.createElement("textarea");

            area.value = text;
            area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";

            document.body.appendChild(area);
            area.select();

            let ok = false;

            try { ok = document.execCommand("copy"); } catch (e) { /* ignore */ }

            area.remove();

            return ok;
        }
    }

    function flash(button, okText, normalText, ok) {
        button.textContent = ok ? okText : "Failed";
        button.classList.toggle("done", ok);

        setTimeout(() => {
            button.textContent = normalText;
            button.classList.remove("done");
        }, 1500);
    }

    // ---------- 1. COPY CODE ----------
    function addCopyButtons(root) {
        if (!root || !root.querySelectorAll) return;

        root.querySelectorAll("pre").forEach(pre => {
            if (pre.parentElement && pre.parentElement.classList.contains("code-wrap")) {
                return;
            }

            const code = pre.querySelector("code");
            const match = code && /language-([\w+#.-]+)/.exec(code.className || "");

            const label = h("span", { text: match ? match[1] : "code" });
            const button = h("button", { type: "button", class: "code-copy", text: "Copy code" });

            button.addEventListener("click", async () => {
                const text = (code || pre).textContent.replace(/\n$/, "");

                flash(button, "Copied!", "Copy code", await copyText(text));
            });

            const wrap = h("div", { class: "code-wrap" }, h("div", { class: "code-head" }, label, button));

            pre.replaceWith(wrap);
            wrap.append(pre);
        });
    }

    // Runs after every formatted reply (chat, Screen Watch and Coach too).
    const plainRenderMessage = renderMessage;

    renderMessage = async function (contentElement, text) {
        await plainRenderMessage(contentElement, text);

        addCopyButtons(contentElement);
    };

    // ---------- 2. REGENERATE ----------
    const REMOVED_TEXT = "(Message removed by Safety Shield)";

    // Remember which bubbles are real replies (not "Thinking..." or errors).
    const plainAddMessage = addMessage;

    addMessage = function (sender, text, plain = false, imageUrl = null) {
        const element = plainAddMessage(sender, text, plain, imageUrl);

        if (sender === "ORBIT" && !plain) {
            element.dataset.reply = "1";
        } else if (sender === "You") {
            element.dataset.raw = text;
        }

        return element;
    };

    const REGEN_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="23 4 23 10 17 10"/>' +
        '<path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>';

    async function regenerate(replyEl, userEl) {
        if (isSending) return;

        if (isSpeaking) stopSpeaking();

        if (currentConversationId === null) return;

        const text = userEl.dataset.raw || "";
        const picture = userEl.querySelector(".message-image");
        const imageUrl = picture ? picture.getAttribute("src") : null;

        if (!text) return;

        const draft = input.value;
        const draftImage = pendingImage;

        try {
            const response = await authFetch(
                `${API}/conversations/${currentConversationId}/last-exchange`,
                { method: "DELETE" }
            );

            if (!response.ok) {
                let data = {};

                try { data = await response.json(); } catch (e) { /* ignore */ }

                throw new Error(
                    data.error ||
                    "The server could not do this (is the /last-exchange route in app.py?)."
                );
            }
        } catch (error) {
            console.error(error);
            alert("Could not regenerate: " + error.message);
            return;
        }

        replyEl.remove();
        userEl.remove();

        // Send the same question again through the normal send code.
        input.value = text;

        setPendingImage(
            imageUrl && imageUrl.startsWith("data:image/")
                ? { dataUrl: imageUrl, name: "Image" }
                : null
        );

        form.requestSubmit();

        // The send code has already taken the message; put back anything
        // the person was typing.
        if (draft) input.value = draft;
        if (draftImage) setPendingImage(draftImage);
    }

    function refreshBars() {
        messages.querySelectorAll(".regen-bar").forEach(bar => bar.remove());

        const last = messages.lastElementChild;

        if (!last || last.dataset.reply !== "1") return;

        const userEl = last.previousElementSibling;

        if (
            !userEl ||
            !userEl.classList.contains("user-message") ||
            userEl.dataset.raw === REMOVED_TEXT
        ) {
            return;
        }

        const body = last.querySelector(".message-body");

        if (!body) return;

        const regenButton = h("button", { type: "button", class: "regen-btn", title: "Get a new answer" });

        regenButton.innerHTML = REGEN_ICON + " Regenerate";
        regenButton.addEventListener("click", () => regenerate(last, userEl));

        const copyButton = h("button", { type: "button", class: "regen-btn", text: "Copy" });

        copyButton.addEventListener("click", async () => {
            const content = last.querySelector(".message-content");
            const ok = await copyText(content ? content.innerText.trim() : "");

            flash(copyButton, "Copied!", "Copy", ok);
        });

        body.append(h("div", { class: "regen-bar" }, regenButton, copyButton));
    }

    // Runs whenever messages are added or removed.
    new MutationObserver(refreshBars).observe(messages, { childList: true });

    refreshBars();
})();
// ==================================================
// SIDEBAR STAYS OPEN FOR 5 SECONDS AFTER HOVER
// ==================================================
(function () {
    const PIN_MS = 5000;   // how long the sidebar stays open after the mouse leaves

    function collect(rules, sidebar) {
        let css = "";

        for (const rule of rules) {
            try {
                if (rule.type === 1) {                       // normal style rule
                    const picked = [];

                    rule.selectorText.split(",").forEach(selector => {
                        const at = selector.indexOf(":hover");

                        if (at < 0) return;

                        const prefix = selector.slice(0, at).trim();

                        if (!prefix) return;

                        try {
                            if (sidebar.matches(prefix)) {
                                picked.push(selector.trim().replace(/:hover/g, ".sb-pinned"));
                            }
                        } catch (error) {
                            // Selector the browser can't test: skip it.
                        }
                    });

                    if (picked.length) {
                        css += picked.join(",") + "{" + rule.style.cssText + "}\n";
                    }

                } else if (rule.cssRules && (rule.type === 4 || rule.type === 12)) {
                    const inner = collect(rule.cssRules, sidebar);

                    if (inner) {
                        const head = rule.type === 4
                            ? "@media " + rule.media.mediaText
                            : "@supports " + rule.conditionText;

                        css += head + "{" + inner + "}\n";
                    }
                }
            } catch (error) {
                // Ignore rules that can't be read.
            }
        }

        return css;
    }

    function collectAll(sidebar) {
        let css = "";

        Array.from(document.styleSheets).forEach(sheet => {
            try {
                css += collect(sheet.cssRules, sidebar);
            } catch (error) {
                // Cross-origin style sheet: can't be read, skip it.
            }
        });

        return css;
    }

    function setup() {
        const start = document.querySelector(".but1") ||
            document.getElementById("conversation-container");

        if (!start) return;

        // Find the sidebar: the outermost parent that has hover rules.
        let sidebar = null;
        let pinnedCss = "";

        for (let el = start.parentElement; el && el !== document.body; el = el.parentElement) {
            const css = collectAll(el);

            if (css) {
                sidebar = el;
                pinnedCss = css;
            }
        }

        if (!sidebar) {
            console.info("Sidebar pin: no hover rules found for the sidebar.");
            return;
        }

        const style = document.createElement("style");

        style.textContent = pinnedCss;
        document.head.appendChild(style);

        let timer = null;

        sidebar.addEventListener("mouseenter", () => {
            clearTimeout(timer);
            sidebar.classList.add("sb-pinned");
        });

        sidebar.addEventListener("mouseleave", () => {
            clearTimeout(timer);

            timer = setTimeout(() => {
                sidebar.classList.remove("sb-pinned");
            }, PIN_MS);
        });
    }

    if (document.readyState === "complete") {
        setup();
    } else {
        window.addEventListener("load", setup);
    }
})();
// ==================================================
// PROMPT HISTORY (list of your prompts in this chat)
// A button next to the settings gear opens a panel listing every
// prompt you sent in the open chat. Click one to jump to it.
//=======
(function () {
    const OPEN_KEY = "orbitPromptPanel";

    // ---------- styles ----------
    const style = document.createElement("style");

    style.textContent = `
#ph-toggle{position:fixed;top:90px;right:18px;z-index:900;width:40px;height:40px;
 display:flex;align-items:center;justify-content:center;border-radius:12px;
 background:rgba(8,14,10,.85);color:#86efac;border:1px solid rgba(74,222,128,.4);
 cursor:pointer;backdrop-filter:blur(6px);transition:background .2s;}
#ph-toggle:hover,#ph-toggle.on{background:rgba(74,222,128,.18);}
#ph-toggle svg{width:20px;height:20px;}

#ph-panel{position:fixed;top:64px;right:18px;z-index:850;width:min(290px,calc(100vw - 36px));
 max-height:calc(100vh - 90px);display:flex;flex-direction:column;
 background:#0b110d;color:#e6efe9;border:1px solid rgba(160,230,190,.22);
 border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);font-family:inherit;}
#ph-panel[hidden]{display:none;}
.ph-head{display:flex;align-items:center;justify-content:space-between;
 padding:12px 14px 8px;}
.ph-head b{font-size:14px;}
.ph-count{font-size:12px;color:#9aaa9f;}
.ph-list{overflow-y:auto;padding:0 8px 10px;display:flex;flex-direction:column;gap:3px;}
.ph-item{display:flex;gap:8px;align-items:flex-start;text-align:left;width:100%;
 padding:8px 9px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:13px;
 line-height:1.35;color:#cfe0d5;background:transparent;border:1px solid transparent;}
.ph-item:hover{background:rgba(74,222,128,.1);}
.ph-item.active{background:rgba(74,222,128,.18);border-color:rgba(74,222,128,.5);color:#fff;}
.ph-num{flex:none;min-width:20px;color:#65e6a0;font-weight:800;font-size:12px;padding-top:1px;}
.ph-text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
 word-break:break-word;}
.ph-empty{padding:14px;font-size:13px;color:#9aaa9f;text-align:center;}

@keyframes ph-flash{0%{box-shadow:0 0 0 2px rgba(74,222,128,.9);}100%{box-shadow:0 0 0 2px rgba(74,222,128,0);}}
.ph-flash{animation:ph-flash 1.3s ease-out;border-radius:12px;}
`;

    document.head.appendChild(style);

    // ---------- elements ----------
    const toggle = document.createElement("button");

    toggle.type = "button";
    toggle.id = "ph-toggle";
    toggle.title = "Prompt history";
    toggle.setAttribute("aria-label", "Prompt history");
    toggle.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>' +
        '<line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>' +
        '<line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';

    const count = h("span", { class: "ph-count" });
    const list = h("div", { class: "ph-list" });

    const panel = h("div", { id: "ph-panel", hidden: "", role: "region", "aria-label": "Prompt history" },
        h("div", { class: "ph-head" }, h("b", { text: "Prompts in this chat" }), count),
        list
    );

    document.body.append(toggle, panel);

    // ---------- build the list ----------
    let items = [];   // [{ el, button }]

    function build() {
        const users = Array.from(messages.querySelectorAll(".user-message"));

        items = [];

        count.textContent = users.length ? String(users.length) : "";

        if (!users.length) {
            list.replaceChildren(h("p", { class: "ph-empty", text: "No prompts yet." }));
            return;
        }

        const buttons = users.map((el, index) => {
            const content = el.querySelector(".message-content");
            let text = content ? content.textContent.trim().replace(/\s+/g, " ") : "";

            if (el.querySelector(".message-image")) text = "\u{1F4F7} " + text;

            const button = h("button", { type: "button", class: "ph-item", title: text },
                h("span", { class: "ph-num", text: String(index + 1) }),
                h("span", { class: "ph-text", text: text || "(empty)" })
            );

            button.addEventListener("click", () => jumpTo(el));

            items.push({ el, button });

            return button;
        });

        list.replaceChildren(...buttons);

        updateActive();
    }

    // ---------- jump to a prompt ----------
    function jumpTo(el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });

        el.classList.remove("ph-flash");

        // Restart the highlight animation.
        void el.offsetWidth;

        el.classList.add("ph-flash");

        setTimeout(() => el.classList.remove("ph-flash"), 1400);
    }

    // ---------- highlight the prompt you are looking at ----------
    let ticking = false;

    function updateActive() {
        ticking = false;

        if (!items.length) return;

        const top = messages.getBoundingClientRect().top + 60;

        let current = items[0];

        for (const item of items) {
            if (item.el.getBoundingClientRect().top <= top) current = item;
            else break;
        }

        items.forEach(item => item.button.classList.toggle("active", item === current));

        if (!panel.hidden) {
            const button = current.button;
            const box = list.getBoundingClientRect();
            const rect = button.getBoundingClientRect();

            if (rect.top < box.top || rect.bottom > box.bottom) {
                button.scrollIntoView({ block: "nearest" });
            }
        }
    }

    messages.addEventListener("scroll", () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(updateActive);
        }
    });

    // Rebuild whenever messages are added or removed
    // (new chat, opening a chat, sending, regenerating, deleting).
    new MutationObserver(build).observe(messages, { childList: true });

    build();

    // ---------- open / close ----------
    function setOpen(open) {
        panel.hidden = !open;
        toggle.classList.toggle("on", open);

        saveSetting(OPEN_KEY, open ? "1" : "0");

        if (open) updateActive();
    }

    toggle.addEventListener("click", () => setOpen(panel.hidden));

    setOpen(loadSetting(OPEN_KEY) === "1");
})();
// ==================================================
// SHOW SETTINGS + PROMPT HISTORY ONLY IN THE MAIN CHAT (v3)

// (replaces the earlier versions)
// ==================================================
(function () {
    function isShown(el) {
        if (!el || el.hidden) return false;

        const css = getComputedStyle(el);

        return css.display !== "none" && css.visibility !== "hidden";
    }

    function setHidden(el, hide) {
        if (!el) return;

        if (hide) {
            el.style.setProperty("display", "none", "important");
        } else {
            el.style.removeProperty("display");
        }
    }

    function update() {
        const overlayOpen =
            isShown(document.getElementById("sim-app")) ||
            Array.from(document.querySelectorAll(".kb-modal")).some(isShown);

        setHidden(document.getElementById("st-gear"), overlayOpen);
        setHidden(document.getElementById("ph-toggle"), overlayOpen);
        setHidden(document.getElementById("ph-panel"), overlayOpen);
    }

    // Instant reaction when the Simulator is opened or closed.
    ["sim-open", "sim-close"].forEach(id => {
        const button = document.getElementById(id);

        if (button) button.addEventListener("click", () => setTimeout(update, 0));
    });

    new MutationObserver(update).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["hidden", "class", "style"]
    });

    setInterval(update, 300);

    update();
})();
// ==================================================
// EVEN SPACING FOR THE RIGHT-SIDE BUTTONS

// ==================================================
(function () {
    const TOP = 90;      // distance of the first button from the top (px)
    const SIZE = 40;     // button size (px)
    const GAP = 12;      // space between the two buttons (px)
    const RIGHT = 18;    // distance from the right edge (px)

    const style = document.createElement("style");

    style.textContent =
        "#ph-toggle{top:" + TOP + "px !important;right:" + RIGHT + "px !important;" +
        "width:" + SIZE + "px !important;height:" + SIZE + "px !important;}" +
        "#st-gear{top:" + (TOP + SIZE + GAP) + "px !important;right:" + RIGHT + "px !important;" +
        "width:" + SIZE + "px !important;height:" + SIZE + "px !important;}" +
        // Opens the prompt list to the LEFT of the buttons instead of over them.
        "#ph-panel{right:" + (RIGHT + SIZE + 10) + "px !important;top:" + TOP + "px !important;}";

    document.head.appendChild(style);
})();
// ==================================================
// USE THE BODY FONT EVERYWHERE (v1)
// Simulator, dialogs, settings, forms, buttons, charts...

// ==================================================
(function () {
    // The font your page body really uses.
    const bodyFont = getComputedStyle(document.body).fontFamily;

    document.documentElement.style.setProperty("--orbit-font", bodyFont);

    const style = document.createElement("style");

    // Code blocks and math keep their own fonts so they stay readable.
    style.textContent =
        "body, body *:not(code):not(pre):not(pre *):not(.katex):not(.katex *)" +
        "{font-family:var(--orbit-font) !important;}" +
        "button,input,textarea,select,option,optgroup,summary,label" +
        "{font-family:var(--orbit-font) !important;}";

    document.head.appendChild(style);

    // The charts draw text on a <canvas> with "Manrope" written in the
    // code. Swap that for the body font every time a chart is set up.
    const plainSetupCanvas = setupCanvas;

    setupCanvas = function (canvas) {
        const result = plainSetupCanvas(canvas);
        const ctx = result.ctx;

        const proto = Object.getPrototypeOf(ctx);
        const descriptor = Object.getOwnPropertyDescriptor(proto, "font");

        if (descriptor && descriptor.set) {
            Object.defineProperty(ctx, "font", {
                configurable: true,
                get() {
                    return descriptor.get.call(ctx);
                },
                set(value) {
                    descriptor.set.call(
                        ctx,
                        String(value).replace(
                            /Manrope,\s*sans-serif/g,
                            bodyFont
                        )
                    );
                }
            });
        }

        return result;
    };
})();
// ==================================================
// BODY FONT ON PSEUDO-ELEMENTS + SVG TEXT (fixes "ORBIT" in the greeting)
// Paste at the very end of chatinterface.js
// ==================================================
(function () {
    const style = document.createElement("style");

    style.textContent =
        "body *::before, body *::after," +
        "svg text, svg tspan" +
        "{font-family:var(--orbit-font) !important;}" +
        // Keep code and math fonts as they were.
        "code::before, code::after, pre::before, pre::after," +
        ".katex *::before, .katex *::after" +
        "{font-family:revert !important;}";

    document.head.appendChild(style);
})();

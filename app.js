/* CHTAVIED.NDA AI — front-end (no framework, no build step) */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const EXPERTS = [
    { key: "master", label: "MASTER AI", hint: "अपने आप सही विशेषज्ञ चुनता है" },
    { key: "writer", label: "लेखक", hint: "कविता, ईमेल, निबंध" },
    { key: "tutor", label: "ट्यूटर", hint: "पढ़ाई, सवाल-जवाब" },
    { key: "coder", label: "कोडर", hint: "प्रोग्रामिंग, बग" },
    { key: "planner", label: "प्लानर", hint: "योजना, समय-सारणी" },
    { key: "translator", label: "अनुवादक", hint: "हिंदी ⇄ अंग्रेज़ी" },
    { key: "maths", label: "गणित", hint: "हिसाब, सूत्र" },
    { key: "career", label: "करियर", hint: "नौकरी, पढ़ाई के बाद" },
  ];

  const els = {
    sidebar: $("sidebar"), scrim: $("scrim"), menuBtn: $("menuBtn"), closeSidebar: $("closeSidebar"),
    newChatBtn: $("newChatBtn"), clearAllBtn: $("clearAllBtn"), chatList: $("chatList"),
    chatTitle: $("chatTitle"), topbarSub: $("topbarSub"), messages: $("messages"), welcome: $("welcome"),
    suggestions: $("suggestions"), expertStrip: $("expertStrip"), composer: $("composer"),
    input: $("input"), sendBtn: $("sendBtn"), attachBtn: $("attachBtn"), fileInput: $("fileInput"),
    attachPreview: $("attachPreview"), attachImg: $("attachImg"), removeAttach: $("removeAttach"),
    micBtn: $("micBtn"), themeBtn: $("themeBtn"), modelSelect: $("modelSelect"),
    userAvatar: $("userAvatar"), userName: $("userName"), userSub: $("userSub"),
    toast: $("toast"), banner: $("setupBanner"), setupText: $("setupText"),
  };

  let cfg = { anyProviderReady: false, providers: {} };
  let chats = [];
  let currentId = null;
  let expert = "master";
  let pendingImage = null;
  let busy = false;
  let recognition = null;

  const THEME_KEY = "chta_theme";
  const CHATS_KEY = "chta_chats_v1";
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* --------------------------------------------------------------- helpers */
  function loadJson(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function saveChats() {
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); }
    catch (e) { toast("स्टोरेज भर गया — पुरानी चैट हटाइए।", true); }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  let toastTimer = null;
  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle("error", Boolean(isError));
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6500);
  }

  function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inline(t) {
    return t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function renderMarkdown(raw) {
    const blocks = [];
    let text = raw.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push("<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
      return "\u0000B" + (blocks.length - 1) + "\u0000";
    });
    text = escapeHtml(text);
    const lines = text.split("\n");
    let html = "", listType = null;
    const closeList = () => { if (listType) { html += listType === "ul" ? "</ul>" : "</ol>"; listType = null; } };
    lines.forEach((line) => {
      const t = line.trim();
      if (!t) { closeList(); return; }
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); const lv = Math.min(h[1].length + 1, 4); html += `<h${lv}>${inline(h[2])}</h${lv}>`; return; }
      const b = t.match(/^[-*•]\s+(.*)$/);
      if (b) { if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; } html += "<li>" + inline(b[1]) + "</li>"; return; }
      const n = t.match(/^\d+[.)]\s+(.*)$/);
      if (n) { if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; } html += "<li>" + inline(n[1]) + "</li>"; return; }
      const q = t.match(/^&gt;\s?(.*)$/);
      if (q) { closeList(); html += "<blockquote>" + inline(q[1]) + "</blockquote>"; return; }
      closeList();
      html += "<p>" + inline(t) + "</p>";
    });
    closeList();
    return html.replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
  }
  function plainText(markdown) {
    return markdown
      .replace(/```[\s\S]*?```/g, " कोड ब्लॉक। ")
      .replace(/[*#`>_]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ------------------------------------------------------------- speech out */
  let speakingBtn = null;

  function pickVoice(lang) {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    return (
      voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang && v.lang.replace("_", "-").startsWith(lang.slice(0, 2))) ||
      voices.find((v) => v.default) ||
      null
    );
  }

  function stopSpeaking() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (speakingBtn) {
      speakingBtn.classList.remove("speaking");
      speakingBtn.textContent = "🔊 सुनें";
      speakingBtn = null;
    }
  }

  function speak(text, button) {
    if (!window.speechSynthesis) {
      toast("इस ब्राउज़र में आवाज़ सुविधा नहीं है।", true);
      return;
    }
    if (speakingBtn === button) { stopSpeaking(); return; }
    stopSpeaking();

    const clean = plainText(text);
    if (!clean) return;

    const lang = /[\u0900-\u097F]/.test(clean) ? "hi-IN" : "en-IN";
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      if (speakingBtn === button) {
        button.classList.remove("speaking");
        button.textContent = "🔊 सुनें";
        speakingBtn = null;
      }
    };
    utterance.onerror = () => {
      button.classList.remove("speaking");
      button.textContent = "🔊 सुनें";
      speakingBtn = null;
    };

    button.classList.add("speaking");
    button.textContent = "⏹ रोकें";
    speakingBtn = button;
    window.speechSynthesis.speak(utterance);
  }

  if (window.speechSynthesis) {
    // Voices load asynchronously in most browsers.
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  /* ----------------------------------------------------------------- chats */
  const activeChat = () => chats.find((c) => c.id === currentId) || null;

  function titleFrom(text) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "फोटो चैट";
    return clean.length > 42 ? clean.slice(0, 42) + "…" : clean;
  }

  function newChat() {
    const chat = { id: uid(), title: "नई चैट", createdAt: Date.now(), messages: [] };
    chats.unshift(chat);
    currentId = chat.id;
    saveChats(); renderChatList(); renderMessages(); closeSidebar();
    els.input.focus();
  }

  function openChat(id) { currentId = id; stopSpeaking(); renderChatList(); renderMessages(); closeSidebar(); }

  function deleteChat(id) {
    chats = chats.filter((c) => c.id !== id);
    if (currentId === id) currentId = chats.length ? chats[0].id : null;
    saveChats(); renderChatList(); renderMessages();
  }

  function renderChatList() {
    els.chatList.innerHTML = "";
    chats.forEach((chat) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-item" + (chat.id === currentId ? " active" : "");
      const label = document.createElement("span");
      label.textContent = chat.title;
      const del = document.createElement("button");
      del.type = "button"; del.className = "del"; del.textContent = "×"; del.title = "हटाएँ";
      del.addEventListener("click", (ev) => { ev.stopPropagation(); deleteChat(chat.id); });
      item.append(label, del);
      item.addEventListener("click", () => openChat(chat.id));
      els.chatList.appendChild(item);
    });
  }

  /* -------------------------------------------------------------- messages */
  function addMessageEl(message, animate) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + message.role;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = message.role === "assistant" ? "C" : "आ";
    wrap.appendChild(avatar);

    const body = document.createElement("div");

    if (Array.isArray(message.images) && message.images.length) {
      message.images.forEach((src) => {
        const img = document.createElement("img");
        img.src = src; img.alt = "attached";
        body.appendChild(img);
      });
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    body.appendChild(bubble);

    if (message.role === "assistant") {
      const tools = document.createElement("div");
      tools.className = "msg-tools";

      const speakBtn = document.createElement("button");
      speakBtn.type = "button";
      speakBtn.textContent = "🔊 सुनें";
      speakBtn.addEventListener("click", () => speak(message.text, speakBtn));
      tools.appendChild(speakBtn);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.textContent = "कॉपी";
      copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(message.text || ""); toast("कॉपी हो गया"); }
        catch (e) { toast("कॉपी नहीं हो पाया", true); }
      });
      tools.appendChild(copyBtn);

      body.appendChild(tools);
    }

    wrap.appendChild(body);
    els.messages.appendChild(wrap);

    if (message.role === "assistant" && animate) {
      typeInto(bubble, message.text || "");
    } else if (message.role === "assistant") {
      bubble.innerHTML = renderMarkdown(message.text || "");
    } else {
      bubble.textContent = message.text || "";
    }
  }

  // Reveals the answer progressively so it feels live.
  function typeInto(bubble, fullText) {
    let i = 0;
    const step = Math.max(3, Math.round(fullText.length / 90));
    const timer = setInterval(() => {
      i += step;
      bubble.innerHTML = renderMarkdown(fullText.slice(0, i));
      scrollToBottom();
      if (i >= fullText.length) {
        clearInterval(timer);
        bubble.innerHTML = renderMarkdown(fullText);
      }
    }, 24);
  }

  function renderMessages() {
    const chat = activeChat();
    els.messages.innerHTML = "";
    if (!chat || chat.messages.length === 0) {
      els.messages.appendChild(els.welcome);
      els.welcome.hidden = false;
      els.chatTitle.textContent = "नई चैट";
      return;
    }
    els.welcome.hidden = true;
    chat.messages.forEach((m) => addMessageEl(m, false));
    els.chatTitle.textContent = chat.title;
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
  }

  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    wrap.id = "typingRow";
    wrap.innerHTML = '<div class="msg-avatar">C</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    els.messages.appendChild(wrap);
    scrollToBottom();
  }
  function hideTyping() { const r = $("typingRow"); if (r) r.remove(); }

  /* ------------------------------------------------------------------ send */
  async function send(text) {
    const trimmed = (text || "").trim();
    if ((!trimmed && !pendingImage) || busy) return;
    if (!activeChat()) newChat();
    const chat = activeChat();

    const message = { role: "user", text: trimmed, images: pendingImage ? [pendingImage] : [], ts: Date.now() };
    chat.messages.push(message);
    if (chat.messages.filter((m) => m.role === "user").length === 1) chat.title = titleFrom(trimmed);
    saveChats(); renderChatList();

    els.messages.appendChild(els.welcome);
    els.welcome.hidden = true;
    addMessageEl(message, false);
    els.chatTitle.textContent = chat.title;

    clearAttachment();
    els.input.value = "";
    autoResize();

    busy = true;
    els.sendBtn.disabled = true;
    showTyping();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expert,
          model: els.modelSelect.value,
          messages: chat.messages.map((m) => ({ role: m.role, text: m.text, images: m.images || [] })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      hideTyping();

      if (!res.ok) {
        toast(data.error || "अनुरोध विफल (" + res.status + ")", true);
        return;
      }

      const reply = { role: "assistant", text: data.reply, ts: Date.now(), expert, model: data.model };
      chat.messages.push(reply);
      saveChats();
      addMessageEl(reply, true);
      scrollToBottom();
    } catch (err) {
      hideTyping();
      toast("इंटरनेट या सर्वर की समस्या: " + err.message, true);
    } finally {
      busy = false;
      els.sendBtn.disabled = false;
      els.input.focus();
    }
  }

  /* -------------------------------------------------------------- composer */
  function autoResize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 150) + "px";
  }
  els.input.addEventListener("input", autoResize);
  els.input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(els.input.value); }
  });
  els.composer.addEventListener("submit", (ev) => { ev.preventDefault(); send(els.input.value); });
  els.suggestions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".suggestion");
    if (btn) send(btn.dataset.prompt || btn.textContent);
  });

  /* ---------------------------------------------------------------- experts */
  function renderExperts() {
    els.expertStrip.innerHTML = "";
    EXPERTS.forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "expert-chip" + (item.key === expert ? " active" : "");
      chip.textContent = item.label;
      chip.title = item.hint;
      chip.addEventListener("click", () => {
        expert = item.key;
        renderExperts();
        els.topbarSub.textContent = item.label + " · तैयार";
      });
      els.expertStrip.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------- attachment */
  els.attachBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    els.fileInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("सिर्फ़ फोटो भेज सकते हैं।", true); return; }
    if (file.size > 4 * 1024 * 1024) { toast("फोटो 4 MB से छोटी होनी चाहिए।", true); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1024;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        pendingImage = canvas.toDataURL("image/jpeg", 0.85);
        els.attachImg.src = pendingImage;
        els.attachPreview.hidden = false;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  function clearAttachment() {
    pendingImage = null;
    els.attachPreview.hidden = true;
    els.attachImg.removeAttribute("src");
  }
  els.removeAttach.addEventListener("click", clearAttachment);

  /* --------------------------------------------------------------- voice in */
  els.micBtn.addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("इस ब्राउज़र में आवाज़ से लिखने की सुविधा नहीं है।", true); return; }

    if (recognition) {
      recognition.stop();
      recognition = null;
      els.micBtn.classList.remove("listening");
      return;
    }

    recognition = new SR();
    recognition.lang = /[\u0900-\u097F]/.test(els.input.value) ? "hi-IN" : "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      els.input.value = text;
      autoResize();
    };
    recognition.onerror = () => {
      els.micBtn.classList.remove("listening");
      recognition = null;
      toast("आवाज़ नहीं पकड़ पाया — माइक की अनुमति जाँचें।", true);
    };
    recognition.onend = () => {
      els.micBtn.classList.remove("listening");
      recognition = null;
      els.input.focus();
    };

    els.micBtn.classList.add("listening");
    recognition.start();
  });

  /* --------------------------------------------------------------- sidebar */
  function openSidebar() { els.sidebar.classList.add("open"); els.scrim.classList.add("show"); }
  function closeSidebar() { els.sidebar.classList.remove("open"); els.scrim.classList.remove("show"); }
  els.menuBtn.addEventListener("click", openSidebar);
  els.closeSidebar.addEventListener("click", closeSidebar);
  els.scrim.addEventListener("click", closeSidebar);
  els.newChatBtn.addEventListener("click", newChat);
  els.clearAllBtn.addEventListener("click", () => {
    if (!chats.length) return;
    if (!confirm("सारी चैट हटा दें?")) return;
    chats = []; currentId = null;
    saveChats(); renderChatList(); renderMessages();
  });

  els.themeBtn.addEventListener("click", () => {
    const now = document.documentElement.getAttribute("data-theme");
    applyTheme(now === "dark" ? "light" : "dark");
  });

  /* ------------------------------------------------------------------ init */
  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || "dark");
    renderExperts();

    chats = loadJson(CHATS_KEY, []);
    currentId = chats.length ? chats[0].id : null;
    renderChatList();
    renderMessages();

    try {
      const res = await fetch("/api/config");
      if (res.ok) cfg = await res.json();
    } catch (e) { /* config is optional */ }

    if (!cfg.anyProviderReady) {
      els.banner.hidden = false;
      els.setupText.textContent =
        " किसी भी AI की key Netlify environment variables में डालिए — OPENAI_API_KEY, ANTHROPIC_API_KEY या GEMINI_API_KEY — फिर site redeploy कीजिए।";
    }

    els.input.focus();
  }

  init();
})();

# CHTAVIED.NDA AI

हर सवाल का साथी, विशेषज्ञों का साम्राज्य।

हिंदी, अंग्रेज़ी या किसी भी भाषा में पूछिए — लेखन, पढ़ाई, गणना और प्रोग्रामिंग। एक **MASTER AI** आपके काम के लिए सही विशेषज्ञ चुनता है।

## क्या-क्या है

| सुविधा | विवरण |
|---|---|
| ChatGPT जैसी चैट | लिखिए, जवाब टाइप होते हुए आता है। कॉपी करें, दोबारा पूछें। |
| हिंदी + English | जिस भाषा में पूछें, उसी में जवाब — Hinglish भी। |
| 8 विशेषज्ञ | MASTER AI, लेखक, ट्यूटर, कोडर, प्लानर, अनुवादक, गणित, करियर |
| मॉडल चुनें | GPT, Claude या Gemini — चाबियाँ सिर्फ़ सर्वर पर |
| 🔊 सुनें (speaker) | हर जवाब के नीचे बटन — ब्राउज़र की आवाज़ में सुनिए, दोबारा दबाने पर रुक जाता है |
| 🎙 बोलकर पूछें | माइक दबाकर बोलिए, सवाल अपने आप लिखा जाता है |
| 📎 फोटो से सवाल | तस्वीर जोड़कर पूछिए — AI उसे देखकर जवाब देता है |
| चैट हिस्ट्री | साइडबार में सारी पुरानी चैट, इसी डिवाइस पर सुरक्षित |
| Guardian नियम | AI सुरक्षा नियमों से ऊपर नहीं; जवाब से पहले जाँच होती है |

## तकनीक

- **Frontend:** सादा HTML + CSS + JavaScript — कोई framework नहीं, कोई build step नहीं।
- **AI proxy:** `netlify/functions/chat.js` — OpenAI, Anthropic (Claude) और Gemini तीनों को सपोर्ट करता है।
- **सुरक्षा:** API keys सिर्फ़ Netlify के environment variables में रहती हैं, ब्राउज़र तक कभी नहीं पहुँचतीं।
- **Rate limit:** 20 messages प्रति मिनट प्रति IP।

## सेटअप

Netlify → **Site configuration → Environment variables** — इनमें से जो भी उपलब्ध हो, एक डालिए:

| Variable | किसके लिए |
|---|---|
| `OPENAI_API_KEY` | GPT मॉडल |
| `ANTHROPIC_API_KEY` | Claude मॉडल |
| `GEMINI_API_KEY` | Gemini मॉडल |
| `OPENAI_MODEL` | वैकल्पिक (डिफ़ॉल्ट `gpt-4o-mini`) |
| `ANTHROPIC_MODEL` | वैकल्पिक (डिफ़ॉल्ट `claude-3-5-sonnet-latest`) |
| `GEMINI_MODEL` | वैकल्पिक (डिफ़ॉल्ट `gemini-3.8-flash`) |

फिर **Deploys → Trigger deploy** एक बार दबाइए — बस।

## डिप्लॉय

Netlify → Add new site → Import an existing project → GitHub → यह repo।
Build command खाली, publish directory `.` — `netlify.toml` से अपने आप आ जाएगा।

## लोकल में चलाना

```bash
npm i -g netlify-cli
netlify dev
```

`.env` फ़ाइल में वही variables डालिए (वह git-ignored है)।

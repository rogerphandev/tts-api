/* ====================================================================
   CONFIG & CONSTANTS (Từ Azure / Edge Translator Engine)
==================================================================== */
const ENDPOINT_URL = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
const USER_AGENT = "okhttp/4.5.0";
const CLIENT_VERSION = "4.0.530a 5fe1dc6c";
const USER_ID = "0f04d16a175c411e";
const HOME_GEOGRAPHIC_REGION = "zh-Hans-CN";
const CLIENT_TRACE_ID = "aab069b9-70a7-4844-a734-96cd78d94be9";
const VOICE_DECODE_KEY = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const MAX_CHUNK_SIZE = 2000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store'
};

// Cấu trúc cache Endpoint & Token trên Worker
let endpointCache = null;
let expiredAt = null;

/* ====================================================================
   HELPERS & ENCRYPTION
==================================================================== */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function sign(urlStr) {
  const u = urlStr.split("://")[1];
  const encodedUrl = encodeURIComponent(u);
  const uuidStr = crypto.randomUUID().replace(/-/g, "");

  const now = new Date();
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const formattedDate = [
    `${days[now.getUTCDay()]},`,
    `${String(now.getUTCDate()).padStart(2, "0")}`,
    months[now.getUTCMonth()],
    now.getUTCFullYear(),
    `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}gmt`,
  ].join(" ");

  const bytesToSign = `mstranslatorandroidapp${encodedUrl.toLowerCase()}${formattedDate}${uuidStr}`;

  const keyBuffer = base64ToArrayBuffer(VOICE_DECODE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(bytesToSign)
  );
  const signBase64 = arrayBufferToBase64(signatureBuffer);

  return `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
}

async function getEndpoint() {
  const signature = await sign(ENDPOINT_URL);
  const headers = {
    "Accept-Language": "zh-Hans",
    "X-ClientVersion": CLIENT_VERSION,
    "X-UserId": USER_ID,
    "X-HomeGeographicRegion": HOME_GEOGRAPHIC_REGION,
    "X-ClientTraceId": CLIENT_TRACE_ID,
    "X-MT-Signature": signature,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": "0",
  };

  const response = await fetch(ENDPOINT_URL, { method: "POST", headers });
  if (!response.ok) {
    throw new Error(`Fetch endpoint failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function decodeJWT(token) {
  const payload = token.split(".")[1];
  return JSON.parse(atob(payload + "=="));
}

function escapeHtml(text = '') {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildSSML(text, voiceName, rateNum, pitchNum, style = "general") {
  const escapedText = escapeHtml(text);
  if (style && style !== "general") {
    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="en-US">
<voice name="${voiceName}">
    <mstts:express-as style="${style}" styledegree="1.0" role="default">
        <prosody rate="${rateNum}%" pitch="${pitchNum}%">
            ${escapedText}
        </prosody>
    </mstts:express-as>
</voice>
</speak>`;
  }

  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="en-US">
<voice name="${voiceName}">
    <prosody rate="${rateNum}%" pitch="${pitchNum}%">
        ${escapedText}
    </prosody>
</voice>
</speak>`;
}

function localeToLabel(locale) {
  try {
    if (!locale || !locale.includes('-')) return locale || '';
    const [lang, region] = locale.split('-');
    const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
    const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(region);
    return `${language} (${country})`;
  } catch {
    return locale;
  }
}

/* Auth token Cache Manager */
export async function getEndpointAndToken() {
  const currentTime = Math.floor(Date.now() / 1000);
  if (!expiredAt || currentTime > expiredAt - 60) {
    endpointCache = await getEndpoint();
    const jwt = decodeJWT(endpointCache.t);
    expiredAt = jwt.exp;
  }
  return endpointCache;
}

/* Single Chunk Synthesis Core */
async function synthesizeChunk(text, voiceName, rateNum, pitchNum, ep, format, style) {
  const url = `https://${ep.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSSML(text, voiceName, rateNum, pitchNum, style);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": ep.t,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": format || DEFAULT_OUTPUT_FORMAT,
      "User-Agent": USER_AGENT,
    },
    body: ssml,
  });

  if (!response.ok) {
    throw new Error(`Azure/Edge TTS HTTP error: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

/* ====================================================================
   EXPORTS: MAIN TTS API FUNCTIONS
==================================================================== */

/* 1. edgeTTS */
export async function edgeTTS(payload = {}) {
  let {
    text,
    voice = "zh-CN-XiaoxiaoNeural",
    rate = "0%",
    pitch = "0%",
    style = "general",
    format = DEFAULT_OUTPUT_FORMAT
  } = payload;

  if (!text || !text.trim().length) {
    return new Response('Missing text parameter', { status: 400, headers: CORS_HEADERS });
  }

  // Chuẩn hóa định dạng Rate và Pitch
  const rateNum = String(rate).replace(/[%Hz]/g, "").replace(/^\+/, "") || "0";
  const pitchNum = String(pitch).replace(/[%Hz]/g, "").replace(/^\+/, "") || "0";

  try {
    const ep = await getEndpointAndToken();
    let audioBuffer;

    // Ngắn văn bản -> Gọi trực tiếp
    if (text.length <= MAX_CHUNK_SIZE) {
      audioBuffer = await synthesizeChunk(text, voice, rateNum, pitchNum, ep, format, style);
    } else {
      // Dài văn bản -> Tự động cắt khối ghép âm thanh
      const chunks = [];
      for (let i = 0; i < text.length; i += MAX_CHUNK_SIZE) {
        chunks.push(text.slice(i, i + MAX_CHUNK_SIZE));
      }

      const audioChunks = await Promise.all(
        chunks.map(chunk => synthesizeChunk(chunk, voice, rateNum, pitchNum, ep, format, style))
      );

      const totalLen = audioChunks.reduce((sum, c) => sum + c.length, 0);
      audioBuffer = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of audioChunks) {
        audioBuffer.set(chunk, offset);
        offset += chunk.length;
      }
    }

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Edge Azure Engine Error:', error);
    return new Response(
      JSON.stringify({
        statusCode: 500,
        message: error.message || 'Speech Synthesis Failed',
        error: 'TTS_AZURE_ENGINE_ERROR'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
      }
    );
  }
}

/* 2. edgeTTSGroups */
export async function edgeTTSGroups() {
  try {
    const defaultLocales = [
      'vi-VN', 'zh-CN', 'en-US', 'ja-JP', 'ko-KR', 
      'fr-FR', 'de-DE', 'es-ES', 'ru-RU', 'th-TH'
    ];

    const options = defaultLocales.map(locale => ({
      value: locale,
      label: localeToLabel(locale)
    }));

    return { totalLocales: options.length, options };
  } catch (error) {
    return { totalLocales: 0, options: [], error: error.message };
  }
}

/* 3. edgeTTSVoicesByGroup */
export async function edgeTTSVoicesByGroup(payload = {}) {
  const { group = 'zh-CN' } = payload;
  try {
    const options = [
      { value: `${group}-XiaoxiaoNeural`, label: `Xiaoxiao (Female - ${group})` },
      { value: `${group}-YunxiNeural`, label: `Yunxi (Male - ${group})` },
      { value: `${group}-YunjianNeural`, label: `Yunjian (Male - ${group})` },
      { value: `${group}-XiaoxiaoMultilingualNeural`, label: `Xiaoxiao Multilingual (${group})` }
    ];

    return { group, total: options.length, options };
  } catch (error) {
    return { group, total: 0, options: [], error: error.message };
  }
}
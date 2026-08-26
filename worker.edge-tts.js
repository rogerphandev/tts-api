/**
 * =========================================================
 * EDGE TTS - CLOUDFLARE WORKERS (FIXED 403 & TIMEOUT)
 * =========================================================
 *
 * Supported:
 * ?engine=edge&text=Hello&voice=en-US-AriaNeural
 * ?engine=edge&action=groups
 * ?engine=edge&action=voices-by-group&group=en-US
 *
 * Formats: mp3, mp3-96, webm
 * =========================================================
 */

/* =========================================================
   EDGE TTS CONFIG
========================================================= */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const EDGE_TTS_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";

const CHROMIUM_FULL_VERSION =
  "133.0.3065.92";

/* =========================================================
   OUTPUT FORMAT
========================================================= */

const OUTPUT_FORMAT = {
  MP3_48:
    "audio-24khz-48kbitrate-mono-mp3",
  MP3_96:
    "audio-24khz-96kbitrate-mono-mp3",
  WEBM:
    "webm-24khz-16bit-mono-opus"
};

/* =========================================================
   CORS
========================================================= */

const CORS_HEADERS = {
  "Cache-Control":
    "no-store",
  "Access-Control-Allow-Origin": "*"
};

/* =========================================================
   REQUEST ID
========================================================= */

function requestId() {
  return crypto
    .randomUUID()
    .replaceAll("-", "");
}

/* =========================================================
   SEC-MS-GEC (FIXED BIGINT TICK CALCULATION)
========================================================= */

async function generateSecMsGec() {
  /*
   * Số Windows Ticks tính từ Epoch (1601-01-01 UTC)
   * 1 Unix second = 10,000,000 Ticks
   * Epoch Offset = 11644473600 seconds = 116444736000000000 Ticks
   */
  const unixTicks = Date.now() * 10000;
  const epochOffsetTicks = 116444736000000000n;
  const currentTicks = BigInt(unixTicks) + epochOffsetTicks;

  /*
   * Làm tròn xuống mốc 5 phút (300 giây = 3,000,000,000 ticks)
   */
  const roundedTicks = currentTicks - (currentTicks % 3000000000n);

  const value = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;

  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/* =========================================================
   TIMESTAMP
========================================================= */

function edgeTimestamp() {
  return new Date()
    .toUTCString()
    .replace("UTC", "GMT");
}

/* =========================================================
   XML ESCAPE
========================================================= */

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* =========================================================
   SSML
========================================================= */

function createSSML(text, voice, pitch, rate, volume) {
  return `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${escapeXml(voice)}">
    <prosody pitch="${escapeXml(pitch)}" rate="${escapeXml(rate)}" volume="${escapeXml(volume)}">
      ${escapeXml(text)}
    </prosody>
  </voice>
</speak>
`.trim();
}

/* =========================================================
   SPEECH CONFIG
========================================================= */

function createSpeechConfig(outputFormat) {
  return (
    `X-Timestamp:${edgeTimestamp()}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: false,
              wordBoundaryEnabled: true
            },
            outputFormat
          }
        }
      }
    })
  );
}

/* =========================================================
   SSML MESSAGE
========================================================= */

function createSSMLMessage(text, voice, pitch, rate, volume, id) {
  const ssml = createSSML(text, voice, pitch, rate, volume);

  return (
    `X-RequestId:${id}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${edgeTimestamp()}\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );
}

/* =========================================================
   CREATE EDGE URL
========================================================= */

async function createEdgeUrl() {
  const secMsGec = await generateSecMsGec();
  const connectionId = requestId();

  const url =
    `${EDGE_TTS_URL}` +
    `?TrustedClientToken=${encodeURIComponent(TRUSTED_CLIENT_TOKEN)}` +
    `&Sec-MS-GEC=${encodeURIComponent(secMsGec)}` +
    `&Sec-MS-GEC-Version=1-${encodeURIComponent(CHROMIUM_FULL_VERSION)}` +
    `&ConnectionId=${connectionId}`;

  return { url, connectionId };
}

/* =========================================================
   EXTRACT AUDIO
========================================================= */

function extractAudio(data) {
  let bytes;

  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    return null;
  }

  if (bytes.length < 2) {
    return null;
  }

  const headerLength = (bytes[0] << 8) | bytes[1];
  const audioStart = 2 + headerLength;

  if (audioStart > bytes.length) {
    return null;
  }

  const headerBytes = bytes.slice(2, audioStart);
  const headers = new TextDecoder().decode(headerBytes);

  if (!headers.toLowerCase().includes("path:audio")) {
    return null;
  }

  const audio = bytes.slice(audioStart);
  if (!audio.length) {
    return null;
  }

  return audio;
}

/* =========================================================
   EDGE TTS
========================================================= */

export async function edgeTTS(payload = {}) {
  const text = String(payload.text || "");
  const voice = String(payload.voice || "en-US-AriaNeural");
  const pitch = String(payload.pitch || "+0Hz");
  const rate = String(payload.rate || "0%");
  const volume = String(payload.volume || "100%");
  const format = String(payload.format || "mp3").toLowerCase();

  if (!text.trim()) {
    return new Response(
      JSON.stringify({
        message: "Text is required",
        example: {
          text: "Hello world",
          voice: "en-US-AriaNeural",
          pitch: "+0Hz",
          rate: "0%",
          volume: "100%",
          format: "mp3"
        }
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...CORS_HEADERS
        }
      }
    );
  }

  let outputFormat;
  let contentType;
  let filename;

  switch (format) {
    case "mp3-96":
      outputFormat = OUTPUT_FORMAT.MP3_96;
      contentType = "audio/mpeg";
      filename = "edge-tts.mp3";
      break;

    case "webm":
      outputFormat = OUTPUT_FORMAT.WEBM;
      contentType = "audio/webm; codecs=opus";
      filename = "edge-tts.webm";
      break;

    case "mp3":
    default:
      outputFormat = OUTPUT_FORMAT.MP3_48;
      contentType = "audio/mpeg";
      filename = "edge-tts.mp3";
      break;
  }

  const { url, connectionId } = await createEdgeUrl();

  let response;

  try {
    /*
     * Full Headers matching Edge Read Aloud
     */
    response = await fetch(url, {
      headers: {
        Upgrade: "websocket",
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
        "Origin": "chrome-extension://jdiccldimpdaibocbdgfnbhoipifnnip",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache"
      }
    });
  } catch (error) {
    throw new Error(
      `Edge WebSocket fetch failed: ${error?.message || "unknown error"}`
    );
  }

  const ws = response?.webSocket;

  if (!ws) {
    let body = "";
    try {
      body = await response.text();
    } catch {}

    throw new Error(
      `Edge WebSocket handshake failed: ${response.status} ${response.statusText || ""} ${body.slice(0, 500)}`
    );
  }

  ws.binaryType = "arraybuffer";
  ws.accept();

  const audioChunks = [];
  let audioReceived = false;
  let finished = false;

  return await new Promise((resolve, reject) => {
    let timeout;

    function finish(error = null) {
      if (finished) return;
      finished = true;

      if (timeout) clearTimeout(timeout);

      if (error) {
        try { ws.close(); } catch {}
        reject(error);
        return;
      }

      if (!audioChunks.length) {
        try { ws.close(); } catch {}
        reject(new Error("Edge TTS returned no audio"));
        return;
      }

      let total = 0;
      for (const chunk of audioChunks) {
        total += chunk.length;
      }

      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of audioChunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }

      try { ws.close(); } catch {}

      resolve(
        new Response(output, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${filename}"`,
            "Content-Length": String(output.byteLength),
            ...CORS_HEADERS
          }
        })
      );
    }

    timeout = setTimeout(() => {
      finish(new Error("Edge TTS timeout"));
    }, 30000);

    ws.addEventListener("open", () => {
      try {
        ws.send(createSpeechConfig(outputFormat));
        ws.send(
          createSSMLMessage(text, voice, pitch, rate, volume, connectionId)
        );
      } catch (error) {
        finish(error);
      }
    });

    ws.addEventListener("message", async event => {
      if (finished) return;

      try {
        if (typeof event.data !== "string") {
          let data = event.data;
          if (typeof Blob !== "undefined" && data instanceof Blob) {
            data = await data.arrayBuffer();
          }

          const audio = extractAudio(data);
          if (audio) {
            audioReceived = true;
            audioChunks.push(audio);
          }
          return;
        }

        const message = String(event.data);

        if (message.includes("Path:turn.end") || message.includes("Path:session.end")) {
          if (audioReceived) {
            finish();
          }
          return;
        }

        if (/error|forbidden|unauthorized/i.test(message)) {
          console.error("Edge TTS:", message);
        }
      } catch (error) {
        finish(error);
      }
    });

    ws.addEventListener("error", event => {
      console.error("Edge TTS WebSocket error:", event);
      finish(new Error("Edge TTS WebSocket error"));
    });

    ws.addEventListener("close", () => {
      if (finished) return;

      if (audioReceived) {
        finish();
      } else {
        finish(new Error("Edge TTS WebSocket closed without audio"));
      }
    });
  });
}

/* =========================================================
   GET ALL VOICES
========================================================= */

export async function getEdgeVoices() {
  const url =
    `${VOICES_URL}?trustedclienttoken=${encodeURIComponent(TRUSTED_CLIENT_TOKEN)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Edge voices request failed: ${response.status} ${text.slice(0, 500)}`
    );
  }

  const voices = await response.json();
  if (!Array.isArray(voices)) {
    throw new Error("Edge voices API returned invalid data");
  }

  return voices;
}

/* =========================================================
   LOCALE LABEL
========================================================= */

function localeToLabel(locale) {
  try {
    if (!locale || !locale.includes("-")) return locale;

    const parts = locale.split("-");
    const languageCode = parts[0];
    const regionCode = parts[parts.length - 1];

    const language = new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode);
    const country = new Intl.DisplayNames(["en"], { type: "region" }).of(regionCode);

    if (!language || !country) return locale;

    return `${language} (${country})`;
  } catch {
    return locale;
  }
}

/* =========================================================
   GROUPS
========================================================= */

export async function edgeTTSGroups() {
  const allVoices = await getEdgeVoices();
  const map = new Map();

  for (const voice of allVoices) {
    if (!voice || !voice.Locale) continue;

    if (!map.has(voice.Locale)) {
      map.set(voice.Locale, {
        value: voice.Locale,
        label: localeToLabel(voice.Locale)
      });
    }
  }

  const options = Array.from(map.values()).sort((a, b) =>
    a.value.localeCompare(b.value)
  );

  return {
    totalLocales: options.length,
    options
  };
}

/* =========================================================
   VOICES BY GROUP
========================================================= */

export async function edgeTTSVoicesByGroup(payload = {}) {
  const group = String(payload.group || "en-US");
  const allVoices = await getEdgeVoices();

  const voices = allVoices.filter(
    voice => voice && voice.Locale === group
  );

  const options = voices.map(voice => ({
    value: voice.ShortName || voice.Name,
    label: `${voice.Gender || ""} - ${voice.DisplayName || voice.LocalName || voice.Name || ""}`.trim(),
    gender: voice.Gender || "",
    shortName: voice.ShortName || "",
    locale: voice.Locale || "",
    localName: voice.LocalName || "",
    displayName: voice.DisplayName || ""
  }));

  return {
    group,
    total: options.length,
    options
  };
}

/* =========================================================
   MAIN FETCH HANDLER FOR CLOUDFLARE WORKER
========================================================= */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const engine = url.searchParams.get("engine");

    if (engine !== "edge") {
      return new Response("Invalid engine. Use ?engine=edge", { status: 400 });
    }

    const action = url.searchParams.get("action");

    try {
      if (action === "groups") {
        const res = await edgeTTSGroups();
        return new Response(JSON.stringify(res), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      if (action === "voices-by-group") {
        const group = url.searchParams.get("group") || "en-US";
        const res = await edgeTTSVoicesByGroup({ group });
        return new Response(JSON.stringify(res), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      const text = url.searchParams.get("text") || "";
      const voice = url.searchParams.get("voice") || "en-US-AriaNeural";
      const format = url.searchParams.get("format") || "mp3";
      const pitch = url.searchParams.get("pitch") || "+0Hz";
      const rate = url.searchParams.get("rate") || "0%";
      const volume = url.searchParams.get("volume") || "100%";

      return await edgeTTS({ text, voice, format, pitch, rate, volume });
    } catch (err) {
      return new Response(
        JSON.stringify({ message: err.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        }
      );
    }
  }
};
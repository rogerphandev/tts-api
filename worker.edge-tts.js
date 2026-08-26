/**
 * =========================================================
 * EDGE TTS - CLOUDFLARE WORKERS (STRICT TIMEOUT & SEC-MS-GEC FIX)
 * =========================================================
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_TTS_URL = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const VOICES_URL = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";
const CHROMIUM_FULL_VERSION = "133.0.3065.92";

const OUTPUT_FORMAT = {
  MP3_48: "audio-24khz-48kbitrate-mono-mp3",
  MP3_96: "audio-24khz-96kbitrate-mono-mp3",
  WEBM: "webm-24khz-16bit-mono-opus"
};

const CORS_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*"
};

function requestId() {
  return crypto.randomUUID().replaceAll("-", "");
}

/* =========================================================
   SEC-MS-GEC FIX (TÍNH CHÍNH XÁC THEO MỐC 5 PHÚT UTC)
========================================================= */
async function generateSecMsGec() {
  // Lấy Unix timestamp hiện tại theo giây
  const nowInSeconds = Math.floor(Date.now() / 1000);
  
  // Làm tròn xuống mốc 5 phút (300 giây)
  const roundedSeconds = BigInt(Math.floor(nowInSeconds / 300) * 300);
  
  // Chuyển sang Windows Filetime Ticks (10,000,000 ticks/giây + Offset từ 1601)
  const epochOffset = 11644473600n;
  const ticks = (roundedSeconds + epochOffset) * 10000000n;

  const value = `${ticks}${TRUSTED_CLIENT_TOKEN}`;

  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function edgeTimestamp() {
  return new Date().toUTCString().replace("UTC", "GMT");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

function extractAudio(data) {
  let bytes;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    return null;
  }

  if (bytes.length < 2) return null;

  const headerLength = (bytes[0] << 8) | bytes[1];
  const audioStart = 2 + headerLength;

  if (audioStart > bytes.length) return null;

  const headerBytes = bytes.slice(2, audioStart);
  const headers = new TextDecoder().decode(headerBytes);

  if (!headers.toLowerCase().includes("path:audio")) return null;

  const audio = bytes.slice(audioStart);
  return audio.length ? audio : null;
}

export async function edgeTTS(payload = {}) {
  const text = String(payload.text || "");
  const voice = String(payload.voice || "vi-VN-HoaiMyNeural");
  const pitch = String(payload.pitch || "+0Hz");
  const rate = String(payload.rate || "0%");
  const volume = String(payload.volume || "100%");
  const format = String(payload.format || "mp3").toLowerCase();

  if (!text.trim()) {
    return new Response(JSON.stringify({ message: "Text is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
    });
  }

  let outputFormat = OUTPUT_FORMAT.MP3_48;
  let contentType = "audio/mpeg";
  let filename = "edge-tts.mp3";

  if (format === "mp3-96") outputFormat = OUTPUT_FORMAT.MP3_96;
  if (format === "webm") {
    outputFormat = OUTPUT_FORMAT.WEBM;
    contentType = "audio/webm; codecs=opus";
    filename = "edge-tts.webm";
  }

  const { url, connectionId } = await createEdgeUrl();

  /*
   * ĐẢM BẢO HEADERS GIẢ LẬP EDGE READ-ALOUD CHUẨN XÁC
   */
  const response = await fetch(url, {
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

  const ws = response?.webSocket;
  if (!ws) {
    throw new Error(`Edge WebSocket handshake failed: ${response.status}`);
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

      let total = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
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

    // Giảm timeout xuống 15s để phản hồi nhanh nếu ngắt kết nối
    timeout = setTimeout(() => {
      finish(new Error("Edge TTS timeout - Server didn't respond with audio"));
    }, 15000);

    ws.addEventListener("open", () => {
      try {
        ws.send(createSpeechConfig(outputFormat));
        ws.send(createSSMLMessage(text, voice, pitch, rate, volume, connectionId));
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
          if (audioReceived) finish();
        }
      } catch (error) {
        finish(error);
      }
    });

    ws.addEventListener("error", () => finish(new Error("Edge TTS WebSocket error")));
    ws.addEventListener("close", () => {
      if (finished) return;
      if (audioReceived) finish();
      else finish(new Error("Edge TTS WebSocket closed without audio"));
    });
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const engine = url.searchParams.get("engine");

    if (engine !== "edge") {
      return new Response("Invalid engine. Use ?engine=edge", { status: 400 });
    }

    try {
      const text = url.searchParams.get("text") || "";
      const voice = url.searchParams.get("voice") || "vi-VN-HoaiMyNeural";
      const format = url.searchParams.get("format") || "mp3";
      const pitch = url.searchParams.get("pitch") || "+0Hz";
      const rate = url.searchParams.get("rate") || "0%";
      const volume = url.searchParams.get("volume") || "100%";

      return await edgeTTS({ text, voice, format, pitch, rate, volume });
    } catch (err) {
      return new Response(JSON.stringify({ message: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }
  }
};
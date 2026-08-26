/* =========================================================
   EDGE TTS WORKER MODULE
========================================================= */

const EDGE_VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EA5E40C2A421886A16855731";

/**
 * Lấy toàn bộ danh sách giọng đọc từ Edge TTS
 */
export async function getEdgeVoices() {
  const response = await fetch(EDGE_VOICES_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Edge voices: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Phân loại voices theo Group / Ngôn ngữ
 */
export async function edgeTTSGroups() {
  const voices = await getEdgeVoices();
  const groups = new Set();

  for (const voice of voices) {
    if (voice.Locale) {
      groups.add(voice.Locale);
    }
  }

  return Array.from(groups).sort();
}

/**
 * Lấy danh sách giọng đọc dựa trên Group / Locale (vd: "vi-VN", "en-US")
 */
export async function edgeTTSVoicesByGroup(payload = {}) {
  const voices = await getEdgeVoices();
  const targetGroup = payload.group || payload.locale;

  if (!targetGroup) {
    return voices;
  }

  return voices.filter(
    (v) => v.Locale?.toLowerCase() === targetGroup.toLowerCase()
  );
}

/**
 * Chuyển văn bản thành giọng nói dùng WebSocket Edge TTS
 */
export async function edgeTTS(payload = {}) {
  const text = payload.text || "Xin chào";
  const voice = payload.voice || "vi-VN-HoaiMyNeural";
  const rate = payload.rate || "+0%";
  const pitch = payload.pitch || "+0Hz";

  // Cấu hình kết nối WebSocket với Microsoft Speech Service
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EA5E40C2A421886A16855731`;

  const requestHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    Origin: "chrome-extension://jdiccldimpdaibmpobicabagbdbdjoni"
  };

  const requestId = crypto.randomUUID().replace(/-/g, "");

  // Tạo kết nối WebSocket bằng API chuẩn Fetch/WebSocket của Worker
  const ws = new WebSocket(wsUrl, ["synth"]);
  const audioChunks = [];

  return new Promise((resolve, reject) => {
    // Timeout phòng trường hợp đứt kết nối WebSocket (15s)
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Edge TTS Request Timeout"));
    }, 15000);

    ws.addEventListener("open", () => {
      // 1. Gửi Speech Configuration Frame
      const configHeader =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"client":{"name":"Chrome","version":"120.0.0.0","path":"mr"}}}}`;

      ws.send(configHeader);

      // 2. Gửi SSML Frame
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rate}' pitch='${pitch}'>${text}</prosody>` +
        `</voice></speak>`;

      const requestHeader =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      ws.send(requestHeader);
    });

    ws.addEventListener("message", async (event) => {
      if (typeof event.data === "string") {
        // Nhận dữ liệu text / control frame từ server
        if (event.data.includes("Path:turn.end")) {
          clearTimeout(timer);
          ws.close();

          // Tợp hợp các mảng nhị phân nhận được thành 1 file MP3 duy nhất
          const audioBuffer = await new Blob(audioChunks, {
            type: "audio/mpeg"
          }).arrayBuffer();

          resolve(audioBuffer);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Nhận dữ liệu nhị phân (Audio Chunk)
        const view = new DataView(event.data);
        const headerLength = view.getUint16(0);

        // Bỏ qua header của frame WebSocket, chỉ lưu phần âm thanh MP3
        if (event.data.byteLength > headerLength + 2) {
          const audioData = event.data.slice(headerLength + 2);
          audioChunks.push(audioData);
        }
      }
    });

    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      ws.close();
      reject(new Error(`Edge TTS WebSocket error: ${err.message || "Unknown error"}`));
    });

    ws.addEventListener("close", () => {
      clearTimeout(timer);
    });
  });
}
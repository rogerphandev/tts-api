const WEILBYTE_ENDPOINT =
  "https://tiktok-tts.weilnet.workers.dev";

export async function generateTikTokTTS(payload = {}) {

  const text =
    String(payload.text || "").trim();

  const voice =
    payload.voice || "en_us_001";

  if (!text) {
    throw new Error("Text is required");
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      30000
    );

  try {

    const url =
      `${WEILBYTE_ENDPOINT}/api/generation`;

    const requestBody = {
      text: text,
      voice: voice
    };

    console.log(
      "TikTok request:",
      url,
      requestBody
    );

    const response =
      await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
          "Accept":
            "application/json",
          "User-Agent":
            "Mozilla/5.0"
        },

        body:
          JSON.stringify(requestBody),

        signal:
          controller.signal
      });

    const raw =
      await response.text();

    console.log(
      "TikTok status:",
      response.status
    );

    console.log(
      "TikTok response:",
      raw
    );

    if (!response.ok) {

      throw new Error(
        `TikTok TTS HTTP ${response.status}: ${raw || "Empty response"}`
      );

    }

    let result;

    try {

      result =
        JSON.parse(raw);

    } catch {

      throw new Error(
        "TikTok TTS returned invalid JSON: " +
        raw.slice(0, 500)
      );

    }

    if (
      !result ||
      !result.success ||
      !result.data
    ) {

      throw new Error(
        result?.message ||
        result?.error ||
        "No audio data returned from TikTok TTS"
      );

    }

    const binary =
      atob(result.data);

    const audio =
      new Uint8Array(
        binary.length
      );

    for (
      let i = 0;
      i < binary.length;
      i++
    ) {

      audio[i] =
        binary.charCodeAt(i);

    }

    return audio;

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "TikTok TTS timeout"
      );

    }

    throw error;

  } finally {

    clearTimeout(timeout);

  }
}

export default generateTikTokTTS;
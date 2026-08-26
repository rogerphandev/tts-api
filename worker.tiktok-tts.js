const WEILBYTE_ENDPOINT =
  "https://tiktok-tts.weilnet.workers.dev";

/**
 * Generate TikTok TTS audio
 *
 * Cloudflare Workers compatible.
 *
 * @param {Object} payload
 * @param {string} payload.text
 * @param {string} payload.voice
 * @returns {Promise<Uint8Array>}
 */
export async function generateTikTokTTS(payload = {}) {
  const {
    text,
    voice = "en_us_001"
  } = payload;

  if (!text || !String(text).trim()) {
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
    const response =
      await fetch(
        `${WEILBYTE_ENDPOINT}/api/generation`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            text: String(text),
            voice
          }),

          signal: controller.signal
        }
      );

    if (!response.ok) {
      throw new Error(
        `TikTok TTS HTTP ${response.status}`
      );
    }

    const result =
      await response.json();

    if (
      !result ||
      !result.success ||
      !result.data
    ) {
      throw new Error(
        "No audio data returned from TikTok TTS"
      );
    }

    /*
     * Base64 → Uint8Array
     *
     * Không dùng Buffer vì Cloudflare
     * Workers không có Node.js Buffer
     * mặc định.
     */

    const binaryString =
      atob(result.data);

    const audio =
      new Uint8Array(
        binaryString.length
      );

    for (
      let i = 0;
      i < binaryString.length;
      i++
    ) {
      audio[i] =
        binaryString.charCodeAt(i);
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

    throw new Error(
      error?.message ||
      "TikTok TTS failed"
    );

  } finally {

    clearTimeout(timeout);

  }
}

export default generateTikTokTTS;
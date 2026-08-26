const WEILBYTE_ENDPOINT =
  "https://tiktok-tts.weilnet.workers.dev";

/**
 * Generate TikTok TTS
 *
 * Cloudflare Workers compatible
 *
 * @param {Object} payload
 * @returns {Promise<Uint8Array>}
 */
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

    const response =
      await fetch(
        `${WEILBYTE_ENDPOINT}/api/generation`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
            "Accept":
              "application/json"
          },

          body: JSON.stringify({
            text,
            voice
          }),

          signal: controller.signal
        }
      );

    /*
     * Đọc response trước.
     * Không throw ngay để lấy message
     * thật từ API TikTok.
     */

    const responseText =
      await response.text();

    if (!response.ok) {

      let errorMessage =
        `TikTok TTS HTTP ${response.status}`;

      try {

        const errorData =
          JSON.parse(responseText);

        errorMessage =
          errorData?.message ||
          errorData?.error ||
          errorMessage;

      } catch {
        if (responseText) {
          errorMessage +=
            `: ${responseText.slice(0, 500)}`;
        }
      }

      throw new Error(
        errorMessage
      );
    }

    let result;

    try {

      result =
        JSON.parse(responseText);

    } catch {

      throw new Error(
        "TikTok TTS returned invalid JSON"
      );

    }

    if (!result) {
      throw new Error(
        "TikTok TTS returned empty response"
      );
    }

    /*
     * Weilnet thường trả:
     *
     * {
     *   success: true,
     *   data: "BASE64..."
     * }
     */

    if (!result.success) {

      throw new Error(
        result.message ||
        result.error ||
        "TikTok TTS generation failed"
      );

    }

    if (!result.data) {

      throw new Error(
        "TikTok TTS returned no audio data"
      );

    }

    /*
     * Base64 → Uint8Array
     *
     * Không dùng Buffer.
     */

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

    if (audio.length === 0) {

      throw new Error(
        "TikTok TTS returned empty audio"
      );

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
const WEILBYTE_ENDPOINT = "https://tiktok-tts.weilnet.workers.dev";

/**
 * Generate TikTok TTS audio (MP3 buffer)
 * @param {string} text
 * @param {string} voice
 * @returns {Promise<Buffer>}
 */
export async function generateTikTokTTS(payload) {

  let { text, voice="en_us_001" } = payload
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      `${WEILBYTE_ENDPOINT}/api/generation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text, voice }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`TikTok TTS HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result?.success || !result?.data) {
      throw new Error("No audio data returned from TikTok TTS");
    }

    // Base64 → Buffer (MP3)
    return Buffer.from(result.data, "base64");

  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("TikTok TTS timeout");
    }

    throw new Error(
      err?.message || "TikTok TTS failed"
    );
  } finally {
    clearTimeout(timeout);
  }
}

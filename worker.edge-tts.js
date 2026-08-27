import { EdgeTTS } from '@andresaya/edge-tts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store'
}

/* ===============================
   Helper: Locale → English Label
================================ */
function localeToLabel(locale) {
  try {
    if (!locale || !locale.includes('-')) return locale || ''

    const [lang, region] = locale.split('-')
    const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang)
    const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(region)

    return `${language} (${country})`
  } catch {
    return locale
  }
}

/* ===============================
   1. edgeTTS → Synthesize Audio
================================ */
export async function edgeTTS(payload = {}) {
  let {
    text,
    voice = 'en-US-AriaNeural',
    pitch = '+0Hz',
    rate = '0%',
    volume = '100%',
    format = 'mp3'
  } = payload

  /* ---------- Kiểm tra văn bản đầu vào ---------- */
  if (!text || !text.trim().length) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Edge TTS API</title></head>
        <body style="font-family: sans-serif; padding: 2rem; line-height: 1.6;">
          <h2>Edge TTS Cloudflare Worker</h2>
          <p>API đang hoạt động. Vui lòng truyền tham số <code>text</code> để tạo file âm thanh.</p>
        </body>
      </html>
    `
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...CORS_HEADERS
      }
    })
  }

  /* ---------- Khởi tạo và Tạo Âm thanh ---------- */
  try {
    const tts = new EdgeTTS()

    // Sử dụng chuỗi format định dạng trực tiếpThay vì xài Constants
    const outputFormat =
      format === 'mp3'
        ? 'audio-24khz-48kbitrate-mono-mp3'
        : 'webm-16khz-16bit-mono-opus'

    await tts.synthesize(text, voice, {
      pitch,
      rate,
      volume,
      outputFormat
    })

    const buffer = tts.toBuffer()
    const info = tts.getAudioInfo() || {}

    const headers = {
      'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/webm; codecs=opus',
      'Accept-Ranges': 'bytes',
      'x-audio-size': String(info.size || buffer.byteLength || 0),
      'x-audio-duration': String(info.estimatedDuration || 0),
      ...CORS_HEADERS
    }

    return new Response(buffer, { headers })

  } catch (error) {
    console.error('Edge TTS Error:', error)

    // Bắt lỗi WebSocket fail do IP Cloudflare Worker bị giới hạn hoặc chặn
    return new Response(
      JSON.stringify({
        statusCode: 500,
        message: error?.message || 'WebSocket connection to Edge TTS failed.',
        error: 'EDGE_TTS_SOCKET_ERROR'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...CORS_HEADERS
        }
      }
    )
  }
}

/* =====================================
   2. edgeTTSGroups → Locale Groups
===================================== */
export async function edgeTTSGroups() {
  try {
    const tts = new EdgeTTS()
    const allVoices = await tts.getVoices()

    const options = [
      ...new Map(
        allVoices.map(v => [
          v.Locale,
          {
            value: v.Locale,
            label: localeToLabel(v.Locale)
          }
        ])
      ).values()
    ].sort((a, b) => a.value.localeCompare(b.value))

    return {
      totalLocales: options.length,
      options
    }
  } catch (error) {
    return {
      totalLocales: 0,
      options: [],
      error: error?.message || 'Failed to fetch voice groups'
    }
  }
}

/* =====================================
   3. edgeTTSVoicesByGroup
===================================== */
export async function edgeTTSVoicesByGroup(payload = {}) {
  const { group = 'en-US' } = payload

  try {
    const tts = new EdgeTTS()
    const voices = await tts.getVoicesByLanguage(group)

    const options = voices.map(v => ({
      value: v.ShortName || v.Name,
      label: `${v.Gender || 'Unknown'} - ${v.DisplayName || v.ShortName || v.Name}`
    }))

    return {
      group,
      total: options.length,
      options
    }
  } catch (error) {
    return {
      group,
      total: 0,
      options: [],
      error: error?.message || 'Failed to fetch voices'
    }
  }
}
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
    if (!locale.includes('-')) return locale

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
export async function edgeTTS(payload) {
  let {
    text,
    voice = 'en-US-AriaNeural',
    pitch = '+0Hz',
    rate = '0%',
    volume = '100%',
    format = 'mp3'
  } = payload

  if (!text || !text.trim().length) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Edge TTS API</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h2>Edge TTS Cloudflare Worker</h2>
          <p>Truyền tham số <code>text</code> để bắt đầu tổng hợp giọng nói.</p>
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

  const tts = new EdgeTTS()

  // Thay thế Constants bằng chuỗi trực tiếp
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
  const info = tts.getAudioInfo()

  const headers = {
    'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/webm; codecs=opus',
    'Accept-Ranges': 'bytes',
    'x-audio-size': String(info?.size || 0),
    'x-audio-duration': String(info?.estimatedDuration || 0),
    ...CORS_HEADERS
  }

  return new Response(buffer, { headers })
}

/* =====================================
   2. edgeTTSGroups → Locale Groups
===================================== */
export async function edgeTTSGroups() {
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
}

/* =====================================
   3. edgeTTSVoicesByGroup
===================================== */
export async function edgeTTSVoicesByGroup(payload = {}) {
  const { group = 'en-US' } = payload

  const tts = new EdgeTTS()
  const voices = await tts.getVoicesByLanguage(group)

  const options = voices.map(v => ({
    value: v.ShortName || v.Name,
    label: `${v.Gender} - ${v.DisplayName}`
  }))

  return {
    group,
    total: options.length,
    options
  }
}
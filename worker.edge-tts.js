import { EdgeTTS, Constants } from '@andresaya/edge-tts'

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
    const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(country || region)

    return `${language} (${country})`
  } catch {
    return locale
  }
}

/* ===============================
   Main Router (Cloudflare Worker)
================================ */
export default {
  async fetch(request, env, ctx) {
    // Xử lý Preflight CORS request
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)
    const pathname = url.pathname

    // Đọc payload từ Query Parameters (GET) hoặc Body JSON (POST)
    let payload = {}
    if (request.method === 'POST') {
      try {
        payload = await request.json()
      } catch {
        payload = {}
      }
    } else {
      payload = Object.fromEntries(url.searchParams.entries())
    }

    /* Router rules */
    if (pathname === '/edge-tts/groups') {
      return handleGroups()
    }

    if (pathname === '/edge-tts/voices-by-group') {
      return handleVoicesByGroup(payload)
    }

    if (pathname === '/edge-tts' || pathname === '/') {
      return handleTTS(payload)
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS })
  }
}

/* ===============================
   1. /edge-tts → Synthesize Audio
================================ */
async function handleTTS(payload) {
  let {
    text,
    voice = 'en-US-AriaNeural',
    pitch = '+0Hz',
    rate = '0%',
    volume = '100%',
    format = 'mp3'
  } = payload

  /* ---------- Không có text → trả về Huớng dẫn / Documentation ---------- */
  if (!text || !text.trim().length) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Edge TTS API</title>
          <meta charset="utf-8" />
        </head>
        <body style="font-family: sans-serif; padding: 2rem; line-height: 1.5;">
          <h2>Edge TTS Cloudflare Worker</h2>
          <p>API đang hoạt động bình thường. Hãy gửi tham số <code>text</code> qua GET query hoặc POST body để tạo audio.</p>
          <ul>
            <li><strong>/edge-tts</strong> - Tạo file audio từ văn bản</li>
            <li><strong>/edge-tts/groups</strong> - Lấy danh sách ngôn ngữ</li>
            <li><strong>/edge-tts/voices-by-group?group=en-US</strong> - Lấy giọng đọc theo nhóm</li>
          </ul>
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

  /* ---------- Synthesize Audio ---------- */
  const tts = new EdgeTTS()

  const outputFormat =
    format === 'mp3'
      ? Constants.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
      : Constants.OUTPUT_FORMAT.WEBM_16KHZ_16BIT_MONO_OPUS

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
    'x-audio-size': String(info.size),
    'x-audio-duration': String(info.estimatedDuration),
    ...CORS_HEADERS
  }

  return new Response(buffer, { headers })
}

/* =====================================
   2. /edge-tts/groups → Locale Groups
===================================== */
async function handleGroups() {
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

  return new Response(
    JSON.stringify({
      totalLocales: options.length,
      options
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        ...CORS_HEADERS
      }
    }
  )
}

/* =====================================
   3. /edge-tts/voices-by-group
===================================== */
async function handleVoicesByGroup(payload) {
  const { group = 'en-US' } = payload

  const tts = new EdgeTTS()
  const voices = await tts.getVoicesByLanguage(group)

  const options = voices.map(v => ({
    value: v.ShortName || v.Name,
    label: `${v.Gender} - ${v.DisplayName}`
  }))

  return new Response(
    JSON.stringify({
      group,
      total: options.length,
      options
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        ...CORS_HEADERS
      }
    }
  )
}
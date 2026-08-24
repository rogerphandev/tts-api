/**
 * Edge TTS API
 * /edge-tts
 * /edge-tts/groups
 * /edge-tts/voices-by-group
 */

import { EdgeTTS, Constants } from '@andresaya/edge-tts'
import { readFile } from 'node:fs/promises'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
  'Cache-Control': 'no-store'
}

/* ===============================
   Helper: Locale → English (United States)
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
   /edge-tts → generate audio
================================ */
export async function edgeTTS(payload, reply) {
  let {
    text,
    voice = 'en-US-AriaNeural',
    pitch = '+0Hz',
    rate = '0%',
    volume = '100%',
    format = 'mp3' // default
  } = payload

  /* ---------- No text → show README ---------- */
  if (!text || !text.length) {
    const html = await readFile('./README.md')

    // Fastify
    if (reply) {
      reply
        .type('text/html; charset=utf-8')
        .header('Access-Control-Allow-Origin', '*')
      return reply.send(html)
    }

    // Netlify / Fetch
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    })
  }

  /* ---------- Synthesize ---------- */
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
    'Content-Type':
      format === 'mp3'
        ? 'audio/mpeg'
        : 'audio/webm; codecs=opus',
    'Accept-Ranges': 'bytes',
    'x-audio-size': info.size,
    'x-audio-duration': info.estimatedDuration,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  }

  /* ---------- Fastify ---------- */
  if (reply) {
    Object.entries(headers).forEach(([k, v]) =>
      reply.header(k, v)
    )
    return reply.send(buffer)
  }

  /* ---------- Netlify / Fetch ---------- */
  return new Response(buffer, { headers })
}


/* =====================================
   /edge-tts/groups → locale groups
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
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      ...headers
    },
    body: JSON.stringify({
      totalLocales: options.length,
      options
    })
  }
}

/* =====================================
   /edge-tts/voices-by-group
===================================== */
export async function edgeTTSVoicesByGroup(payload = {}) {
  const { group = 'en-US' } = payload

  const tts = new EdgeTTS()
  const voices = await tts.getVoicesByLanguage(group)

  const options = voices.map(v => ({
    value: v.ShortName || v.Name,
    label: v.Gender +' - '+v.DisplayName
  }))

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      ...headers
    },
    body: JSON.stringify({
      group,
      total: options.length,
      options
    })
  }
}

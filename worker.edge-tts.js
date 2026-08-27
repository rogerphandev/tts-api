const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store'
}

const EDGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
  'Authority': 'speech.platform.bing.com',
  'Pragma': 'no-cache'
}

/* Escape các ký tự XML đặc biệt trong văn bản */
function escapeXML(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

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
   1. edgeTTS (REST API Standard SSML)
================================ */
export async function edgeTTS(payload = {}) {
  let {
    text,
    voice = 'en-US-AriaNeural',
    pitch = '+0Hz',
    rate = '+0%',
    volume = '+0%',
    format = 'mp3'
  } = payload

  if (!text || !text.trim().length) {
    return new Response('Missing text parameter', { status: 400, headers: CORS_HEADERS })
  }

  // Chuẩn hóa định dạng pitch/rate/volume
  if (typeof pitch === 'number') pitch = `${pitch >= 0 ? '+' : ''}${pitch}Hz`
  if (typeof rate === 'number') rate = `${rate >= 0 ? '+' : ''}${rate}%`
  if (typeof volume === 'number') volume = `${volume >= 0 ? '+' : ''}${volume}%`

  if (!pitch.includes('Hz') && !pitch.includes('%')) pitch = '+0Hz'
  if (!rate.includes('%')) rate = '+0%'
  if (!volume.includes('%')) volume = '+0%'

  try {
    const escapedText = escapeXML(text)
    
    // Cấu trúc SSML chuẩn Bing Speech API
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapedText}</prosody></voice></speak>`

    const response = await fetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/single/v1?trustedclienttoken=6A5AA1D4EA5E4071A743D995589F438D',
      {
        method: 'POST',
        headers: {
          ...EDGE_HEADERS,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat':
            format === 'mp3'
              ? 'audio-24khz-48kbitrate-mono-mp3'
              : 'webm-16khz-16bit-mono-opus'
        },
        body: ssml
      }
    )

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Edge API error: ${response.status} ${response.statusText} - ${errText}`)
    }

    const audioBuffer = await response.arrayBuffer()

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/webm; codecs=opus',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS
      }
    })
  } catch (error) {
    console.error('Edge TTS Error:', error)
    return new Response(
      JSON.stringify({
        statusCode: 500,
        message: error.message || 'Edge TTS request failed',
        error: 'EDGE_TTS_ERROR'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      }
    )
  }
}

/* =====================================
   2. edgeTTSGroups
===================================== */
export async function edgeTTSGroups() {
  try {
    const res = await fetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EA5E4071A743D995589F438D',
      { headers: EDGE_HEADERS }
    )
    const allVoices = await res.json()

    const options = [
      ...new Map(
        allVoices.map(v => [
          v.Locale,
          { value: v.Locale, label: localeToLabel(v.Locale) }
        ])
      ).values()
    ].sort((a, b) => a.value.localeCompare(b.value))

    return { totalLocales: options.length, options }
  } catch (error) {
    return { totalLocales: 0, options: [], error: error.message }
  }
}

/* =====================================
   3. edgeTTSVoicesByGroup
===================================== */
export async function edgeTTSVoicesByGroup(payload = {}) {
  const { group = 'en-US' } = payload
  try {
    const res = await fetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EA5E4071A743D995589F438D',
      { headers: EDGE_HEADERS }
    )
    const allVoices = await res.json()
    const voices = allVoices.filter(v => v.Locale === group)

    const options = voices.map(v => ({
      value: v.ShortName || v.Name,
      label: `${v.Gender || 'Unknown'} - ${v.FriendlyName || v.ShortName}`
    }))

    return { group, total: options.length, options }
  } catch (error) {
    return { group, total: 0, options: [], error: error.message }
  }
}
import googleTTS from "../google-tts.js"
import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
} from "../edge-tts.js"
import { generateTikTokTTS } from "../tiktok-tts.js";

// function corsHeaders(req) {
//   const origin = req.headers.get('origin') || '*'

//   return {
//     'Access-Control-Allow-Origin': origin,
//     'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
//     'Access-Control-Allow-Headers': 'Content-Type, Authorization',
//     'Access-Control-Allow-Credentials': 'true',
//     'Access-Control-Max-Age': '86400'
//   }
// }

/* ---------- CORS CONFIG ---------- */
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'https://ai-video-generator-web.netlify.app',
  'https://www.unminifydev.com',
  'https://www.freettspro.com'
])

function corsHeaders(req) {
  const origin = req.headers.get('origin')

  // cho phép request không có origin (server-to-server, curl)
  if (!origin || ALLOWED_ORIGINS.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  }

  // origin không hợp lệ → vẫn trả response nhưng không set CORS
  return {}
}

export default async function handler(req) {
  /* ---------- Preflight ---------- */
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req)
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const formData = await req.formData().catch(() => null)
    const query = Object.fromEntries(new URL(req.url).searchParams)

    const form = formData ? Object.fromEntries(formData.entries()) : {}

    const payload = {
      ...body,
      ...form,
      ...query
    }

    const engine = payload.engine || 'google'
    const action = payload.action || 'tts'

    delete payload.engine
    delete payload.action

    /* ---------- EDGE TTS ---------- */
    if (engine === 'edge') {
      if (action === 'groups') {
        const res = Response.json(await edgeTTSGroups(payload))
        Object.entries(corsHeaders(req)).forEach(([k, v]) =>
          res.headers.set(k, v)
        )
        return res
      }

      if (action === 'voices-by-group') {
        const res = Response.json(await edgeTTSVoicesByGroup(payload))
        Object.entries(corsHeaders(req)).forEach(([k, v]) =>
          res.headers.set(k, v)
        )
        return res
      }

      const res = await edgeTTS(payload)
      Object.entries(corsHeaders(req)).forEach(([k, v]) =>
        res.headers.set(k, v)
      )
      return res
    }

    /* ---------- TIKTOK TTS ---------- */
    if (engine === "tiktok") {

      try {
        const audioBuffer = await generateTikTokTTS(payload);

        const res = new Response(audioBuffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Disposition": "inline; filename=tiktok-tts.mp3"
          }
        });

        Object.entries(corsHeaders(req)).forEach(([k, v]) =>
          res.headers.set(k, v)
        );

        return res;
      } catch (err) {
        const res = Response.json(
          { message: err.message || "TikTok TTS error" },
          { status: 500 }
        );
        Object.entries(corsHeaders(req)).forEach(([k, v]) =>
          res.headers.set(k, v)
        );
        return res;
      }
    }

    /* ---------- GOOGLE TTS ---------- */
    const res = await googleTTS(
      payload,
      '/tmp/',
      '/var/task/bin/ffmpeg'
    )

    Object.entries(corsHeaders(req)).forEach(([k, v]) =>
      res.headers.set(k, v)
    )
    return res

  } catch (err) {
    return new Response(err?.message || 'TTS error', {
      status: 500,
      headers: corsHeaders(req)
    })
  }
}

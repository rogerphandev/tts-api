import Fastify from 'fastify'
import cors from '@fastify/cors'
import googleTTS from './google-tts.js'
import { edgeTTS, edgeTTSGroups, edgeTTSVoicesByGroup } from './edge-tts.js'
import { generateTikTokTTS } from "./tiktok-tts.js";
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

const app = Fastify()

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'https://ai-video-generator-web.netlify.app',
  'https://www.unminifydev.com',
  'https://www.freettspro.com'
])

await app.register(cors, {
  origin: (origin, cb) => {
    // cho phép request không có origin (curl, server-to-server)
    if (!origin) return cb(null, true)

    if (allowedOrigins.has(origin)) {
      cb(null, true)
    } else {
      cb(new Error('Not allowed by CORS'), false)
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})


app.route({
  method: ['GET', 'POST'],
  url: '/',
  handler: async (req) => {
    let body = req.body

    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch (e) {}
    }

    const payload = Object.assign({}, body, req.query)
    return payload
  }
})

app.route({
  method: ["GET", "POST"],
  url: "/tiktok-tts",
  handler: async (req, reply) => {
    let body = req.body;

    // Fix body là string
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const payload = Object.assign({}, body, req.query);

    try {
      const audioBuffer = await generateTikTokTTS(payload);

      reply
        .header("Content-Type", "audio/mpeg")
        .header(
          "Content-Disposition",
          "inline; filename=tiktok-tts.mp3"
        );

      return reply.send(audioBuffer);

    } catch (err) {
      reply.code(500);
      return {
        message: err.message || "TikTok TTS error"
      };
    }
  }
});


app.route({
  method: ['GET', 'POST'],
  url: '/google-tts',
  handler: async (req) => {
    let body = req.body

    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch (e) {}
    }

    const payload = Object.assign({}, body, req.query)

    // 👉 tạo thư mục tmp trong project
    const tmpDir = join(process.cwd(), 'tmp')

    await mkdir(tmpDir, { recursive: true })

    return await googleTTS(payload, tmpDir)
  }
})

app.route({
  method: ['GET', 'POST'],
  url: '/edge-tts',
  handler: async (req, reply) => {
    let body = req.body

    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch {}
    }

    const payload = Object.assign({}, body, req.query)

    return edgeTTS(payload, reply)
  }
})


app.route({
  method: ['GET', 'POST'],
  url: '/edge-tts/groups',
  handler: async (req) => {
    let body = req.body

    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch (e) {}
    }

    const payload = Object.assign({}, body, req.query)
    return await edgeTTSGroups(payload)
  }
})

app.route({
  method: ['GET', 'POST'],
  url: '/edge-tts/voices-by-group',
  handler: async (req) => {
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch {}
    }
    return edgeTTSVoicesByGroup({ ...body, ...req.query })
  }
})

const port = process.env.PORT || 3001

app.listen({ port: Number(port), host: '0.0.0.0' })
  .then((address) => console.log(`Server listening on ${address}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as TTS from '@sefinek/google-tts-api'
import { translate } from 'google-translate-api-x'
import Ffmpeg from 'fluent-ffmpeg'

export default async function googleTTS(payload, tmp = '', ffmpegPath = '') {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
    'Cache-Control': 'public, max-age=31536000, immutable'
  }

  let { text, lang = 'auto', speed, pitch = 1 } = payload

  if (!text || !text.length) {
    return new Response(await readFile('./README.md'), {
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers }
    })
  }

  // detect language
  if (lang === 'auto') {
    try {
      const res = await translate(text)
      lang = Array.isArray(res)
        ? res[0].from.language.iso
        : res.from.language.iso
    } catch {
      lang = 'en'
    }
  }

  const audios = await TTS.getAllAudioBase64(text, { lang })
  const ffmpeg = Ffmpeg()
  const files = []

  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)

  // 👉 tạo file tạm
  for (const { base64 } of audios) {
    const path = join(tmp, `${randomUUID()}.mp3`)
    const buffer = Buffer.from(base64, 'base64')

    await writeFile(path, buffer)
    files.push(path)
    ffmpeg.addInput(path)
  }

  const sample = 44100
  const setrate = sample * pitch
  const tempo = speed || (1 + (1 - pitch))
  const chunks = []

  try {
    // 👉 ffmpeg xử lý
    await new Promise((resolve, reject) =>
      ffmpeg
        .complexFilter([
          { filter: 'concat', options: { n: files.length, v: 0, a: 1 }, outputs: 'merged' },
          { filter: 'aresample', options: sample, inputs: 'merged', outputs: 'resampled' },
          { filter: 'asetrate', options: setrate, inputs: 'resampled', outputs: 'rated' },
          { filter: 'atempo', options: tempo, inputs: 'rated', outputs: 'final' }
        ])
        .outputOptions('-map [final]')
        .format('mp3')
        .on('end', resolve)
        .on('error', reject)
        .pipe()
        .on('data', chunk => chunks.push(chunk))
    )

    // 👉 trả audio về user
    return new Response(Buffer.concat(chunks), {
      headers: {
        'content-type': 'audio/mp3',
        'content-disposition': 'inline',
        ...headers
      }
    })

  } finally {
    // 👉 luôn xóa file (dù thành công hay lỗi)
    await Promise.all(
      files.map(f => unlink(f).catch(() => {}))
    )
  }
}
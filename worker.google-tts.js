/**
 * Google TTS for Cloudflare Workers
 *
 * Cloudflare Workers compatible
 *
 * No Node.js
 * No fs
 * No Buffer
 * No FFmpeg
 * No fluent-ffmpeg
 * No google-translate-api-x
 *
 * Endpoint:
 *
 * POST ?engine=google
 *
 * {
 *   "text": "Hello world",
 *   "lang": "en",
 *   "speed": 1,
 *   "pitch": 1
 * }
 */

const GOOGLE_TTS_URL =
  "https://translate.google.com/translate_tts";


/* =========================================================
   CORS
========================================================= */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "*",
  "Cache-Control": "no-store"
};


/* =========================================================
   GOOGLE TTS
========================================================= */

async function requestGoogleTTS(
  text,
  lang = "en"
) {

  const url =
    new URL(GOOGLE_TTS_URL);

  url.searchParams.set(
    "ie",
    "UTF-8"
  );

  url.searchParams.set(
    "client",
    "tw-ob"
  );

  url.searchParams.set(
    "tl",
    lang
  );

  url.searchParams.set(
    "q",
    text
  );


  const response =
    await fetch(url.toString(), {
      method: "GET",

      headers: {
        "User-Agent":
          "Mozilla/5.0"
      }
    });


  if (!response.ok) {

    throw new Error(
      `Google TTS request failed: ${response.status}`
    );

  }


  const arrayBuffer =
    await response.arrayBuffer();


  if (
    !arrayBuffer ||
    arrayBuffer.byteLength === 0
  ) {

    throw new Error(
      "Google TTS returned empty audio"
    );

  }


  return arrayBuffer;

}


/* =========================================================
   SPLIT TEXT
========================================================= */

function splitText(
  text,
  maxLength = 180
) {

  const chunks = [];

  let current = "";


  /*
   * Tách theo câu trước
   */
  const sentences =
    text.match(
      /[^.!?。！？]+[.!?。！？]*/g
    ) || [text];


  for (
    const sentence
    of sentences
  ) {

    const value =
      sentence.trim();


    if (!value) {
      continue;
    }


    /*
     * Câu ngắn
     */
    if (
      value.length <= maxLength
    ) {

      if (
        (
          current +
          " " +
          value
        ).trim().length <=
        maxLength
      ) {

        current =
          (
            current +
            " " +
            value
          ).trim();

      } else {

        if (current) {
          chunks.push(current);
        }

        current = value;

      }

      continue;

    }


    /*
     * Câu quá dài
     * -> cắt theo khoảng trắng
     */
    const words =
      value.split(/\s+/);


    for (
      const word
      of words
    ) {

      if (
        (
          current +
          " " +
          word
        ).trim().length >
        maxLength
      ) {

        if (current) {
          chunks.push(
            current.trim()
          );
        }

        current = word;

      } else {

        current =
          (
            current +
            " " +
            word
          ).trim();

      }

    }

  }


  if (current.trim()) {

    chunks.push(
      current.trim()
    );

  }


  return chunks;

}


/* =========================================================
   MERGE MP3
========================================================= */

function mergeAudioBuffers(
  buffers
) {

  let totalLength = 0;


  for (
    const buffer
    of buffers
  ) {

    totalLength +=
      buffer.byteLength;

  }


  const output =
    new Uint8Array(
      totalLength
    );


  let offset = 0;


  for (
    const buffer
    of buffers
  ) {

    output.set(
      new Uint8Array(buffer),
      offset
    );

    offset +=
      buffer.byteLength;

  }


  return output.buffer;

}


/* =========================================================
   LANGUAGE
========================================================= */

function normalizeLanguage(
  lang
) {

  if (
    !lang ||
    lang === "auto"
  ) {

    return "en";

  }


  /*
   * Google TTS dùng:
   *
   * en
   * ja
   * vi
   * ko
   * fr
   * de
   * es
   * pt
   * ...
   */

  return String(lang)
    .trim()
    .split("-")[0]
    .toLowerCase();

}


/* =========================================================
   SPEED
========================================================= */

function normalizeSpeed(
  speed
) {

  if (
    speed === undefined ||
    speed === null ||
    speed === ""
  ) {

    return 1;

  }


  const value =
    Number(speed);


  if (
    !Number.isFinite(value)
  ) {

    return 1;

  }


  return Math.min(
    Math.max(
      value,
      0.5
    ),
    2
  );

}


/* =========================================================
   MAIN GOOGLE TTS
========================================================= */

export default async function googleTTS(
  payload = {}
) {

  const {

    text,

    lang = "en",

    speed = 1,

    pitch = 1

  } = payload;


  /* =======================================================
     VALIDATE
  ======================================================= */

  if (
    !text ||
    !String(text).trim()
  ) {

    return new Response(

      JSON.stringify({

        message:
          "Text is required",

        example: {

          text:
            "Hello world",

          lang:
            "en",

          speed:
            1,

          pitch:
            1

        }

      }),

      {

        status: 400,

        headers: {

          "Content-Type":
            "application/json; charset=utf-8",

          ...CORS_HEADERS

        }

      }

    );

  }


  /* =======================================================
     LANGUAGE
  ======================================================= */

  const language =
    normalizeLanguage(
      lang
    );


  /* =======================================================
     SPEED
  ======================================================= */

  const normalizedSpeed =
    normalizeSpeed(
      speed
    );


  /*
   * Google Translate TTS không cung cấp
   * pitch processing trực tiếp.
   *
   * Pitch hiện được giữ lại để API
   * tương thích với frontend cũ.
   */

  const normalizedPitch =
    Number(pitch) || 1;


  /* =======================================================
     SPLIT
  ======================================================= */

  const chunks =
    splitText(
      String(text),
      180
    );


  if (!chunks.length) {

    return new Response(

      JSON.stringify({

        message:
          "No valid text"

      }),

      {

        status: 400,

        headers: {

          "Content-Type":
            "application/json; charset=utf-8",

          ...CORS_HEADERS

        }

      }

    );

  }


  /* =======================================================
     REQUEST AUDIO
  ======================================================= */

  try {

    const audioBuffers = [];


    /*
     * Google Translate TTS
     *
     * Giới hạn từng request khá ngắn,
     * vì vậy xử lý từng chunk.
     */

    for (
      const chunk
      of chunks
    ) {

      const audio =
        await requestGoogleTTS(
          chunk,
          language
        );


      audioBuffers.push(
        audio
      );

    }


    /* =====================================================
       MERGE
    ===================================================== */

    const merged =
      mergeAudioBuffers(
        audioBuffers
      );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return new Response(
      merged,
      {

        status: 200,

        headers: {

          "Content-Type":
            "audio/mpeg",

          "Content-Disposition":
            'inline; filename="google-tts.mp3"',

          "Cache-Control":
            "no-store",

          "X-Google-TTS-Language":
            language,

          "X-Google-TTS-Speed":
            String(normalizedSpeed),

          "X-Google-TTS-Pitch":
            String(normalizedPitch),

          ...CORS_HEADERS

        }

      }
    );


  } catch (error) {

    console.error(
      "Google TTS error:",
      error
    );


    return new Response(

      JSON.stringify({

        message:
          error?.message ||
          "Google TTS error"

      }),

      {

        status: 500,

        headers: {

          "Content-Type":
            "application/json; charset=utf-8",

          ...CORS_HEADERS

        }

      }

    );

  }

}
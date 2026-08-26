/**
 * worker.edge-tts.js
 *
 * Cloudflare Workers Edge TTS
 *
 * Endpoints:
 *
 * GET
 * ?engine=edge&action=groups
 *
 * GET
 * ?engine=edge&action=voices-by-group&group=en-US
 *
 * POST
 * ?engine=edge
 *
 * Body:
 * {
 *   "text": "Hello world",
 *   "voice": "en-US-AriaNeural",
 *   "pitch": "+0Hz",
 *   "rate": "0%",
 *   "volume": "100%",
 *   "format": "mp3"
 * }
 *
 * Return format:
 *
 * {
 *   statusCode: 200,
 *   headers: {...},
 *   body: "..."
 * }
 */


/* =========================================================
   CONSTANTS
========================================================= */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const EDGE_TTS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";

const CHROMIUM_FULL_VERSION =
  "143.0.3650.75";

const CHROMIUM_MAJOR_VERSION =
  CHROMIUM_FULL_VERSION.split(".")[0];


/* =========================================================
   OUTPUT FORMAT
========================================================= */

const OUTPUT_FORMAT = {

  MP3_48:
    "audio-24khz-48kbitrate-mono-mp3",

  MP3_96:
    "audio-24khz-96kbitrate-mono-mp3",

  WEBM:
    "webm-24khz-16bit-mono-opus"

};


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
   BASE HEADERS
========================================================= */

const BASE_HEADERS = {

  "User-Agent":
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
    `AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) ` +
    `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 ` +
    `Safari/537.36 ` +
    `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,

  "Accept-Language":
    "en-US,en;q=0.9"

};


/* =========================================================
   HELPER
========================================================= */

function jsonResult(
  statusCode,
  body
) {

  return {

    statusCode,

    headers: {

      "content-type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "*",

      "Access-Control-Allow-Methods":
        "*"

    },

    body:
      JSON.stringify(body)

  };

}


/* =========================================================
   SEC-MS-GEC
========================================================= */

async function generateSecMsGec() {

  /*
   * Unix timestamp
   * + Windows epoch offset
   */

  const unixSeconds =
    Math.floor(Date.now() / 1000);

  const windowsSeconds =
    unixSeconds + 11644473600;

  /*
   * Round to 5 minutes
   */

  const rounded =
    windowsSeconds -
    (windowsSeconds % 300);

  /*
   * Windows FILETIME
   */

  const windowsTicks =
    rounded * 10000000;

  const input =
    `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`;

  const data =
    new TextEncoder().encode(input);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array
    .from(new Uint8Array(hash))
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("")
    .toUpperCase();

}


/* =========================================================
   REQUEST ID
========================================================= */

function requestId() {

  return crypto
    .randomUUID()
    .replaceAll("-", "");

}


/* =========================================================
   XML ESCAPE
========================================================= */

function escapeXml(value) {

  return String(value)

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&apos;"
    );

}


/* =========================================================
   TIMESTAMP
========================================================= */

function edgeTimestamp() {

  return new Date()
    .toUTCString()
    .replace(
      "UTC",
      "GMT"
    );

}


/* =========================================================
   SSML
========================================================= */

function createSSML(
  text,
  voice,
  pitch,
  rate,
  volume
) {

  const safeText =
    escapeXml(text);

  const safeVoice =
    escapeXml(voice);

  return `
<speak
  version="1.0"
  xmlns="http://www.w3.org/2001/10/synthesis"
  xmlns:mstts="https://www.w3.org/2001/mstts"
  xml:lang="en-US">

  <voice name="${safeVoice}">

    <prosody
      pitch="${pitch}"
      rate="${rate}"
      volume="${volume}">

      ${safeText}

    </prosody>

  </voice>

</speak>
`.trim();

}


/* =========================================================
   SPEECH CONFIG
========================================================= */

function createSpeechConfig(
  outputFormat
) {

  return (

    `X-Timestamp:${edgeTimestamp()}\r\n` +

    `Content-Type:application/json; charset=utf-8\r\n` +

    `Path:speech.config\r\n\r\n` +

    JSON.stringify({

      context: {

        synthesis: {

          audio: {

            metadataoptions: {

              sentenceBoundaryEnabled:
                false,

              wordBoundaryEnabled:
                false

            },

            outputFormat

          }

        }

      }

    })

  );

}


/* =========================================================
   SSML MESSAGE
========================================================= */

function createSSMLMessage(
  text,
  voice,
  pitch,
  rate,
  volume,
  id
) {

  const ssml =
    createSSML(
      text,
      voice,
      pitch,
      rate,
      volume
    );

  return (

    `X-RequestId:${id}\r\n` +

    `Content-Type:application/ssml+xml\r\n` +

    `X-Timestamp:${edgeTimestamp()}Z\r\n` +

    `Path:ssml\r\n\r\n` +

    ssml

  );

}


/* =========================================================
   EXTRACT AUDIO
========================================================= */

async function extractAudio(
  data
) {

  let bytes;

  /*
   * ArrayBuffer
   */

  if (
    data instanceof ArrayBuffer
  ) {

    bytes =
      new Uint8Array(data);

  }

  /*
   * Blob
   */

  else if (
    typeof Blob !== "undefined" &&
    data instanceof Blob
  ) {

    bytes =
      new Uint8Array(
        await data.arrayBuffer()
      );

  }

  /*
   * Uint8Array
   */

  else if (
    data instanceof Uint8Array
  ) {

    bytes = data;

  }

  /*
   * Other typed array
   */

  else if (
    ArrayBuffer.isView(data)
  ) {

    bytes =
      new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength
      );

  }

  else {

    return null;

  }


  /*
   * Edge TTS binary message:
   *
   * first 2 bytes:
   * header length
   */

  if (
    bytes.length < 2
  ) {

    return null;

  }


  const headerLength =
    (bytes[0] << 8) |
    bytes[1];


  const headerStart = 2;

  const audioStart =
    headerStart +
    headerLength;


  if (
    audioStart >
    bytes.length
  ) {

    return null;

  }


  const headerBytes =
    bytes.slice(
      headerStart,
      audioStart
    );


  const headers =
    new TextDecoder()
      .decode(headerBytes);


  /*
   * Only process Path:audio
   */

  if (
    !headers.includes(
      "Path:audio"
    )
  ) {

    return null;

  }


  return bytes.slice(
    audioStart
  );

}


/* =========================================================
   EDGE TTS
========================================================= */

export async function edgeTTS(
  payload = {}
) {

  const {

    text,

    voice =
      "en-US-AriaNeural",

    pitch =
      "+0Hz",

    rate =
      "0%",

    volume =
      "100%",

    format =
      "mp3"

  } = payload;


  /*
   * Validate text
   */

  if (
    !text ||
    !String(text).trim()
  ) {

    return jsonResult(
      400,
      {

        message:
          "Text is required",

        example: {

          text:
            "Hello world",

          voice:
            "en-US-AriaNeural",

          pitch:
            "+0Hz",

          rate:
            "0%",

          volume:
            "100%",

          format:
            "mp3"

        }

      }
    );

  }


  /* =======================================================
     FORMAT
  ======================================================= */

  let outputFormat;

  let contentType;

  let filename;


  switch (
    String(format).toLowerCase()
  ) {

    case "mp3-96":

      outputFormat =
        OUTPUT_FORMAT.MP3_96;

      contentType =
        "audio/mpeg";

      filename =
        "edge-tts.mp3";

      break;


    case "webm":

      outputFormat =
        OUTPUT_FORMAT.WEBM;

      contentType =
        "audio/webm; codecs=opus";

      filename =
        "edge-tts.webm";

      break;


    case "mp3":

    default:

      outputFormat =
        OUTPUT_FORMAT.MP3_48;

      contentType =
        "audio/mpeg";

      filename =
        "edge-tts.mp3";

      break;

  }


  /* =======================================================
     SECURITY
  ======================================================= */

  const secMsGec =
    await generateSecMsGec();


  const connectionId =
    requestId();


  const url =
    `${EDGE_TTS_URL}` +

    `?TrustedClientToken=${encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    )}` +

    `&Sec-MS-GEC=${encodeURIComponent(
      secMsGec
    )}` +

    `&Sec-MS-GEC-Version=1-${encodeURIComponent(
      CHROMIUM_FULL_VERSION
    )}` +

    `&ConnectionId=${connectionId}`;


  /* =======================================================
     WEBSOCKET
  ======================================================= */

  let ws;

  try {

    ws =
      new WebSocket(url);

  }

  catch (error) {

    return jsonResult(
      500,
      {

        message:
          "Failed to create Edge TTS WebSocket",

        error:
          error?.message ||
          String(error)

      }
    );

  }


  const audioChunks = [];

  let finished = false;

  let audioReceived = false;


  return await new Promise(
    (resolve) => {

      const timeout =
        setTimeout(
          () => {

            finish(
              new Error(
                "Edge TTS WebSocket timeout"
              )
            );

          },
          30000
        );


      /* ===================================================
         OPEN
      =================================================== */

      ws.addEventListener(
        "open",
        () => {

          try {

            /*
             * Speech config
             */

            ws.send(
              createSpeechConfig(
                outputFormat
              )
            );


            /*
             * SSML
             */

            ws.send(
              createSSMLMessage(
                String(text),
                voice,
                pitch,
                rate,
                volume,
                connectionId
              )
            );

          }

          catch (error) {

            finish(error);

          }

        }
      );


      /* ===================================================
         MESSAGE
      =================================================== */

      ws.addEventListener(
        "message",
        async event => {

          if (finished) {
            return;
          }


          try {

            /*
             * Binary audio
             */

            const audio =
              await extractAudio(
                event.data
              );


            if (audio) {

              audioReceived =
                true;

              audioChunks.push(
                audio
              );

              return;

            }


            /*
             * Text message
             */

            if (
              typeof event.data ===
              "string"
            ) {

              const message =
                event.data;


              /*
               * Session / turn end
               */

              if (

                message.includes(
                  "Path:turn.end"
                )

                ||

                message.includes(
                  "Path:session.end"
                )

              ) {

                finish();

              }


              /*
               * Error response
               */

              if (

                message.includes(
                  "Path:response"
                )

                &&

                message.includes(
                  "X-RequestId"
                )

              ) {

                /*
                 * Do not immediately fail.
                 * Some response frames can
                 * appear before audio.
                 */

              }

            }

          }

          catch (error) {

            finish(error);

          }

        }
      );


      /* ===================================================
         ERROR
      =================================================== */

      ws.addEventListener(
        "error",
        () => {

          finish(
            new Error(
              "Edge TTS WebSocket error"
            )
          );

        }
      );


      /* ===================================================
         CLOSE
      =================================================== */

      ws.addEventListener(
        "close",
        () => {

          if (finished) {
            return;
          }


          /*
           * If audio already arrived,
           * accept it.
           */

          if (
            audioReceived &&
            audioChunks.length > 0
          ) {

            finish();

            return;

          }


          finish(
            new Error(
              "Edge TTS WebSocket closed without audio"
            )
          );

        }
      );


      /* ===================================================
         FINISH
      =================================================== */

      function finish(
        error = null
      ) {

        if (finished) {
          return;
        }

        finished = true;

        clearTimeout(timeout);


        try {

          ws.close();

        }

        catch {}


        /*
         * Error
         */

        if (error) {

          resolve(
            jsonResult(
              500,
              {

                message:
                  error?.message ||
                  "Edge TTS error"

              }
            )
          );

          return;

        }


        /*
         * No audio
         */

        if (
          !audioChunks.length
        ) {

          resolve(
            jsonResult(
              500,
              {

                message:
                  "Edge TTS returned no audio"

              }
            )
          );

          return;

        }


        /* ================================================
           MERGE AUDIO
        ================================================= */

        let totalLength = 0;


        for (
          const chunk
          of audioChunks
        ) {

          totalLength +=
            chunk.length;

        }


        const output =
          new Uint8Array(
            totalLength
          );


        let offset = 0;


        for (
          const chunk
          of audioChunks
        ) {

          output.set(
            chunk,
            offset
          );

          offset +=
            chunk.length;

        }


        /*
         * Return audio wrapper
         *
         * index.js can detect
         * statusCode + body Uint8Array
         */

        resolve({

          statusCode: 200,

          headers: {

            "Content-Type":
              contentType,

            "Content-Disposition":
              `inline; filename=${filename}`,

            "Content-Length":
              String(
                output.byteLength
              ),

            ...CORS_HEADERS

          },

          body: output

        });

      }

    }
  );

}


/* =========================================================
   GET EDGE VOICES
========================================================= */

export async function getEdgeVoices() {

  const secMsGec =
    await generateSecMsGec();


  const url =
    `${VOICES_URL}` +

    `?trustedclienttoken=${encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    )}` +

    `&Sec-MS-GEC=${encodeURIComponent(
      secMsGec
    )}` +

    `&Sec-MS-GEC-Version=1-${encodeURIComponent(
      CHROMIUM_FULL_VERSION
    )}`;


  const response =
    await fetch(
      url,
      {

        method: "GET",

        headers: {

          ...BASE_HEADERS,

          "Accept":
            "*/*",

          "Authority":
            "speech.platform.bing.com",

          "Sec-Fetch-Site":
            "none",

          "Sec-Fetch-Mode":
            "cors",

          "Sec-Fetch-Dest":
            "empty"

        }

      }
    );


  if (!response.ok) {

    throw new Error(
      `Edge voices request failed: ${response.status}`
    );

  }


  const data =
    await response.json();


  /*
   * Microsoft normally returns
   * an array directly.
   */

  if (
    Array.isArray(data)
  ) {

    return data;

  }


  /*
   * Safety for alternative format.
   */

  if (
    Array.isArray(
      data?.voices
    )
  ) {

    return data.voices;

  }


  return [];

}


/* =========================================================
   LOCALE LABEL
========================================================= */

function localeToLabel(
  locale
) {

  try {

    if (
      !locale ||
      !locale.includes("-")
    ) {

      return locale;

    }


    /*
     * Special locale:
     *
     * iu-Cans-CA
     * iu-Latn-CA
     */

    const parts =
      locale.split("-");


    const languageCode =
      parts[0];

    const regionCode =
      parts[parts.length - 1];


    const language =
      new Intl.DisplayNames(
        ["en"],
        {
          type: "language"
        }
      ).of(
        languageCode
      );


    const country =
      new Intl.DisplayNames(
        ["en"],
        {
          type: "region"
        }
      ).of(
        regionCode
      );


    if (
      !language ||
      !country
    ) {

      return locale;

    }


    return `${language} (${country})`;

  }

  catch {

    return locale;

  }

}


/* =========================================================
   EDGE GROUPS
========================================================= */

export async function edgeTTSGroups() {

  try {

    const allVoices =
      await getEdgeVoices();


    /*
     * Unique locales
     */

    const map =
      new Map();


    for (
      const voice
      of allVoices
    ) {

      const locale =
        voice?.Locale;


      if (!locale) {
        continue;
      }


      if (
        !map.has(locale)
      ) {

        map.set(
          locale,
          {

            value:
              locale,

            label:
              localeToLabel(
                locale
              )

          }
        );

      }

    }


    const options =
      Array
        .from(
          map.values()
        )
        .sort(
          (a, b) =>
            a.value.localeCompare(
              b.value
            )
        );


    return jsonResult(
      200,
      {

        totalLocales:
          options.length,

        options

      }
    );

  }

  catch (error) {

    return jsonResult(
      500,
      {

        totalLocales: 0,

        options: [],

        message:
          error?.message ||
          "Failed to load Edge TTS groups"

      }
    );

  }

}


/* =========================================================
   EDGE VOICES BY GROUP
========================================================= */

export async function edgeTTSVoicesByGroup(
  payload = {}
) {

  try {

    const group =
      payload.group ||
      "en-US";


    const allVoices =
      await getEdgeVoices();


    const voices =
      allVoices.filter(
        voice =>
          voice?.Locale ===
          group
      );


    const options =
      voices.map(
        voice => ({

          value:
            voice?.ShortName ||
            voice?.Name ||
            "",

          label:
            `${voice?.Gender || ""} - ${
              voice?.DisplayName ||
              voice?.LocalName ||
              voice?.ShortName ||
              voice?.Name ||
              ""
            }`.trim()

        })
      )
      .filter(
        voice =>
          voice.value
      );


    return jsonResult(
      200,
      {

        group,

        total:
          options.length,

        options

      }
    );

  }

  catch (error) {

    return jsonResult(
      500,
      {

        group:
          payload.group ||
          "en-US",

        total: 0,

        options: [],

        message:
          error?.message ||
          "Failed to load Edge TTS voices"

      }
    );

  }

}
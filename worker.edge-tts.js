/**
 * Edge TTS for Cloudflare Workers
 *
 * Endpoints:
 *
 * GET
 *   ?engine=edge&action=groups
 *
 * GET
 *   ?engine=edge&action=voices-by-group&group=en-US
 *
 * POST
 *   ?engine=edge
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
 * Cloudflare Workers compatible.
 */


/* =========================================================
   CONSTANTS
========================================================= */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const BASE_URL =
  "speech.platform.bing.com/consumer/speech/synthesize/readaloud";

const EDGE_TTS_URL =
  `wss://${BASE_URL}/edge/v1`;

const VOICES_URL =
  `https://${BASE_URL}/voices/list`;

const CHROMIUM_FULL_VERSION =
  "143.0.3650.75";

const CHROMIUM_MAJOR_VERSION =
  CHROMIUM_FULL_VERSION.split(".")[0];

const SEC_MS_GEC_VERSION =
  `1-${CHROMIUM_FULL_VERSION}`;


/* =========================================================
   OUTPUT FORMAT
========================================================= */

const OUTPUT_FORMAT = {
  mp3:
    "audio-24khz-48kbitrate-mono-mp3",

  "mp3-96":
    "audio-24khz-96kbitrate-mono-mp3",

  webm:
    "webm-24khz-16bit-mono-opus"
};


/* =========================================================
   CORS
========================================================= */

const CORS_HEADERS = {

  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "*",

  "Access-Control-Allow-Methods":
    "*",

  "Cache-Control":
    "no-store"

};


/* =========================================================
   HTTP HEADERS
========================================================= */

const BASE_HEADERS = {

  "User-Agent":
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
    `AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 ` +
    `Safari/537.36 ` +
    `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,

  "Accept-Encoding":
    "gzip, deflate, br",

  "Accept-Language":
    "en-US,en;q=0.9"

};


/*
 * Headers used by Edge TTS WebSocket.
 *
 * These headers are part of the current
 * Edge TTS protocol implementations.
 */

const WSS_HEADERS = {

  ...BASE_HEADERS,

  "Pragma":
    "no-cache",

  "Cache-Control":
    "no-cache",

  "Origin":
    "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",

  "Sec-WebSocket-Version":
    "13"

};


/*
 * Headers for voice list request.
 */

const VOICE_HEADERS = {

  ...BASE_HEADERS,

  "Accept":
    "*/*"

};


/* =========================================================
   UTILS
========================================================= */

function generateUUID() {

  return crypto
    .randomUUID()
    .replace(/-/g, "");

}


/*
 * Generate a MUID.
 *
 * Edge TTS clients normally send a MUID cookie.
 */

function generateMUID() {

  const bytes =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  return Array
    .from(bytes)
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
   SEC-MS-GEC
========================================================= */

/*
 * Microsoft Edge TTS security token.
 *
 * Important:
 *
 * Unix seconds
 * + Windows epoch
 * rounded to 5 minutes
 * converted to 100ns FILETIME ticks
 * SHA-256 + TrustedClientToken
 *
 * This follows the current Edge TTS implementations.
 */

async function generateSecMsGec() {

  let ticks =
    Date.now() / 1000;

  ticks +=
    11644473600;

  ticks -=
    ticks % 300;

  /*
   * Convert seconds to 100ns ticks.
   */

  ticks *= 10000000 / 100;

  const value =
    `${Math.round(ticks)}${TRUSTED_CLIENT_TOKEN}`;

  const data =
    new TextEncoder().encode(
      value
    );

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array
    .from(
      new Uint8Array(hash)
    )
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
   TIMESTAMP
========================================================= */

function edgeTimestamp() {

  /*
   * Edge TTS clients use a UTC timestamp
   * in the command messages.
   */

  return new Date()
    .toUTCString()
    .replace(
      "GMT",
      "GMT+0000 (Coordinated Universal Time)"
    );

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
   CLEAN TEXT
========================================================= */

function cleanText(text) {

  return String(text)
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      " "
    )
    .trim();

}


/* =========================================================
   FORMAT VALIDATION
========================================================= */

function normalizeRate(rate) {

  if (
    typeof rate ===
    "number"
  ) {

    rate =
      `${rate}%`;

  }

  rate =
    String(
      rate ?? "0%"
    ).trim();

  if (
    !/^[+-]?\d+%$/.test(rate)
  ) {

    throw new Error(
      `Invalid rate: ${rate}`
    );

  }

  const value =
    parseInt(
      rate.replace("%", ""),
      10
    );

  return (
    value >= 0
      ? `+${value}%`
      : `${value}%`
  );

}


function normalizeVolume(volume) {

  if (
    typeof volume ===
    "number"
  ) {

    volume =
      `${volume}%`;

  }

  volume =
    String(
      volume ?? "100%"
    ).trim();

  /*
   * UI uses:
   *
   * -100 ... +100
   *
   * Edge protocol accepts
   * signed percentage.
   */

  if (
    !/^[+-]?\d+%$/.test(volume)
  ) {

    throw new Error(
      `Invalid volume: ${volume}`
    );

  }

  const value =
    parseInt(
      volume.replace("%", ""),
      10
    );

  if (
    value < -100 ||
    value > 100
  ) {

    throw new Error(
      "Volume must be between -100% and +100%"
    );

  }

  /*
   * Your React default is 0,
   * but API default can be +0%.
   */

  return (
    value >= 0
      ? `+${value}%`
      : `${value}%`
  );

}


function normalizePitch(pitch) {

  if (
    typeof pitch ===
    "number"
  ) {

    pitch =
      `${pitch}Hz`;

  }

  pitch =
    String(
      pitch ?? "0Hz"
    ).trim();

  if (
    !/^[+-]?\d+Hz$/.test(pitch)
  ) {

    throw new Error(
      `Invalid pitch: ${pitch}`
    );

  }

  const value =
    parseInt(
      pitch.replace("Hz", ""),
      10
    );

  return (
    value >= 0
      ? `+${value}Hz`
      : `${value}Hz`
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
    escapeXml(
      cleanText(text)
    );

  const safeVoice =
    escapeXml(
      voice
    );

  return (
    `<speak version='1.0' ` +
    `xmlns='http://www.w3.org/2001/10/synthesis' ` +
    `xml:lang='en-US'>` +

      `<voice name='${safeVoice}'>` +

        `<prosody ` +
          `pitch='${pitch}' ` +
          `rate='${rate}' ` +
          `volume='${volume}'>` +

          safeText +

        `</prosody>` +

      `</voice>` +

    `</speak>`
  );

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
    `Path:speech.config\r\n` +
    `\r\n` +

    JSON.stringify({

      context: {

        synthesis: {

          audio: {

            metadataoptions: {

              sentenceBoundaryEnabled:
                "false",

              wordBoundaryEnabled:
                "true"

            },

            outputFormat

          }

        }

      }

    }) +

    `\r\n`
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
  volume
) {

  const requestId =
    generateUUID();

  const ssml =
    createSSML(
      text,
      voice,
      pitch,
      rate,
      volume
    );

  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${edgeTimestamp()}Z\r\n` +
    `Path:ssml\r\n` +
    `\r\n` +
    ssml
  );

}


/* =========================================================
   BINARY MESSAGE PARSER
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
      new Uint8Array(
        data
      );

  }

  /*
   * Blob
   */

  else if (
    typeof Blob !==
      "undefined" &&
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

    bytes =
      data;

  }

  /*
   * Other ArrayBuffer views
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


  if (
    bytes.length <
    2
  ) {

    return null;

  }


  /*
   * First 2 bytes:
   *
   * big endian header length
   */

  const headerLength =
    (bytes[0] << 8) |
    bytes[1];


  const headerStart =
    2;

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
      .decode(
        headerBytes
      );


  /*
   * Only accept Path:audio
   */

  if (
    !headers
      .toLowerCase()
      .includes(
        "path:audio"
      )
  ) {

    return null;

  }


  /*
   * Check Content-Type if available.
   */

  if (
    headers
      .toLowerCase()
      .includes(
        "content-type:audio/mpeg"
      ) === false
  ) {

    /*
     * Some responses may not
     * contain exactly the same
     * formatting, so don't fail.
     */

  }


  const audio =
    bytes.slice(
      audioStart
    );


  if (
    audio.length === 0
  ) {

    return null;

  }


  return audio;

}


/* =========================================================
   EDGE TTS
========================================================= */

export async function edgeTTS(
  payload = {}
) {

  const text =
    cleanText(
      payload.text
    );

  const voice =
    payload.voice ||
    "en-US-AriaNeural";

  const pitch =
    normalizePitch(
      payload.pitch
    );

  const rate =
    normalizeRate(
      payload.rate
    );

  const volume =
    normalizeVolume(
      payload.volume
    );

  const format =
    String(
      payload.format ||
      "mp3"
    ).toLowerCase();


  if (!text) {

    return Response.json(

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
            "+0%",

          volume:
            "+100%",

          format:
            "mp3"

        }

      },

      {
        status: 400,

        headers:
          CORS_HEADERS

      }

    );

  }


  /*
   * Output format
   */

  let outputFormat =
    OUTPUT_FORMAT.mp3;

  let contentType =
    "audio/mpeg";

  let filename =
    "edge-tts.mp3";


  if (
    format ===
    "mp3-96"
  ) {

    outputFormat =
      OUTPUT_FORMAT["mp3-96"];

    contentType =
      "audio/mpeg";

    filename =
      "edge-tts.mp3";

  }

  else if (
    format ===
    "webm"
  ) {

    outputFormat =
      OUTPUT_FORMAT.webm;

    contentType =
      "audio/webm; codecs=opus";

    filename =
      "edge-tts.webm";

  }


  /*
   * Generate security token
   */

  const secMsGec =
    await generateSecMsGec();


  /*
   * Connection ID
   */

  const connectionId =
    generateUUID();


  /*
   * WebSocket URL
   */

  const wsUrl =
    EDGE_TTS_URL +

    `?TrustedClientToken=${encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    )}` +

    `&Sec-MS-GEC=${encodeURIComponent(
      secMsGec
    )}` +

    `&Sec-MS-GEC-Version=${encodeURIComponent(
      SEC_MS_GEC_VERSION
    )}` +

    `&ConnectionId=${connectionId}`;


  /*
   * Create WebSocket
   */

  let ws;

  try {

    ws =
      new WebSocket(
        wsUrl
      );

  } catch (error) {

    throw new Error(
      `Edge TTS WebSocket create failed: ${
        error?.message ||
        error
      }`
    );

  }


  /*
   * Audio chunks
   */

  const audioChunks =
    [];

  let audioReceived =
    false;

  let finished =
    false;


  return await new Promise(
    (resolve, reject) => {

      let timeout;


      /*
       * Finish helper
       */

      const finish =
        (
          error = null
        ) => {

          if (finished) {
            return;
          }

          finished =
            true;

          if (timeout) {
            clearTimeout(
              timeout
            );
          }


          try {
            ws.close();
          } catch {}


          if (error) {

            reject(
              error
            );

            return;

          }


          if (
            !audioChunks.length
          ) {

            reject(
              new Error(
                "Edge TTS returned no audio"
              )
            );

            return;

          }


          /*
           * Merge audio
           */

          let totalLength =
            0;

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


          let offset =
            0;


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


          resolve(

            new Response(
              output,
              {
                status: 200,

                headers: {

                  "Content-Type":
                    contentType,

                  "Content-Disposition":
                    `inline; filename="${filename}"`,

                  "Content-Length":
                    String(
                      output.byteLength
                    ),

                  ...CORS_HEADERS

                }

              }
            )

          );

        };


      /*
       * Timeout
       */

      timeout =
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


      /*
       * OPEN
       */

      ws.addEventListener(
        "open",
        () => {

          try {

            /*
             * speech.config
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
                text,
                voice,
                pitch,
                rate,
                volume
              )
            );

          } catch (error) {

            finish(
              new Error(
                `Edge TTS send failed: ${
                  error?.message ||
                  error
                }`
              )
            );

          }

        }
      );


      /*
       * MESSAGE
       */

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
             * Text protocol message
             */

            if (
              typeof event.data ===
              "string"
            ) {

              const message =
                event.data;


              /*
               * turn.end
               */

              if (
                message.includes(
                  "Path:turn.end"
                )
              ) {

                if (
                  audioReceived
                ) {

                  finish();

                }

                else {

                  finish(
                    new Error(
                      "Edge TTS turn ended without audio"
                    )
                  );

                }

                return;

              }


              /*
               * session.end
               */

              if (
                message.includes(
                  "Path:session.end"
                )
              ) {

                if (
                  audioReceived
                ) {

                  finish();

                }

                return;

              }


              /*
               * response error
               */

              const lower =
                message.toLowerCase();


              if (
                lower.includes(
                  "error"
                ) &&
                !lower.includes(
                  "Path:turn.start"
                )
              ) {

                console.error(
                  "Edge TTS server message:",
                  message
                );

              }

            }

          } catch (error) {

            finish(
              new Error(
                `Edge TTS message error: ${
                  error?.message ||
                  error
                }`
              )
            );

          }

        }
      );


      /*
       * ERROR
       */

      ws.addEventListener(
        "error",
        event => {

          console.error(
            "Edge TTS WebSocket error:",
            event
          );


          finish(
            new Error(
              "Edge TTS WebSocket error"
            )
          );

        }
      );


      /*
       * CLOSE
       */

      ws.addEventListener(
        "close",
        () => {

          if (finished) {
            return;
          }


          /*
           * Some Edge TTS connections
           * close immediately after
           * the final audio.
           */

          if (
            audioReceived
          ) {

            finish();

          }

          else {

            finish(
              new Error(
                "Edge TTS WebSocket closed without audio"
              )
            );

          }

        }
      );

    }
  );

}


/* =========================================================
   GET VOICES
========================================================= */

export async function getEdgeVoices() {

  const secMsGec =
    await generateSecMsGec();


  const url =
    VOICES_URL +

    `?trustedclienttoken=${encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    )}` +

    `&Sec-MS-GEC=${encodeURIComponent(
      secMsGec
    )}` +

    `&Sec-MS-GEC-Version=${encodeURIComponent(
      SEC_MS_GEC_VERSION
    )}`;


  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers:
          VOICE_HEADERS
      }
    );


  if (
    !response.ok
  ) {

    const body =
      await response.text();

    throw new Error(
      `Edge voices request failed: ${response.status} ${body}`
    );

  }


  return await response.json();

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
     * Handle special locales such as:
     *
     * iu-Cans-CA
     * iu-Latn-CA
     */

    const parts =
      locale.split("-");


    const languageCode =
      parts[0];

    const regionCode =
      parts.length >= 3
        ? parts[parts.length - 1]
        : parts[1];


    const language =
      new Intl.DisplayNames(
        ["en"],
        {
          type:
            "language"
        }
      ).of(
        languageCode
      );


    const country =
      parts.length >= 2
        ? new Intl.DisplayNames(
            ["en"],
            {
              type:
                "region"
            }
          ).of(
            regionCode
          )
        : null;


    if (
      language &&
      country
    ) {

      return (
        `${language} (${country})`
      );

    }


    return (
      language ||
      locale
    );

  } catch {

    return locale;

  }

}


/* =========================================================
   GROUPS
========================================================= */

export async function edgeTTSGroups() {

  const allVoices =
    await getEdgeVoices();


  if (
    !Array.isArray(
      allVoices
    )
  ) {

    throw new Error(
      "Invalid Edge voices response"
    );

  }


  const map =
    new Map();


  for (
    const voice
    of allVoices
  ) {

    if (
      !voice?.Locale
    ) {
      continue;
    }


    if (
      map.has(
        voice.Locale
      )
    ) {
      continue;
    }


    map.set(
      voice.Locale,
      {
        value:
          voice.Locale,

        label:
          localeToLabel(
            voice.Locale
          )
      }
    );

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


  /*
   * IMPORTANT
   *
   * Return plain Response.
   *
   * index.js can pass it
   * directly to addCors().
   */

  return new Response(

    JSON.stringify({

      totalLocales:
        options.length,

      options

    }),

    {

      status:
        200,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...CORS_HEADERS

      }

    }

  );

}


/* =========================================================
   VOICES BY GROUP
========================================================= */

export async function edgeTTSVoicesByGroup(
  payload = {}
) {

  const group =
    payload.group ||
    "en-US";


  const allVoices =
    await getEdgeVoices();


  if (
    !Array.isArray(
      allVoices
    )
  ) {

    throw new Error(
      "Invalid Edge voices response"
    );

  }


  const voices =
    allVoices.filter(
      voice =>
        voice?.Locale ===
        group
    );


  const options =
    voices
      .map(
        voice => ({

          value:
            voice.ShortName ||
            voice.Name,

          label:
            `${voice.Gender || ""} - ${
              voice.DisplayName ||
              voice.LocalName ||
              voice.ShortName ||
              voice.Name
            }`.trim()

        })
      )
      .filter(
        voice =>
          voice.value
      );


  return new Response(

    JSON.stringify({

      group,

      total:
        options.length,

      options

    }),

    {

      status:
        200,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...CORS_HEADERS

      }

    }

  );

}
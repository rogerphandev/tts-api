/**
 * Microsoft Edge TTS for Cloudflare Workers
 *
 * 100% Cloudflare Workers
 * No Node.js
 * No fs
 * No FFmpeg
 * No @andresaya/edge-tts
 * No new WebSocket()
 *
 * Endpoints handled by index.js:
 *
 * ?engine=edge
 * ?engine=edge&action=groups
 * ?engine=edge&action=voices-by-group&group=en-US
 */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const EDGE_TTS_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";

const CHROMIUM_FULL_VERSION =
  "143.0.3650.75";


/* =========================================================
   OUTPUT FORMATS
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

  "Access-Control-Allow-Headers":
    "*",

  "Access-Control-Allow-Methods":
    "*",

  "Cache-Control":
    "no-store"

};


/* =========================================================
   SEC-MS-GEC
========================================================= */

async function generateSecMsGec() {

  /*
   * Microsoft Edge TTS uses Windows FILETIME.
   *
   * Unix -> Windows epoch:
   * 11644473600 seconds
   *
   * Rounded to 5 minutes.
   */

  const ticks =
    Math.floor(Date.now() / 1000)
    + 11644473600;

  const rounded =
    ticks - (ticks % 300);

  const windowsTicks =
    rounded * 10000000;

  const data =
    new TextEncoder().encode(
      `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`
    );

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array
    .from(new Uint8Array(hash))
    .map(byte =>
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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

}


/* =========================================================
   EDGE TIMESTAMP
========================================================= */

function edgeTimestamp() {

  return new Date()
    .toUTCString()
    .replace("UTC", "GMT");

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

    `X-Timestamp:${edgeTimestamp()}\r\n` +

    `Path:ssml\r\n\r\n` +

    ssml

  );

}


/* =========================================================
   BUILD EDGE TTS URL
========================================================= */

async function createEdgeUrl() {

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

  return {
    url,
    connectionId
  };

}


/* =========================================================
   CONNECT OUTBOUND WEBSOCKET
========================================================= */

async function connectEdgeWebSocket(url) {

  /*
   * IMPORTANT:
   *
   * Cloudflare Workers supports outbound
   * WebSocket through fetch() + Upgrade.
   *
   * We intentionally do NOT use:
   *
   * new WebSocket(...)
   */

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {

          "Upgrade":
            "websocket",

          "Connection":
            "Upgrade",

          "User-Agent":
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
            `AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) ` +
            `Chrome/${CHROMIUM_FULL_VERSION} ` +
            `Safari/537.36 ` +
            `Edg/${CHROMIUM_FULL_VERSION}`

        }

      }
    );

  if (!response.ok) {

    let body = "";

    try {
      body =
        await response.text();
    } catch {
      body = "";
    }

    throw new Error(
      `Edge TTS WebSocket handshake failed: ` +
      `${response.status}` +
      (body ? ` - ${body.slice(0, 500)}` : "")
    );

  }

  const ws =
    response.webSocket;

  if (!ws) {

    throw new Error(
      "Edge TTS server did not return WebSocket"
    );

  }

  /*
   * Accept the remote WebSocket.
   */

  ws.accept();

  /*
   * Force binary messages to ArrayBuffer.
   */

  try {
    ws.binaryType =
      "arraybuffer";
  } catch {
    // ignore
  }

  return ws;

}


/* =========================================================
   CONVERT WS MESSAGE TO BYTES
========================================================= */

async function messageToBytes(data) {

  if (
    data instanceof ArrayBuffer
  ) {

    return new Uint8Array(data);

  }

  if (
    typeof Blob !== "undefined" &&
    data instanceof Blob
  ) {

    return new Uint8Array(
      await data.arrayBuffer()
    );

  }

  if (
    data instanceof Uint8Array
  ) {

    return data;

  }

  if (
    ArrayBuffer.isView(data)
  ) {

    return new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength
    );

  }

  return null;

}


/* =========================================================
   EXTRACT AUDIO
========================================================= */

async function extractAudio(data) {

  const bytes =
    await messageToBytes(data);

  if (!bytes) {
    return null;
  }

  /*
   * Edge TTS binary message:
   *
   * 2 bytes:
   * header length
   *
   * headers
   *
   * audio
   */

  if (bytes.length < 2) {
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
    audioStart > bytes.length
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


  /* =======================================================
     VALIDATE TEXT
  ======================================================= */

  if (
    !text ||
    !String(text).trim()
  ) {

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
            "0%",

          volume:
            "100%",

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
     CONNECT
  ======================================================= */

  const {

    url,

    connectionId

  } =
    await createEdgeUrl();


  let ws;

  try {

    ws =
      await connectEdgeWebSocket(
        url
      );

  } catch (error) {

    throw new Error(
      error?.message ||
      "Edge TTS WebSocket connection failed"
    );

  }


  /* =======================================================
     AUDIO
  ======================================================= */

  const audioChunks = [];

  let finished = false;

  let audioReceived = false;

  let timeoutId;


  return await new Promise(
    (resolve, reject) => {


      /* ===================================================
         FINISH
      =================================================== */

      const finish =
        (error = null) => {

          if (finished) {
            return;
          }

          finished = true;

          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          try {
            ws.close();
          } catch {
            // ignore
          }


          if (error) {

            reject(error);

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


      /* ===================================================
         TIMEOUT
      =================================================== */

      timeoutId =
        setTimeout(
          () => {

            finish(
              new Error(
                "Edge TTS timeout"
              )
            );

          },
          30000
        );


      /* ===================================================
         OPEN
      =================================================== */

      try {

        ws.send(
          createSpeechConfig(
            outputFormat
          )
        );


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

      } catch (error) {

        finish(error);

        return;

      }


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
             * Text protocol message
             */

            if (
              typeof event.data ===
              "string"
            ) {

              const message =
                event.data;


              /*
               * Edge TTS sends:
               *
               * Path:turn.end
               *
               * at the end of synthesis.
               */

              if (
                message.includes(
                  "Path:turn.end"
                )
              ) {

                finish();

                return;

              }


              if (
                message.includes(
                  "Path:session.end"
                )
              ) {

                finish();

                return;

              }


              /*
               * Detect Edge server errors.
               */

              if (
                message.includes(
                  "Path:error"
                )
              ) {

                finish(
                  new Error(
                    `Edge TTS error: ${message.slice(0, 1000)}`
                  )
                );

              }

            }

          } catch (error) {

            finish(error);

          }

        }
      );


      /* ===================================================
         ERROR
      =================================================== */

      ws.addEventListener(
        "error",
        event => {

          if (finished) {
            return;
          }

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
           * Some Microsoft responses close
           * immediately after final audio.
           */

          if (audioReceived) {

            finish();

          } else {

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
   GET EDGE VOICES
========================================================= */

export async function getEdgeVoices() {

  const url =
    `${VOICES_URL}` +
    `?trustedclienttoken=${encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    )}`;


  const response =
    await fetch(
      url,
      {

        method: "GET",

        headers: {

          "Accept":
            "*/*",

          "User-Agent":
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
            `AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) ` +
            `Chrome/${CHROMIUM_FULL_VERSION} ` +
            `Safari/537.36 ` +
            `Edg/${CHROMIUM_FULL_VERSION}`

        }

      }
    );


  if (!response.ok) {

    throw new Error(
      `Edge voices request failed: ${response.status}`
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
     * Special Microsoft locales such as:
     *
     * iu-Cans-CA
     * iu-Latn-CA
     *
     * should not be incorrectly split.
     */

    const parts =
      locale.split("-");


    let languageCode =
      parts[0];

    let regionCode =
      parts[parts.length - 1];


    /*
     * For locales where the final part
     * is a script rather than country.
     */

    if (
      regionCode.length !== 2 &&
      regionCode.length !== 3
    ) {

      return locale;

    }


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


    return (
      `${language} (${country})`
    );

  } catch {

    return locale;

  }

}


/* =========================================================
   GROUPS
========================================================= */

export async function edgeTTSGroups(
  payload = {}
) {

  const allVoices =
    await getEdgeVoices();


  const options = [

    ...new Map(

      allVoices.map(
        voice => [

          voice.Locale,

          {

            value:
              voice.Locale,

            label:
              localeToLabel(
                voice.Locale
              )

          }

        ]
      )

    ).values()

  ].sort(
    (a, b) =>
      a.value.localeCompare(
        b.value
      )
  );


  return Response.json(

    {

      totalLocales:
        options.length,

      options

    },

    {

      status: 200,

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


  const voices =
    allVoices.filter(
      voice =>
        voice.Locale === group
    );


  const options =
    voices.map(
      voice => ({

        value:
          voice.ShortName ||
          voice.Name,

        label:
          `${voice.Gender} - ${voice.DisplayName}`,

        shortName:
          voice.ShortName,

        name:
          voice.Name,

        gender:
          voice.Gender,

        locale:
          voice.Locale

      })
    );


  return Response.json(

    {

      group,

      total:
        options.length,

      options

    },

    {

      status: 200,

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
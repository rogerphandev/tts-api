
/**
 * Edge TTS for Cloudflare Workers
 *
 * Endpoints:
 *
 * ?engine=edge
 * ?engine=edge&action=groups
 * ?engine=edge&action=voices-by-group&group=en-US
 *
 * No @andresaya/edge-tts
 * No Node.js
 * No fs
 * No FFmpeg
 */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const EDGE_TTS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";


/*
 * Current Chromium version used by the Edge TTS protocol.
 *
 * If Microsoft starts returning 403 / Sec-MS-GEC errors,
 * this value may need to be updated.
 */
const CHROMIUM_FULL_VERSION =
  "143.0.3650.75";


/* ===============================
   OUTPUT FORMATS
================================ */

const OUTPUT_FORMAT = {

  MP3_48:
    "audio-24khz-48kbitrate-mono-mp3",

  MP3_96:
    "audio-24khz-96kbitrate-mono-mp3",

  WEBM:
    "webm-24khz-16bit-mono-opus"

};


/* ===============================
   CORS
================================ */

const CORS_HEADERS = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers":
    "*",

  "Access-Control-Allow-Methods":
    "*",

  "Cache-Control":
    "no-store"

};


/* ===============================
   SEC-MS-GEC
================================ */

async function generateSecMsGec() {

  /*
   * Microsoft uses Windows FILETIME ticks.
   *
   * 11644473600 = Unix epoch offset
   *
   * Round to 5 minutes.
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


/* ===============================
   REQUEST ID
================================ */

function requestId() {

  return crypto
    .randomUUID()
    .replaceAll("-", "");

}


/* ===============================
   XML ESCAPE
================================ */

function escapeXml(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

}


/* ===============================
   DATE FORMAT
================================ */

function edgeTimestamp() {

  /*
   * Edge TTS accepts JavaScript-style
   * UTC date strings.
   */

  return new Date()
    .toUTCString()
    .replace("UTC", "GMT");

}


/* ===============================
   SSML
================================ */

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


/* ===============================
   SPEECH CONFIG
================================ */

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
                true

            },

            outputFormat

          }

        }

      }

    })
  );

}


/* ===============================
   SSML MESSAGE
================================ */

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


/* ===============================
   BINARY AUDIO EXTRACTION
================================ */

async function extractAudio(
  data
) {

  let bytes;


  /*
   * Workers may expose WebSocket
   * binary messages as ArrayBuffer,
   * Blob or Uint8Array.
   */

  if (data instanceof ArrayBuffer) {

    bytes =
      new Uint8Array(data);

  } else if (
    typeof Blob !== "undefined" &&
    data instanceof Blob
  ) {

    bytes =
      new Uint8Array(
        await data.arrayBuffer()
      );

  } else if (
    data instanceof Uint8Array
  ) {

    bytes =
      data;

  } else if (
    ArrayBuffer.isView(data)
  ) {

    bytes =
      new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength
      );

  } else {

    return null;

  }


  /*
   * Edge TTS binary message format:
   *
   * first 2 bytes = header length
   *
   * then headers
   *
   * then audio
   */

  if (bytes.length < 2) {

    return null;

  }


  const headerLength =
    (bytes[0] << 8)
    | bytes[1];


  const headerStart = 2;

  const audioStart =
    headerStart + headerLength;


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


/* ===============================
   EDGE TTS SYNTHESIS
================================ */

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


  /* ===============================
     FORMAT
  ================================= */

  let outputFormat;

  let contentType;

  let filename;


  switch (format) {

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


  /* ===============================
     SECURITY PARAMETERS
  ================================= */

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


  /* ===============================
     WEBSOCKET
  ================================= */

  const ws =
    new WebSocket(url);


  const audioChunks = [];


  let closed =
    false;

  let audioReceived =
    false;


  return await new Promise(
    (resolve, reject) => {

      const timeout =
        setTimeout(() => {

          if (!closed) {

            closed = true;

            try {
              ws.close();
            } catch {}

            reject(
              new Error(
                "Edge TTS WebSocket timeout"
              )
            );

          }

        }, 30000);


      ws.addEventListener(
        "open",
        () => {

          try {

            /*
             * Send speech configuration
             */

            ws.send(
              createSpeechConfig(
                outputFormat
              )
            );


            /*
             * Send SSML
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

          } catch (error) {

            clearTimeout(timeout);

            closed = true;

            try {
              ws.close();
            } catch {}

            reject(error);

          }

        }
      );


      ws.addEventListener(
        "message",
        async event => {

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
             * Text response
             */

            if (
              typeof event.data ===
              "string"
            ) {

              const message =
                event.data;


              /*
               * SessionEnd means
               * synthesis completed.
               */

              if (
                message.includes(
                  "Path:turn.end"
                ) ||
                message.includes(
                  "Path:session.end"
                )
              ) {

                finish();

              }

            }

          } catch (error) {

            finish(error);

          }

        }
      );


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


      ws.addEventListener(
        "close",
        () => {

          /*
           * Some Edge TTS responses
           * close the socket immediately
           * after sending the final audio.
           */

          if (
            !closed
          ) {

            if (
              audioReceived
            ) {

              finish();

            } else {

              finish(
                new Error(
                  "Edge TTS WebSocket closed without audio"
                )
              );

            }

          }

        }
      );


      function finish(
        error = null
      ) {

        if (closed) {
          return;
        }


        closed = true;

        clearTimeout(timeout);


        try {
          ws.close();
        } catch {}


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


        /*
         * Merge chunks
         */

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


        resolve(

          new Response(
            output,

            {

              status: 200,

              headers: {

                "Content-Type":
                  contentType,

                "Content-Disposition":
                  `inline; filename=${filename}`,

                "Content-Length":
                  String(
                    output.byteLength
                  ),

                "Access-Control-Allow-Origin":
                  "*",

                "Cache-Control":
                  "no-store"

              }

            }

          )

        );

      }

    }
  );

}


/* ===============================
   GET VOICES
================================ */

export async function getEdgeVoices() {

  const url =
    `${VOICES_URL}` +
    `?trustedclienttoken=${encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    )}`;


  const response =
    await fetch(url, {

      headers: {

        "Accept":
          "*/*",

        "User-Agent":
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
          `(KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} ` +
          `Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`

      }

    });


  if (!response.ok) {

    throw new Error(
      `Edge voices request failed: ${response.status}`
    );

  }


  return await response.json();

}


/* ===============================
   LOCALE LABEL
================================ */

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


    const [
      languageCode,
      regionCode
    ] =
      locale.split("-");


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


    return `${language} (${country})`;

  } catch {

    return locale;

  }

}


/* ===============================
   GROUPS
================================ */

export async function edgeTTSGroups() {

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


  return new Response(

    JSON.stringify({

      totalLocales:
        options.length,

      options

    }),

    {

      status: 200,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "public, max-age=86400",

        ...CORS_HEADERS

      }

    }

  );

}


/* ===============================
   VOICES BY GROUP
================================ */

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
          `${voice.Gender} - ${voice.DisplayName}`

      })
    );


  return new Response(

    JSON.stringify({

      group,

      total:
        options.length,

      options

    }),

    {

      status: 200,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "public, max-age=86400",

        ...CORS_HEADERS

      }

    }

  );

}

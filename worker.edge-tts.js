/**
 * Edge TTS for Cloudflare Workers
 *
 * Endpoints:
 *
 * ?engine=edge&action=groups
 * ?engine=edge&action=voices-by-group&group=en-US
 * ?engine=edge&text=Hello&voice=en-US-AriaNeural
 *
 * Cloudflare Workers compatible.
 *
 * NO Node.js
 * NO fs
 * NO FFmpeg
 * NO @andresaya/edge-tts
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
   OUTPUT FORMAT
========================================================= */

const OUTPUT_FORMAT = {
  MP3_48: "audio-24khz-48kbitrate-mono-mp3",
  MP3_96: "audio-24khz-96kbitrate-mono-mp3",
  WEBM: "webm-24khz-16bit-mono-opus"
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
   SEC-MS-GEC
========================================================= */

async function generateSecMsGec() {
  /*
   * Microsoft FILETIME
   *
   * IMPORTANT:
   * FILETIME = Unix seconds + 11644473600
   * then round to 5 minutes.
   */

  const unixSeconds =
    Math.floor(Date.now() / 1000);

  const fileTimeSeconds =
    unixSeconds + 11644473600;

  const rounded =
    fileTimeSeconds -
    (fileTimeSeconds % 300);

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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


/* =========================================================
   TIMESTAMP
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
      pitch="${escapeXml(pitch)}"
      rate="${escapeXml(rate)}"
      volume="${escapeXml(volume)}">

      ${safeText}

    </prosody>

  </voice>

</speak>
`.trim();
}


/* =========================================================
   SPEECH CONFIG
========================================================= */

function createSpeechConfig(outputFormat) {
  return (
    `X-Timestamp:${edgeTimestamp()}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +

    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: false,
              wordBoundaryEnabled: true
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
   BINARY AUDIO EXTRACTION
========================================================= */

async function extractAudio(data) {
  let bytes;

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

    bytes = data;

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


  if (bytes.length < 2) {
    return null;
  }


  /*
   * Edge TTS binary frame:
   *
   * 2 bytes header length
   * N bytes headers
   * remaining bytes audio
   */

  const headerLength =
    (bytes[0] << 8) |
    bytes[1];

  const audioStart =
    2 + headerLength;


  if (
    audioStart > bytes.length
  ) {
    return null;
  }


  const headerBytes =
    bytes.slice(
      2,
      audioStart
    );


  const headers =
    new TextDecoder()
      .decode(headerBytes);


  if (
    !headers
      .toLowerCase()
      .includes("path:audio")
  ) {
    return null;
  }


  return bytes.slice(
    audioStart
  );
}


/* =========================================================
   CREATE EDGE TTS WEBSOCKET URL
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
   EDGE TTS SYNTHESIS
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

        headers: {
          ...CORS_HEADERS
        }
      }
    );
  }


  /* =====================================================
     FORMAT
  ===================================================== */

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


  /* =====================================================
     CREATE URL
  ===================================================== */

  const {
    url,
    connectionId
  } =
    await createEdgeUrl();


  /*
   * IMPORTANT
   *
   * Cloudflare Workers supports outbound
   * WebSocket through fetch().
   *
   * Do NOT use:
   *
   * new WebSocket(...)
   *
   * here.
   */

  let response;

  try {

    response =
      await fetch(
        url,
        {
          headers: {
            "Upgrade":
              "websocket"
          }
        }
      );

  } catch (error) {

    throw new Error(
      `Edge TTS WebSocket connection failed: ${
        error?.message ||
        "unknown error"
      }`
    );
  }


  /*
   * Cloudflare successful WebSocket handshake
   * exposes response.webSocket.
   *
   * Do NOT reject based only on status 101.
   */

  const ws =
    response?.webSocket;


  if (!ws) {

    let errorBody = "";

    try {
      errorBody =
        await response.text();
    } catch {}


    throw new Error(
      `Edge TTS WebSocket handshake failed: ${
        response.status
      } ${
        response.statusText || ""
      } ${
        errorBody
          ? errorBody.slice(0, 500)
          : ""
      }`.trim()
    );
  }


  /*
   * IMPORTANT:
   * accept() the outbound WebSocket.
   */

  ws.accept();


  const audioChunks = [];

  let finished = false;
  let audioReceived = false;


  return await new Promise(
    (resolve, reject) => {

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


      /* =================================================
         FINISH
      ================================================= */

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
      }


      /* =================================================
         OPEN
      ================================================= */

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
          }
        }
      );


      /* =================================================
         MESSAGE
      ================================================= */

      ws.addEventListener(
        "message",
        async event => {

          try {

            /*
             * Binary message
             */

            const audio =
              await extractAudio(
                event.data
              );


            if (audio) {

              audioReceived = true;

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
               * turn.end
               */

              if (
                message.includes(
                  "Path:turn.end"
                )
              ) {

                finish();

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

                finish();

                return;
              }


              /*
               * Error from Microsoft
               */

              if (
                message
                  .toLowerCase()
                  .includes("error")
              ) {

                console.error(
                  "Edge TTS response:",
                  message
                );
              }
            }

          } catch (error) {

            finish(error);
          }
        }
      );


      /* =================================================
         ERROR
      ================================================= */

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


      /* =================================================
         CLOSE
      ================================================= */

      ws.addEventListener(
        "close",
        () => {

          if (finished) {
            return;
          }


          /*
           * Microsoft can close immediately
           * after the final audio packet.
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
   GET VOICES
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
        headers: {

          "Accept":
            "*/*",

          "User-Agent":
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
            `AppleWebKit/537.36 (KHTML, like Gecko) ` +
            `Chrome/${CHROMIUM_FULL_VERSION} ` +
            `Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`
        }
      }
    );


  if (!response.ok) {

    const text =
      await response.text()
        .catch(() => "");

    throw new Error(
      `Edge voices request failed: ${
        response.status
      } ${
        text
          ? text.slice(0, 500)
          : ""
      }`
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
     * Special locales such as:
     *
     * iu-Cans-CA
     * iu-Latn-CA
     *
     * have 3 sections.
     */

    const parts =
      locale.split("-");


    let languageCode;
    let regionCode;


    if (parts.length >= 3) {

      languageCode =
        parts[0];

      regionCode =
        parts[parts.length - 1];

    } else {

      languageCode =
        parts[0];

      regionCode =
        parts[1];
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


    return `${language} (${country})`;

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
    !Array.isArray(allVoices)
  ) {

    throw new Error(
      "Edge voices API returned invalid data"
    );
  }


  const map =
    new Map();


  for (
    const voice
    of allVoices
  ) {

    if (
      !voice ||
      !voice.Locale
    ) {
      continue;
    }


    if (
      !map.has(
        voice.Locale
      )
    ) {

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
  }


  const options =
    Array
      .from(map.values())
      .sort(
        (a, b) =>
          a.value.localeCompare(
            b.value
          )
      );


  /*
   * IMPORTANT:
   *
   * Return plain object.
   *
   * index.js will wrap this into:
   *
   * {
   *   statusCode,
   *   headers,
   *   body
   * }
   */

  return {
    totalLocales:
      options.length,

    options
  };
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
    !Array.isArray(allVoices)
  ) {

    throw new Error(
      "Edge voices API returned invalid data"
    );
  }


  const voices =
    allVoices.filter(
      voice =>
        voice &&
        voice.Locale === group
    );


  const options =
    voices.map(
      voice => ({

        value:
          voice.ShortName ||
          voice.Name,

        label:
          `${voice.Gender || ""} - ${
            voice.DisplayName ||
            voice.LocalName ||
            voice.Name ||
            ""
          }`.trim()

      })
    );


  return {
    group,

    total:
      options.length,

    options
  };
}
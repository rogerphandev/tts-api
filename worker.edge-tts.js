/**
 * worker.edge-tts.js
 *
 * Microsoft Edge TTS Consumer
 * Cloudflare Workers
 *
 * Features:
 * - No SPEECH_KEY
 * - No Azure key
 * - No Node.js
 * - No fs
 * - No FFmpeg
 * - All Edge voices
 * - groups
 * - voices-by-group
 * - MP3 48 kbps
 * - MP3 96 kbps
 * - WebM Opus
 *
 * IMPORTANT:
 * Edge Consumer synthesis uses WebSocket.
 */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const BASE_URL =
  "speech.platform.bing.com/consumer/speech/synthesize/readaloud";

const WSS_URL =
  `wss://${BASE_URL}/edge/v1`;

const VOICES_URL =
  `https://${BASE_URL}/voices/list`;

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
  "Access-Control-Allow-Methods":
    "GET, POST, OPTIONS",
  "Cache-Control": "no-store"
};


/* =========================================================
   USER AGENT
========================================================= */

const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
  `AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 ` +
  `Safari/537.36 ` +
  `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;


/* =========================================================
   EDGE HEADERS
========================================================= */

const BASE_HEADERS = {
  "User-Agent":
    USER_AGENT,

  "Accept-Encoding":
    "gzip, deflate, br",

  "Accept-Language":
    "en-US,en;q=0.9"
};


/* =========================================================
   REQUEST ID
========================================================= */

function requestId() {

  return crypto
    .randomUUID()
    .replaceAll("-", "")
    .toUpperCase();

}


/* =========================================================
   SEC-MS-GEC
========================================================= */

async function generateSecMsGec() {

  const unixSeconds =
    Math.floor(
      Date.now() / 1000
    );

  const fileTimeSeconds =
    unixSeconds +
    11644473600;

  const rounded =
    fileTimeSeconds -
    (
      fileTimeSeconds % 300
    );

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

  return new Date()
    .toUTCString();

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
   SSML
========================================================= */

function createSSML(
  text,
  voice,
  pitch,
  rate,
  volume
) {

  return `
<speak
  version="1.0"
  xmlns="http://www.w3.org/2001/10/synthesis"
  xmlns:mstts="https://www.w3.org/2001/mstts"
  xml:lang="en-US">

  <voice name="${escapeXml(voice)}">

    <prosody
      pitch="${escapeXml(pitch)}"
      rate="${escapeXml(rate)}"
      volume="${escapeXml(volume)}">

      ${escapeXml(text)}

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
  connectionId
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
    `X-RequestId:${connectionId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${edgeTimestamp()}\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );

}


/* =========================================================
   CREATE WSS URL
========================================================= */

async function createEdgeUrl() {

  const secMsGec =
    await generateSecMsGec();

  const connectionId =
    requestId();

  const params =
    new URLSearchParams();

  params.set(
    "TrustedClientToken",
    TRUSTED_CLIENT_TOKEN
  );

  params.set(
    "Sec-MS-GEC",
    secMsGec
  );

  params.set(
    "Sec-MS-GEC-Version",
    `1-${CHROMIUM_FULL_VERSION}`
  );

  params.set(
    "ConnectionId",
    connectionId
  );

  return {
    url:
      `${WSS_URL}?${params.toString()}`,

    connectionId
  };

}


/* =========================================================
   BINARY AUDIO EXTRACTION
========================================================= */

function extractAudio(
  data
) {

  let bytes;

  if (
    data instanceof ArrayBuffer
  ) {

    bytes =
      new Uint8Array(data);

  }

  else if (
    data instanceof Uint8Array
  ) {

    bytes =
      data;

  }

  else {

    return null;

  }


  if (
    bytes.length < 2
  ) {

    return null;

  }


  /*
   * Edge TTS binary frame:
   *
   * 2 bytes:
   * header length
   *
   * N bytes:
   * headers
   *
   * remaining:
   * audio
   */

  const headerLength =
    (
      bytes[0] << 8
    ) |
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
      .includes(
        "path:audio"
      )
  ) {

    return null;

  }


  const audio =
    bytes.slice(
      audioStart
    );


  if (
    !audio.length
  ) {

    return null;

  }


  return audio;

}


/* =========================================================
   EDGE SYNTHESIS
========================================================= */

export async function edgeTTS(
  payload = {}
) {

  const text =
    String(
      payload.text || ""
    ).trim();

  const voice =
    String(
      payload.voice ||
      "en-US-AriaNeural"
    );

  const pitch =
    String(
      payload.pitch ||
      "+0Hz"
    );

  const rate =
    String(
      payload.rate ||
      "0%"
    );

  const volume =
    String(
      payload.volume ||
      "100%"
    );

  const format =
    String(
      payload.format ||
      "mp3"
    ).toLowerCase();


  if (!text) {

    return new Response(
      JSON.stringify({
        message:
          "Text is required"
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
     FORMAT
  ======================================================= */

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


  /* =======================================================
     URL
  ======================================================= */

  const {
    url,
    connectionId
  } =
    await createEdgeUrl();


  /*
   * Cloudflare Workers supports creating
   * outbound WebSocket connections with
   *
   * fetch(url, {
   *   headers: {
   *     Upgrade: "websocket"
   *   }
   * })
   *
   * Cloudflare automatically handles
   * Sec-WebSocket-Key etc.
   */

  let response;

  try {

    response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {

            ...BASE_HEADERS,

            "Upgrade":
              "websocket",

            "Pragma":
              "no-cache",

            "Cache-Control":
              "no-cache",

            "Origin":
              "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
          }
        }
      );

  }

  catch (error) {

    throw new Error(
      `Edge WebSocket fetch failed: ${
        error?.message ||
        "unknown error"
      }`
    );

  }


  /*
   * IMPORTANT:
   *
   * Cloudflare exposes response.webSocket
   * only when the remote endpoint accepts
   * the WebSocket handshake.
   */

  const ws =
    response.webSocket;


  if (!ws) {

    let body = "";

    try {

      body =
        await response.text();

    }

    catch {}

    throw new Error(
      `Edge WebSocket handshake failed: ` +
      `${response.status} ` +
      `${response.statusText || ""} ` +
      `${body.slice(0, 500)}`
    );

  }


  /*
   * Binary messages should arrive as ArrayBuffer.
   */

  ws.binaryType =
    "arraybuffer";

  ws.accept();


  const audioChunks = [];

  let audioReceived =
    false;

  let finished =
    false;


  return await new Promise(
    (resolve, reject) => {

      const timeout =
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
         FINISH
      =================================================== */

      function finish(
        error = null
      ) {

        if (finished) {

          return;

        }

        finished =
          true;

        clearTimeout(
          timeout
        );


        try {

          ws.close();

        }

        catch {}


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


        let total =
          0;


        for (
          const chunk
          of audioChunks
        ) {

          total +=
            chunk.length;

        }


        const output =
          new Uint8Array(
            total
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

                "Content-Length":
                  String(
                    output.byteLength
                  ),

                "Content-Disposition":
                  `inline; filename="${filename}"`,

                ...CORS_HEADERS

              }
            }
          )
        );

      }


      /* ===================================================
         OPEN
      =================================================== */

      ws.addEventListener(
        "open",
        () => {

          try {

            ws.send(
              createSpeechConfig(
                outputFormat
              )
            );


            ws.send(
              createSSMLMessage(
                text,
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

          try {

            /*
             * Binary audio
             */

            if (
              typeof event.data !==
              "string"
            ) {

              const audio =
                extractAudio(
                  event.data
                );


              if (audio) {

                audioReceived =
                  true;

                audioChunks.push(
                  audio
                );

              }

              return;

            }


            /*
             * Text protocol message
             */

            const message =
              event.data;


            /*
             * Error
             */

            if (
              message
                .toLowerCase()
                .includes(
                  "error"
                )
            ) {

              console.error(
                "Edge TTS:",
                message
              );

            }


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
        event => {

          console.error(
            "Edge WebSocket error:",
            event
          );

          finish(
            new Error(
              "Edge WebSocket error"
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


          if (
            audioReceived
          ) {

            finish();

          }

          else {

            finish(
              new Error(
                "Edge WebSocket closed without audio"
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

  const secMsGec =
    await generateSecMsGec();


  const params =
    new URLSearchParams();


  params.set(
    "trustedclienttoken",
    TRUSTED_CLIENT_TOKEN
  );


  params.set(
    "Sec-MS-GEC",
    secMsGec
  );


  params.set(
    "Sec-MS-GEC-Version",
    `1-${CHROMIUM_FULL_VERSION}`
  );


  const url =
    `${VOICES_URL}?${params.toString()}`;


  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {

          ...BASE_HEADERS,

          "Authority":
            "speech.platform.bing.com",

          "Accept":
            "*/*",

          "Sec-CH-UA":
            `" Not;A Brand";v="99", ` +
            `"Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", ` +
            `"Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,

          "Sec-CH-UA-Mobile":
            "?0",

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

    const body =
      await response.text()
        .catch(
          () => ""
        );


    throw new Error(
      `Edge voices request failed: ` +
      `${response.status} ` +
      `${body.slice(0, 500)}`
    );

  }


  const data =
    await response.json();


  if (
    !Array.isArray(data)
  ) {

    throw new Error(
      "Edge voices API returned invalid data"
    );

  }


  return data;

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


    return (
      `${language} (${country})`
    );

  }

  catch {

    return locale;

  }

}


/* =========================================================
   GROUPS
========================================================= */

export async function edgeTTSGroups() {

  const allVoices =
    await getEdgeVoices();


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
      .from(
        map.values()
      )
      .sort(
        (a, b) =>
          a.value.localeCompare(
            b.value
          )
      );


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
    String(
      payload.group ||
      "en-US"
    );


  const allVoices =
    await getEdgeVoices();


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
          [
            voice.Gender,
            voice.DisplayName ||
            voice.LocalName ||
            voice.Name
          ]
            .filter(Boolean)
            .join(" - "),

        shortName:
          voice.ShortName ||
          voice.Name,

        locale:
          voice.Locale,

        gender:
          voice.Gender,

        displayName:
          voice.DisplayName,

        localName:
          voice.LocalName

      })
    );


  return {

    group,

    total:
      options.length,

    options

  };

}
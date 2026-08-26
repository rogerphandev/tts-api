/**
 * worker.edge-tts.js
 *
 * Microsoft Edge TTS for Cloudflare Workers
 *
 * NO SPEECH_KEY
 * NO AZURE KEY
 * NO Node.js
 * NO fs
 * NO FFmpeg
 *
 * Endpoints are handled by index.js:
 *
 * ?engine=edge&action=groups
 * ?engine=edge&action=voices-by-group&group=en-US
 * ?engine=edge&text=Hello&voice=en-US-AriaNeural
 */

const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const EDGE_BASE =
  "speech.platform.bing.com";

const EDGE_WSS_URL =
  `wss://${EDGE_BASE}/consumer/speech/synthesize/readaloud/edge/v1`;

const VOICES_URL =
  `https://${EDGE_BASE}/consumer/speech/synthesize/readaloud/voices/list`;


/*
 * Keep this synchronized with the current Edge TTS
 * Chromium version used by current implementations.
 */
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
  MP3_48:
    "audio-24khz-48kbitrate-mono-mp3",

  MP3_96:
    "audio-24khz-96kbitrate-mono-mp3",

  WEBM:
    "webm-24khz-16bit-mono-opus"
};


/* =========================================================
   HEADERS
========================================================= */

const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
  `AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 ` +
  `Safari/537.36 ` +
  `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;


const BASE_HEADERS = {
  "User-Agent":
    USER_AGENT,

  "Accept-Encoding":
    "gzip, deflate, br, zstd",

  "Accept-Language":
    "en-US,en;q=0.9"
};


const VOICE_HEADERS = {
  ...BASE_HEADERS,

  "Accept":
    "*/*",

  "Referer":
    "https://speech.platform.bing.com/"
};


const WSS_HEADERS = {
  ...BASE_HEADERS,

  "Pragma":
    "no-cache",

  "Cache-Control":
    "no-cache",

  "Origin":
    "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
};


/* =========================================================
   CORS
========================================================= */

const CORS_HEADERS = {
  "Cache-Control":
    "no-store",

  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "*",

  "Access-Control-Allow-Methods":
    "GET, POST, OPTIONS"
};


/* =========================================================
   RANDOM ID
========================================================= */

function randomId() {

  return crypto
    .randomUUID()
    .replaceAll("-", "")
    .toUpperCase();

}


/* =========================================================
   MUID
========================================================= */

function generateMuid() {

  const bytes =
    new Uint8Array(16);

  crypto.getRandomValues(bytes);

  return Array
    .from(bytes)
    .map(
      b =>
        b
          .toString(16)
          .padStart(2, "0")
    )
    .join("")
    .toUpperCase();

}


/* =========================================================
   SEC-MS-GEC
========================================================= */

async function generateSecMsGec() {

  /*
   * Microsoft FILETIME:
   *
   * Unix seconds
   * +
   * 11644473600
   *
   * rounded to 5 minutes.
   */

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


  const input =
    `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`;


  const data =
    new TextEncoder()
      .encode(input);


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
    .toUTCString()
    .replace(
      "UTC",
      "GMT"
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
   NORMALIZE RATE
========================================================= */

function normalizeRate(rate) {

  if (
    rate === undefined ||
    rate === null ||
    rate === ""
  ) {
    return "0%";
  }


  const value =
    String(rate)
      .replace("%", "")
      .trim();


  const number =
    Number(value);


  if (
    !Number.isFinite(number)
  ) {
    throw new Error(
      "Invalid rate"
    );
  }


  const clamped =
    Math.max(
      -100,
      Math.min(
        100,
        number
      )
    );


  return (
    clamped >= 0
      ? `+${clamped}%`
      : `${clamped}%`
  );

}


/* =========================================================
   NORMALIZE PITCH
========================================================= */

function normalizePitch(pitch) {

  if (
    pitch === undefined ||
    pitch === null ||
    pitch === ""
  ) {
    return "0Hz";
  }


  const value =
    String(pitch)
      .replace("Hz", "")
      .trim();


  const number =
    Number(value);


  if (
    !Number.isFinite(number)
  ) {
    throw new Error(
      "Invalid pitch"
    );
  }


  const clamped =
    Math.max(
      -100,
      Math.min(
        100,
        number
      )
    );


  return (
    clamped >= 0
      ? `+${clamped}Hz`
      : `${clamped}Hz`
  );

}


/* =========================================================
   NORMALIZE VOLUME
========================================================= */

function normalizeVolume(volume) {

  if (
    volume === undefined ||
    volume === null ||
    volume === ""
  ) {
    return "0%";
  }


  const value =
    String(volume)
      .replace("%", "")
      .trim();


  const number =
    Number(value);


  if (
    !Number.isFinite(number)
  ) {
    throw new Error(
      "Invalid volume"
    );
  }


  const clamped =
    Math.max(
      -100,
      Math.min(
        100,
        number
      )
    );


  return (
    clamped >= 0
      ? `+${clamped}%`
      : `${clamped}%`
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


  return (
    `<speak ` +
    `version="1.0" ` +
    `xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" ` +
    `xml:lang="en-US">` +

    `<voice name="${safeVoice}">` +

    `<prosody ` +
    `pitch="${escapeXml(pitch)}" ` +
    `rate="${escapeXml(rate)}" ` +
    `volume="${escapeXml(volume)}">` +

    `${safeText}` +

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

    `Path:speech.config\r\n\r\n` +

    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled:
                "false",

              wordBoundaryEnabled:
                "false"
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
  requestId
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
    `X-RequestId:${requestId}\r\n` +

    `Content-Type:application/ssml+xml\r\n` +

    `X-Timestamp:${edgeTimestamp()}\r\n` +

    `Path:ssml\r\n\r\n` +

    ssml
  );

}


/* =========================================================
   EXTRACT AUDIO
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
    bytes.length < 2
  ) {
    return null;
  }


  /*
   * Edge TTS binary packet:
   *
   * 2 bytes:
   * header length
   *
   * headers
   *
   * audio data
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


  const headers =
    new TextDecoder()
      .decode(
        bytes.slice(
          2,
          audioStart
        )
      );


  if (
    !headers
      .toLowerCase()
      .includes(
        "path:audio"
      )
  ) {

    return null;

  }


  return bytes.slice(
    audioStart
  );

}


/* =========================================================
   BUILD EDGE WS URL
========================================================= */

async function createEdgeWebSocketUrl() {

  const secMsGec =
    await generateSecMsGec();


  const connectionId =
    randomId();


  const url =
    `${EDGE_WSS_URL}` +

    `?TrustedClientToken=` +
    encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    ) +

    `&Sec-MS-GEC=` +
    encodeURIComponent(
      secMsGec
    ) +

    `&Sec-MS-GEC-Version=` +
    encodeURIComponent(
      SEC_MS_GEC_VERSION
    ) +

    `&ConnectionId=` +
    encodeURIComponent(
      connectionId
    );


  return {
    url,
    connectionId
  };

}


/* =========================================================
   CONNECT OUTBOUND WEBSOCKET
========================================================= */

async function connectEdgeWebSocket(
  url
) {

  /*
   * Cloudflare Workers supports:
   *
   * fetch(url, {
   *   headers: {
   *     Upgrade: "websocket"
   *   }
   * })
   *
   * The runtime handles the WebSocket
   * handshake.
   */

  const response =
    await fetch(
      url,
      {
        headers: {
          ...WSS_HEADERS,

          "Upgrade":
            "websocket"
        }
      }
    );


  if (
    !response.webSocket
  ) {

    let body = "";

    try {
      body =
        await response.text();
    }
    catch {}


    throw new Error(
      `Edge TTS handshake failed: ` +
      `${response.status} ` +
      `${response.statusText || ""}` +
      `${
        body
          ? ` - ${body.slice(0, 500)}`
          : ""
      }`
    );

  }


  const ws =
    response.webSocket;


  ws.accept();


  return ws;

}


/* =========================================================
   EDGE TTS
========================================================= */

export async function edgeTTS(
  payload = {}
) {

  const text =
    String(
      payload.text || ""
    ).trim();


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


  const voice =
    String(
      payload.voice ||
      "en-US-AriaNeural"
    );


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


  const {
    url,
    connectionId
  } =
    await createEdgeWebSocketUrl();


  const ws =
    await connectEdgeWebSocket(
      url
    );


  const audioChunks = [];

  let audioReceived =
    false;

  let finished =
    false;


  return await new Promise(
    (resolve, reject) => {

      let timeout;


      function cleanup() {

        if (timeout) {
          clearTimeout(timeout);
        }


        try {
          ws.close();
        }
        catch {}

      }


      function finish(
        error = null
      ) {

        if (finished) {
          return;
        }


        finished = true;


        cleanup();


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


      timeout =
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

      ws.addEventListener(
        "open",
        () => {

          try {

            /*
             * 1. speech.config
             */

            ws.send(
              createSpeechConfig(
                outputFormat
              )
            );


            /*
             * 2. SSML
             */

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
        event => {

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
             * Error message
             */

            if (
              /Path:error/i.test(
                message
              ) ||
              /error/i.test(
                message
              )
            ) {

              console.error(
                "Edge TTS message:",
                message
              );

            }


            /*
             * End of turn
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
             * End of session
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
              else {

                finish(
                  new Error(
                    "Edge TTS session ended without audio"
                  )
                );

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
   GET ALL EDGE VOICES
========================================================= */

export async function getEdgeVoices() {

  /*
   * Important:
   *
   * voices/list also requires
   * Sec-MS-GEC.
   */

  const secMsGec =
    await generateSecMsGec();


  const url =
    `${VOICES_URL}` +

    `?trustedclienttoken=` +
    encodeURIComponent(
      TRUSTED_CLIENT_TOKEN
    ) +

    `&Sec-MS-GEC=` +
    encodeURIComponent(
      secMsGec
    ) +

    `&Sec-MS-GEC-Version=` +
    encodeURIComponent(
      SEC_MS_GEC_VERSION
    );


  const muid =
    generateMuid();


  const response =
    await fetch(
      url,
      {
        headers: {
          ...VOICE_HEADERS,

          "Cookie":
            `muid=${muid};`
        }
      }
    );


  /*
   * First request failed.
   *
   * Usually this can be caused by
   * clock skew / token timing.
   *
   * Retry once with a freshly generated token.
   */

  if (
    response.status === 403
  ) {

    const retrySecMsGec =
      await generateSecMsGec();


    const retryUrl =
      `${VOICES_URL}` +

      `?trustedclienttoken=` +
      encodeURIComponent(
        TRUSTED_CLIENT_TOKEN
      ) +

      `&Sec-MS-GEC=` +
      encodeURIComponent(
        retrySecMsGec
      ) +

      `&Sec-MS-GEC-Version=` +
      encodeURIComponent(
        SEC_MS_GEC_VERSION
      );


    const retry =
      await fetch(
        retryUrl,
        {
          headers: {
            ...VOICE_HEADERS,

            "Cookie":
              `muid=${generateMuid()};`
          }
        }
      );


    if (
      !retry.ok
    ) {

      const body =
        await retry.text()
          .catch(
            () => ""
          );


      throw new Error(
        `Edge voices request failed: ` +
        `${retry.status} ` +
        `${
          body
            ? body.slice(0, 500)
            : ""
        }`
      );

    }


    const data =
      await retry.json();


    return Array.isArray(data)
      ? data
      : [];

  }


  if (
    !response.ok
  ) {

    const body =
      await response.text()
        .catch(
          () => ""
        );


    throw new Error(
      `Edge voices request failed: ` +
      `${response.status} ` +
      `${
        body
          ? body.slice(0, 500)
          : ""
      }`
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

  if (
    !locale ||
    !locale.includes("-")
  ) {

    return locale;

  }


  try {

    const parts =
      locale.split("-");


    const languageCode =
      parts[0];


    const regionCode =
      parts[
        parts.length - 1
      ];


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
      new Intl.DisplayNames(
        ["en"],
        {
          type:
            "region"
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
   ALL GROUPS
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
      voice => {

        const shortName =
          voice.ShortName ||
          voice.Name ||
          "";


        const displayName =
          voice.DisplayName ||
          voice.LocalName ||
          voice.FriendlyName ||
          shortName;


        return {

          value:
            shortName,

          label:
            `${voice.Gender || ""} - ${displayName}`
              .replace(
                /^\s*-\s*/,
                ""
              )
              .trim(),

          voice: {
            Name:
              voice.Name ||
              shortName,

            ShortName:
              shortName,

            DisplayName:
              voice.DisplayName ||
              null,

            LocalName:
              voice.LocalName ||
              null,

            Gender:
              voice.Gender ||
              null,

            Locale:
              voice.Locale ||
              group,

            VoiceType:
              voice.VoiceType ||
              null
          }

        };

      }
    );


  return {

    group,

    total:
      options.length,

    options

  };

}


/* =========================================================
   EXPORT ALL VOICES
========================================================= */

export async function edgeTTSAllVoices() {

  const voices =
    await getEdgeVoices();


  return {

    total:
      voices.length,

    voices

  };

}
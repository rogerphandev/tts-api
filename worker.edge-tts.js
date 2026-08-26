const TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const EDGE_TTS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";

const CHROMIUM_FULL_VERSION =
  "143.0.3650.75";

const OUTPUT_FORMAT = {
  MP3_48: "audio-24khz-48kbitrate-mono-mp3",
  MP3_96: "audio-24khz-96kbitrate-mono-mp3",
  WEBM: "webm-24khz-16bit-mono-opus"
};

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
  const ticks =
    Math.floor(Date.now() / 1000) + 11644473600;

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
    .map(x =>
      x.toString(16).padStart(2, "0")
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
  return (
    `X-RequestId:${id}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${edgeTimestamp()}\r\n` +
    `Path:ssml\r\n\r\n` +
    createSSML(
      text,
      voice,
      pitch,
      rate,
      volume
    )
  );
}


/* =========================================================
   BINARY AUDIO
========================================================= */

async function extractAudio(data) {
  let bytes;

  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);

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

  const headerLength =
    (bytes[0] << 8) | bytes[1];

  const audioStart =
    2 + headerLength;

  if (audioStart > bytes.length) {
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

  if (!headers.includes("Path:audio")) {
    return null;
  }

  return bytes.slice(audioStart);
}


/* =========================================================
   EDGE TTS
========================================================= */

export async function edgeTTS(payload = {}) {

  const {
    text,
    voice = "en-US-AriaNeural",
    pitch = "+0Hz",
    rate = "0%",
    volume = "100%",
    format = "mp3"
  } = payload;


  if (!text || !String(text).trim()) {
    return jsonResponse(
      {
        message: "Text is required"
      },
      400
    );
  }


  let outputFormat;
  let contentType;
  let filename;


  switch (String(format).toLowerCase()) {

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

    default:
      outputFormat =
        OUTPUT_FORMAT.MP3_48;
      contentType =
        "audio/mpeg";
      filename =
        "edge-tts.mp3";
  }


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


  console.log(
    "EDGE TTS URL:",
    url
  );


  let ws;

  try {

    ws = new WebSocket(url);

  } catch (error) {

    return jsonResponse(
      {
        message:
          "Failed to create Edge TTS WebSocket",

        error:
          error?.message || String(error),

        url
      },
      500
    );

  }


  const audioChunks = [];

  let finished = false;


  return await new Promise(
    (resolve) => {

      const timeout =
        setTimeout(() => {

          if (finished) {
            return;
          }

          finished = true;

          try {
            ws.close();
          } catch {}

          resolve(
            jsonResponse(
              {
                message:
                  "Edge TTS WebSocket timeout",

                readyState:
                  ws.readyState
              },
              500
            )
          );

        }, 30000);


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
                String(text),
                voice,
                pitch,
                rate,
                volume,
                connectionId
              )
            );

          } catch (error) {

            finish(
              error
            );

          }

        }
      );


      ws.addEventListener(
        "message",
        async event => {

          try {

            const audio =
              await extractAudio(
                event.data
              );


            if (audio) {

              audioChunks.push(
                audio
              );

              return;
            }


            if (
              typeof event.data ===
              "string"
            ) {

              const message =
                event.data;

              console.log(
                "EDGE MESSAGE:",
                message
              );


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
        event => {

          console.error(
            "EDGE WEBSOCKET ERROR:",
            event
          );

          finish(
            new Error(
              "Edge TTS WebSocket error"
            )
          );

        }
      );


      ws.addEventListener(
        "close",
        event => {

          console.error(
            "EDGE WEBSOCKET CLOSE:",
            {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean
            }
          );


          if (finished) {
            return;
          }


          if (audioChunks.length) {
            finish();
          } else {

            finish(
              new Error(
                `Edge TTS WebSocket closed: ${event.code} ${event.reason || ""}`
              )
            );

          }

        }
      );


      function finish(error = null) {

        if (finished) {
          return;
        }

        finished = true;

        clearTimeout(timeout);


        try {
          ws.close();
        } catch {}


        if (error) {

          resolve(
            jsonResponse(
              {
                message:
                  error?.message ||
                  "Edge TTS error"
              },
              500
            )
          );

          return;
        }


        if (!audioChunks.length) {

          resolve(
            jsonResponse(
              {
                message:
                  "Edge TTS returned no audio"
              },
              500
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

    }
  );
}


/* =========================================================
   JSON RESPONSE
========================================================= */

function jsonResponse(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        ...CORS_HEADERS
      }
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
        method: "GET",

        headers: {
          "Accept": "*/*",

          "User-Agent":
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ` +
            `AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} ` +
            `Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`
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

function localeToLabel(locale) {

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


/* =========================================================
   GROUPS
========================================================= */

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


  return jsonResponse(
    {
      totalLocales:
        options.length,

      options
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
          `${voice.Gender} - ${voice.DisplayName}`
      })
    );


  return jsonResponse(
    {
      group,

      total:
        options.length,

      options
    }
  );

}
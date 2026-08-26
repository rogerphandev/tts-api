/**
 * Edge-compatible TTS for Cloudflare Workers
 *
 * NO WebSocket
 * NO Node.js
 * NO fs
 * NO FFmpeg
 *
 * Synthesis:
 *   Azure Speech REST API
 *
 * Endpoints handled by index.js:
 *
 * ?engine=edge&action=groups
 * ?engine=edge&action=voices-by-group&group=en-US
 * ?engine=edge&text=Hello&voice=en-US-AriaNeural
 *
 * Required Cloudflare secrets:
 *
 * SPEECH_KEY
 * SPEECH_REGION
 *
 * Example:
 *
 * wrangler secret put SPEECH_KEY
 * wrangler secret put SPEECH_REGION
 */


/* =========================================================
   AZURE SPEECH
========================================================= */

const DEFAULT_REGION = "eastus";

const VOICES_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";


/*
 * This is only used for compatibility with the old
 * Edge voices list endpoint.
 */
const EDGE_TRUSTED_CLIENT_TOKEN =
  "6A5AA1D4EAFF4E9FB37E23D68491D6F4";


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
   OUTPUT FORMAT
========================================================= */

const OUTPUT_FORMATS = {

  mp3:
    "audio-24khz-48kbitrate-mono-mp3",

  "mp3-96":
    "audio-24khz-96kbitrate-mono-mp3",

  webm:
    "webm-24khz-16bit-mono-opus"

};


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
    String(rate).trim();


  /*
   * Already Azure SSML format
   *
   * +10%
   * -10%
   * 0%
   */

  if (
    /^[+-]?\d+%$/.test(value)
  ) {

    return value;

  }


  /*
   * Numeric:
   *
   * 1
   * 1.1
   * 0.9
   */

  const number =
    Number(value);


  if (
    Number.isFinite(number)
  ) {

    const percent =
      Math.round(
        (number - 1) * 100
      );

    return `${
      percent >= 0 ? "+" : ""
    }${percent}%`;

  }


  return "0%";

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
    String(pitch).trim();


  /*
   * Already:
   *
   * +2Hz
   * -2Hz
   * 0Hz
   */

  if (
    /^[+-]?\d+(?:\.\d+)?Hz$/i.test(value)
  ) {

    return value;

  }


  /*
   * Numeric:
   *
   * 2
   * -2
   */

  const number =
    Number(value);


  if (
    Number.isFinite(number)
  ) {

    return `${
      number >= 0 ? "+" : ""
    }${number}Hz`;

  }


  return "0Hz";

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

    return "100%";

  }


  const value =
    String(volume).trim();


  if (
    /^[+-]?\d+%$/.test(value)
  ) {

    return value;

  }


  const number =
    Number(value);


  if (
    Number.isFinite(number)
  ) {

    return `${number}%`;

  }


  return "100%";

}


/* =========================================================
   LANGUAGE FROM VOICE
========================================================= */

function languageFromVoice(voice) {

  if (!voice) {

    return "en-US";

  }


  /*
   * en-US-AriaNeural
   * ja-JP-NanamiNeural
   * vi-VN-HoaiMyNeural
   */

  const parts =
    String(voice).split("-");


  if (
    parts.length >= 2
  ) {

    return `${parts[0]}-${parts[1]}`;

  }


  return "en-US";

}


/* =========================================================
   CREATE SSML
========================================================= */

function createSSML({
  text,
  voice,
  rate,
  pitch,
  volume
}) {

  const language =
    languageFromVoice(voice);


  return `
<speak
  version="1.0"
  xmlns="http://www.w3.org/2001/10/synthesis"
  xml:lang="${escapeXml(language)}">

  <voice name="${escapeXml(voice)}">

    <prosody
      rate="${escapeXml(rate)}"
      pitch="${escapeXml(pitch)}"
      volume="${escapeXml(volume)}">

      ${escapeXml(text)}

    </prosody>

  </voice>

</speak>
`.trim();

}


/* =========================================================
   AZURE TTS URL
========================================================= */

function createAzureTTSUrl(region) {

  const normalized =
    String(
      region ||
      DEFAULT_REGION
    ).trim();


  /*
   * Standard Azure Speech REST endpoint
   */

  return (
    `https://${normalized}.tts.speech.microsoft.com` +
    `/cognitiveservices/v1`
  );

}


/* =========================================================
   SYNTHESIZE USING AZURE SPEECH REST
========================================================= */

export async function edgeTTS(
  payload = {},
  env = {}
) {

  const text =
    payload.text;


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

        headers: {
          ...CORS_HEADERS,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =======================================================
     VALIDATE AZURE CONFIG
  ======================================================= */

  const speechKey =
    env.SPEECH_KEY;


  const speechRegion =
    env.SPEECH_REGION ||
    DEFAULT_REGION;


  if (!speechKey) {

    return Response.json(
      {
        message:
          "SPEECH_KEY is not configured",

        hint:
          "Set SPEECH_KEY as a Cloudflare Worker secret"
      },
      {
        status: 500,

        headers: {
          ...CORS_HEADERS,

          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    );

  }


  /* =======================================================
     FORMAT
  ======================================================= */

  let outputFormat =
    OUTPUT_FORMATS.mp3;


  let contentType =
    "audio/mpeg";


  let filename =
    "edge-tts.mp3";


  if (
    format === "mp3-96"
  ) {

    outputFormat =
      OUTPUT_FORMATS["mp3-96"];

    contentType =
      "audio/mpeg";

    filename =
      "edge-tts.mp3";

  }


  else if (
    format === "webm"
  ) {

    outputFormat =
      OUTPUT_FORMATS.webm;

    contentType =
      "audio/webm; codecs=opus";

    filename =
      "edge-tts.webm";

  }


  /* =======================================================
     SSML
  ======================================================= */

  const ssml =
    createSSML({
      text:
        String(text),

      voice,

      rate,

      pitch,

      volume
    });


  /* =======================================================
     AZURE REQUEST
  ======================================================= */

  const url =
    createAzureTTSUrl(
      speechRegion
    );


  let response;


  try {

    response =
      await fetch(
        url,
        {
          method:
            "POST",

          headers: {

            "Ocp-Apim-Subscription-Key":
              speechKey,

            "Content-Type":
              "application/ssml+xml",

            "X-Microsoft-OutputFormat":
              outputFormat,

            "User-Agent":
              "Cloudflare-Worker-TTS"
          },

          body:
            ssml
        }
      );

  } catch (error) {

    throw new Error(
      `Azure Speech request failed: ${
        error?.message ||
        "network error"
      }`
    );

  }


  /* =======================================================
     AZURE ERROR
  ======================================================= */

  if (!response.ok) {

    let errorText = "";

    try {

      errorText =
        await response.text();

    } catch {}


    throw new Error(
      `Azure Speech HTTP ${
        response.status
      }${
        errorText
          ? `: ${errorText.slice(0, 500)}`
          : ""
      }`
    );

  }


  /* =======================================================
     AUDIO
  ======================================================= */

  const audio =
    await response.arrayBuffer();


  if (
    !audio ||
    audio.byteLength === 0
  ) {

    throw new Error(
      "Azure Speech returned empty audio"
    );

  }


  /* =======================================================
     RETURN MP3
  ======================================================= */

  return new Response(
    audio,
    {
      status: 200,

      headers: {

        "Content-Type":
          contentType,

        "Content-Disposition":
          `inline; filename="${filename}"`,

        "Content-Length":
          String(
            audio.byteLength
          ),

        ...CORS_HEADERS

      }
    }
  );

}


/* =========================================================
   GET EDGE VOICES
========================================================= */

export async function getEdgeVoices() {

  const url =
    `${VOICES_URL}` +
    `?trustedclienttoken=` +
    encodeURIComponent(
      EDGE_TRUSTED_CLIENT_TOKEN
    );


  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {

          "Accept":
            "application/json",

          "User-Agent":
            "Mozilla/5.0"
        }
      }
    );


  if (!response.ok) {

    const errorText =
      await response.text()
        .catch(() => "");


    throw new Error(
      `Edge voices request failed: ${
        response.status
      }${
        errorText
          ? `: ${errorText.slice(0, 300)}`
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
    !String(locale).includes("-")
  ) {

    return locale;

  }


  try {

    const parts =
      String(locale).split("-");


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
    payload.group ||
    "en-US";


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
          `${voice.Gender || ""} - ${
            voice.DisplayName ||
            voice.LocalName ||
            voice.Name ||
            ""
          }`.trim(),

        gender:
          voice.Gender ||
          null,

        locale:
          voice.Locale ||
          group,

        shortName:
          voice.ShortName ||
          voice.Name ||
          null

      })
    );


  return {

    group,

    total:
      options.length,

    options

  };

}
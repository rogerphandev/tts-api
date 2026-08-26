import googleTTS
  from "../worker.google-tts.js";

import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
} from "../worker.edge-tts.js";

import {
  generateTikTokTTS
} from "../worker.tiktok-tts.js";


/* =========================================================
   ALLOWED ORIGINS
========================================================= */

const ALLOWED_ORIGINS =
  new Set([
    "http://localhost:3000",
    "http://localhost:5173",

    "https://ai-video-generator-web.netlify.app",

    "https://www.unminifydev.com",

    "https://www.freettspro.com"
  ]);


/* =========================================================
   CORS
========================================================= */

function corsHeaders(
  request
) {

  const origin =
    request.headers.get(
      "Origin"
    );


  /*
   * Server-to-server / curl
   */

  if (!origin) {

    return {

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "*",

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",

      "Access-Control-Max-Age":
        "86400"

    };

  }


  /*
   * Allowed browser origin
   */

  if (
    ALLOWED_ORIGINS.has(
      origin
    )
  ) {

    return {

      "Access-Control-Allow-Origin":
        origin,

      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",

      "Access-Control-Allow-Credentials":
        "true",

      "Access-Control-Max-Age":
        "86400",

      "Vary":
        "Origin"

    };

  }


  return {};

}


/* =========================================================
   ADD CORS
========================================================= */

function addCors(
  response,
  request
) {

  const headers =
    corsHeaders(
      request
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      headers
    )
  ) {

    response.headers.set(
      key,
      value
    );

  }


  return response;

}


/* =========================================================
   JSON RESPONSE
========================================================= */

function json(
  data,
  status,
  request
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...corsHeaders(
          request
        )

      }
    }
  );

}


/* =========================================================
   ERROR
========================================================= */

function jsonError(
  message,
  status,
  request,
  extra = {}
) {

  return json(
    {
      message,
      ...extra
    },
    status,
    request
  );

}


/* =========================================================
   PARSE REQUEST
========================================================= */

async function getPayload(
  request
) {

  const url =
    new URL(
      request.url
    );


  const query =
    Object.fromEntries(
      url.searchParams.entries()
    );


  let body = {};


  const contentType =
    request.headers.get(
      "content-type"
    ) || "";


  /*
   * JSON
   */

  if (
    contentType.includes(
      "application/json"
    )
  ) {

    try {

      body =
        await request.json();

    }

    catch {

      body = {};

    }

  }


  /*
   * Form
   */

  else if (
    contentType.includes(
      "application/x-www-form-urlencoded"
    ) ||
    contentType.includes(
      "multipart/form-data"
    )
  ) {

    try {

      const formData =
        await request.formData();


      body =
        Object.fromEntries(
          formData.entries()
        );

    }

    catch {

      body = {};

    }

  }


  /*
   * Query overrides body
   */

  return {

    ...body,

    ...query

  };

}


/* =========================================================
   WORKER
========================================================= */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    /* =====================================================
       OPTIONS
    ===================================================== */

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders(
              request
            )
        }
      );

    }


    /* =====================================================
       GET / POST ONLY
    ===================================================== */

    if (
      request.method !== "GET" &&
      request.method !== "POST"
    ) {

      return jsonError(
        "Method not allowed",
        405,
        request
      );

    }


    try {

      /* ===================================================
         PAYLOAD
      =================================================== */

      const payload =
        await getPayload(
          request
        );


      /* ===================================================
         ENGINE
      =================================================== */

      const engine =
        String(
          payload.engine ||
          "google"
        ).toLowerCase();


      const action =
        String(
          payload.action ||
          "tts"
        ).toLowerCase();


      /*
       * Do not pass routing params
       * to TTS engines.
       */

      delete payload.engine;

      delete payload.action;


      /* ===================================================
         EDGE
      =================================================== */

      if (
        engine === "edge"
      ) {

        /* ================================================
           GROUPS
        ================================================= */

        if (
          action === "groups"
        ) {

          const result =
            await edgeTTSGroups(
              payload
            );


          return json(
            result,
            200,
            request
          );

        }


        /* ================================================
           VOICES BY GROUP
        ================================================= */

        if (
          action ===
          "voices-by-group"
        ) {

          const result =
            await edgeTTSVoicesByGroup(
              payload
            );


          return json(
            result,
            200,
            request
          );

        }


        /* ================================================
           TTS
        ================================================= */

        const response =
          await edgeTTS(
            payload
          );


        return addCors(
          response,
          request
        );

      }


      /* ===================================================
         TIKTOK
      =================================================== */

      if (
        engine === "tiktok"
      ) {

        try {

          const audio =
            await generateTikTokTTS(
              payload
            );


          const response =
            new Response(
              audio,
              {
                status: 200,

                headers: {

                  "Content-Type":
                    "audio/mpeg",

                  "Content-Disposition":
                    "inline; filename=tiktok-tts.mp3",

                  "Cache-Control":
                    "no-store"

                }
              }
            );


          return addCors(
            response,
            request
          );

        }

        catch (error) {

          return jsonError(
            error?.message ||
              "TikTok TTS error",
            500,
            request
          );

        }

      }


      /* ===================================================
         GOOGLE
      =================================================== */

      if (
        engine === "google"
      ) {

        try {

          const result =
            await googleTTS(
              payload
            );


          /*
           * Response
           */

          if (
            result instanceof
            Response
          ) {

            return addCors(
              result,
              request
            );

          }


          /*
           * Uint8Array
           */

          if (
            result instanceof
            Uint8Array
          ) {

            return addCors(
              new Response(
                result,
                {
                  status: 200,

                  headers: {

                    "Content-Type":
                      "audio/mpeg",

                    "Cache-Control":
                      "no-store"

                  }
                }
              ),
              request
            );

          }


          /*
           * ArrayBuffer
           */

          if (
            result instanceof
            ArrayBuffer
          ) {

            return addCors(
              new Response(
                result,
                {
                  status: 200,

                  headers: {

                    "Content-Type":
                      "audio/mpeg",

                    "Cache-Control":
                      "no-store"

                  }
                }
              ),
              request
            );

          }


          /*
           * Object
           */

          return json(
            result || {},
            200,
            request
          );

        }

        catch (error) {

          return jsonError(
            error?.message ||
              "Google TTS error",
            500,
            request
          );

        }

      }


      /* ===================================================
         UNKNOWN ENGINE
      =================================================== */

      return jsonError(
        `Unknown TTS engine: ${engine}`,
        400,
        request,
        {
          availableEngines: [
            "edge",
            "google",
            "tiktok"
          ]
        }
      );

    }

    catch (error) {

      console.error(
        "TTS Worker Error:",
        error
      );


      return jsonError(
        error?.message ||
          "TTS Worker error",
        500,
        request
      );

    }

  }

};
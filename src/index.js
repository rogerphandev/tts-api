import googleTTS
  from "../worker.google-tts.js";


import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
}
from "../worker.edge-tts.js";


import {
  generateTikTokTTS
}
from "../worker.tiktok-tts.js";


/* =========================================================
   CORS
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
   CORS HEADERS
========================================================= */

function corsHeaders(
  request
) {

  const origin =
    request.headers.get(
      "Origin"
    );


  /*
   * No Origin
   */

  if (
    !origin
  ) {

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
   * Allowed origin
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
        "86400"

    };

  }


  /*
   * Unknown origin
   */

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
   PARSE REQUEST
========================================================= */

async function getPayload(
  request
) {

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
   * FormData
   */

  let form = {};


  if (

    contentType.includes(
      "multipart/form-data"
    ) ||

    contentType.includes(
      "application/x-www-form-urlencoded"
    )

  ) {

    try {

      const formData =
        await request.formData();


      form =
        Object.fromEntries(
          formData.entries()
        );

    }

    catch {

      form = {};

    }

  }


  /*
   * Query
   */

  const url =
    new URL(
      request.url
    );


  const query =
    Object.fromEntries(
      url.searchParams.entries()
    );


  /*
   * Priority:
   *
   * body
   * form
   * query
   */

  return {

    ...body,

    ...form,

    ...query

  };

}


/* =========================================================
   WRAPPER CHECK
========================================================= */

function isWrapperResponse(
  result
) {

  return (

    result &&

    typeof result ===
      "object" &&

    typeof result.statusCode ===
      "number" &&

    "headers" in result &&

    "body" in result

  );

}


/* =========================================================
   JSON RESPONSE
========================================================= */

function returnJSON(
  data,
  status,
  request
) {

  return new Response(

    JSON.stringify(
      data
    ),

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
   RETURN WRAPPER
========================================================= */

function returnWrapper(
  result,
  request
) {

  /*
   * Preserve existing wrapper.
   */

  return returnJSON(

    result,

    200,

    request

  );

}


/* =========================================================
   RETURN AUDIO
========================================================= */

function returnAudio(
  result,
  request
) {

  const body =
    result.body;


  if (
    body === undefined ||
    body === null
  ) {

    return returnJSON(

      {

        statusCode:
          500,

        message:
          "Empty audio response"

      },

      500,

      request

    );

  }


  const headers =
    new Headers(
      result.headers || {}
    );


  const cors =
    corsHeaders(
      request
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      cors
    )
  ) {

    headers.set(
      key,
      value
    );

  }


  return new Response(

    body,

    {

      status:
        result.statusCode ||
        200,

      headers

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

  return returnJSON(

    {

      statusCode:
        status,

      headers: {

        "content-type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"

      },

      body:
        JSON.stringify({

          message,

          ...extra

        })

    },

    status,

    request

  );

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

          status:
            204,

          headers:
            corsHeaders(
              request
            )

        }

      );

    }


    /* =====================================================
       MAIN
    ===================================================== */

    try {

      /*
       * Parse request
       */

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
       * Routing params
       */

      delete payload.engine;

      delete payload.action;


      /* ===================================================
         EDGE
      =================================================== */

      if (
        engine === "edge"
      ) {


        /* =================================================
           GROUPS
        ================================================= */

        if (
          action ===
          "groups"
        ) {

          const result =
            await edgeTTSGroups(
              payload
            );


          return returnWrapper(
            {

              statusCode:
                200,

              headers: {

                "content-type":
                  "application/json; charset=utf-8",

                "Cache-Control":
                  "no-store"

              },

              body:
                JSON.stringify(
                  result
                )

            },

            request

          );

        }


        /* =================================================
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


          return returnWrapper(
            {

              statusCode:
                200,

              headers: {

                "content-type":
                  "application/json; charset=utf-8",

                "Cache-Control":
                  "no-store"

              },

              body:
                JSON.stringify(
                  result
                )

            },

            request

          );

        }


        /* =================================================
           EDGE SYNTHESIS
        ================================================= */

        const result =
          await edgeTTS(
            payload
          );


        /*
         * edgeTTS returns Response
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
         * Wrapper
         */

        if (
          isWrapperResponse(
            result
          )
        ) {

          /*
           * Binary
           */

          if (

            result.body instanceof
              Uint8Array ||

            result.body instanceof
              ArrayBuffer ||

            (
              typeof Blob !==
              "undefined" &&

              result.body instanceof
                Blob
            )

          ) {

            return returnAudio(
              result,
              request
            );

          }


          return returnWrapper(
            result,
            request
          );

        }


        /*
         * Fallback
         */

        return returnJSON(
          result || {},
          200,
          request
        );

      }


      /* ===================================================
         TIKTOK
      =================================================== */

      if (
        engine ===
        "tiktok"
      ) {

        try {

          const audioBuffer =
            await generateTikTokTTS(
              payload
            );


          const response =
            new Response(

              audioBuffer,

              {

                status:
                  200,

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
        engine ===
        "google"
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
           * Wrapper
           */

          if (
            isWrapperResponse(
              result
            )
          ) {

            if (

              result.body instanceof
                Uint8Array ||

              result.body instanceof
                ArrayBuffer ||

              (
                typeof Blob !==
                "undefined" &&

                result.body instanceof
                  Blob
              )

            ) {

              return returnAudio(
                result,
                request
              );

            }


            return returnWrapper(
              result,
              request
            );

          }


          /*
           * Raw binary
           */

          if (

            result instanceof
              Uint8Array ||

            result instanceof
              ArrayBuffer ||

            (
              typeof Blob !==
              "undefined" &&

              result instanceof
                Blob
            )

          ) {

            const response =
              new Response(

                result,

                {

                  status:
                    200,

                  headers: {

                    "Content-Type":
                      "audio/mpeg",

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


          /*
           * JSON
           */

          return returnJSON(
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
          "TTS error",

        500,

        request

      );

    }

  }

};
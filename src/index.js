import googleTTS
  from "../worker.google-tts.js";

import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup,
  edgeTTSAllVoices
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
   * No Origin
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
   * Allowed Origin
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
    const [key, value]
    of Object.entries(headers)
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
   * Form
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
   WRAPPER DETECTION
========================================================= */

function isWrapperResponse(
  result
) {

  return (
    result &&
    typeof result === "object" &&
    typeof result.statusCode ===
      "number" &&
    "headers" in result &&
    "body" in result
  );

}


/* =========================================================
   JSON WRAPPER
========================================================= */

function returnWrapper(
  result,
  request
) {

  const body =
    result &&
    typeof result.body ===
      "string"
      ? result.body
      : JSON.stringify(
          result?.body ??
          {}
        );


  const output = {

    statusCode:
      result?.statusCode ??
      200,

    headers:
      result?.headers ??
      {},

    body

  };


  return new Response(
    JSON.stringify(
      output
    ),
    {
      status: 200,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        ...corsHeaders(
          request
        )

      }

    }
  );

}


/* =========================================================
   RETURN AUDIO
========================================================= */

function returnAudio(
  result,
  request
) {

  const headers =
    new Headers(
      result.headers || {}
    );


  const cors =
    corsHeaders(
      request
    );


  for (
    const [key, value]
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
    result.body,
    {
      status:
        result.statusCode ||
        200,

      headers
    }
  );

}


/* =========================================================
   JSON ERROR
========================================================= */

function jsonError(
  message,
  status,
  request,
  extra = {}
) {

  const payload = {

    statusCode:
      status,

    headers: {

      "content-type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "*",

      "Access-Control-Allow-Methods":
        "*"

    },

    body:
      JSON.stringify({

        message,

        ...extra

      })

  };


  return new Response(
    JSON.stringify(
      payload
    ),
    {
      status,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8",

        ...corsHeaders(
          request
        )

      }

    }
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

    /*
     * OPTIONS
     */

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


    try {

      /*
       * Parse
       */

      const payload =
        await getPayload(
          request
        );


      /*
       * Engine
       */

      const engine =
        String(
          payload.engine ||
          "google"
        ).toLowerCase();


      /*
       * Action
       */

      const action =
        String(
          payload.action ||
          "tts"
        ).toLowerCase();


      /*
       * Remove routing fields
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


        /* ================================================
           ALL VOICES
        ================================================= */

        if (
          action ===
          "voices"
        ) {

          const result =
            await edgeTTSAllVoices();


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


        /* ================================================
           EDGE SYNTHESIS
        ================================================= */

        const result =
          await edgeTTS(
            payload
          );


        /*
         * Direct Response
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

        return returnWrapper(
          {
            statusCode:
              200,

            headers: {

              "content-type":
                "application/json; charset=utf-8"

            },

            body:
              JSON.stringify(
                result || {}
              )

          },
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
           * Direct Response
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

          return returnWrapper(
            {
              statusCode:
                200,

              headers: {

                "content-type":
                  "application/json; charset=utf-8"

              },

              body:
                JSON.stringify(
                  result || {}
                )

            },
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
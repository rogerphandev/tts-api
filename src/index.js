import googleTTS from "../worker.google-tts.js";

import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
} from "../worker.edge-tts.js";

import { generateTikTokTTS } from "../tiktok-tts.js";


/* =========================================================
   CORS
========================================================= */

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://ai-video-generator-web.netlify.app",
  "https://www.unminifydev.com",
  "https://www.freettspro.com"
]);


function corsHeaders(request) {

  const origin =
    request.headers.get("Origin");


  /*
   * Request không có Origin
   */

  if (!origin) {

    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400"
    };

  }


  /*
   * Origin được phép
   */

  if (ALLOWED_ORIGINS.has(origin)) {

    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400"
    };

  }


  /*
   * Origin không được phép
   */

  return {};

}


/* =========================================================
   ADD CORS
========================================================= */

function addCors(response, request) {

  const headers =
    corsHeaders(request);


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

async function getPayload(request) {

  let body = {};


  /*
   * JSON body
   */

  try {

    const contentType =
      request.headers.get(
        "content-type"
      ) || "";


    if (
      contentType.includes(
        "application/json"
      )
    ) {

      body =
        await request.json();

    }

  } catch {

    body = {};

  }


  /*
   * FormData
   */

  let form = {};


  try {

    const contentType =
      request.headers.get(
        "content-type"
      ) || "";


    if (
      contentType.includes(
        "multipart/form-data"
      ) ||
      contentType.includes(
        "application/x-www-form-urlencoded"
      )
    ) {

      const formData =
        await request.formData();


      form =
        Object.fromEntries(
          formData.entries()
        );

    }

  } catch {

    form = {};

  }


  /*
   * Query string
   */

  const url =
    new URL(request.url);


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
   *
   * Query override body
   */

  return {
    ...body,
    ...form,
    ...query
  };

}


/* =========================================================
   NORMALIZE WRAPPER RESPONSE
========================================================= */

function isWrapperResponse(result) {

  return (
    result &&
    typeof result === "object" &&
    typeof result.statusCode === "number" &&
    "headers" in result &&
    "body" in result
  );

}


/* =========================================================
   RETURN JSON WRAPPER
========================================================= */

function returnWrapper(
  result,
  request
) {

  /*
   * Đây là format mà frontend
   * của bạn đang cần:
   *
   * {
   *   statusCode: 200,
   *   headers: {...},
   *   body: "..."
   * }
   */

  const response =
    new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json; charset=utf-8",
          ...corsHeaders(request)
        }
      }
    );


  return response;

}


/* =========================================================
   RETURN AUDIO
========================================================= */

function returnAudio(
  result,
  request
) {

  /*
   * result.body có thể là:
   *
   * Uint8Array
   * ArrayBuffer
   * Blob
   */

  let body =
    result.body;


  /*
   * Không có body
   */

  if (
    body === undefined ||
    body === null
  ) {

    return returnWrapper(
      {
        statusCode:
          result.statusCode || 500,

        headers:
          result.headers || {},

        body:
          JSON.stringify({
            message:
              "Empty audio response"
          })
      },
      request
    );

  }


  /*
   * Headers từ worker.edge-tts.js
   */

  const headers =
    new Headers(
      result.headers || {}
    );


  /*
   * CORS
   */

  const cors =
    corsHeaders(request);


  Object.entries(cors).forEach(
    ([key, value]) => {

      headers.set(
        key,
        value
      );

    }
  );


  /*
   * Return binary
   */

  return new Response(
    body,
    {
      status:
        result.statusCode || 200,

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

  return new Response(
    JSON.stringify({
      statusCode: status,
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
    }),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...corsHeaders(request)
      }
    }
  );

}


/* =========================================================
   CLOUDFLARE WORKER
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
            corsHeaders(request)
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
       * Remove routing params
       */

      delete payload.engine;
      delete payload.action;


      /* ===================================================
         EDGE TTS
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


          /*
           * worker.edge-tts.js
           * trả:
           *
           * {
           *   statusCode,
           *   headers,
           *   body
           * }
           */

          if (
            isWrapperResponse(
              result
            )
          ) {

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
              statusCode: 200,

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
                JSON.stringify(
                  result || {}
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


          if (
            isWrapperResponse(
              result
            )
          ) {

            return returnWrapper(
              result,
              request
            );

          }


          return returnWrapper(
            {
              statusCode: 200,

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
                JSON.stringify(
                  result || {}
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
         * Error / JSON wrapper
         */

        if (
          isWrapperResponse(
            result
          )
        ) {

          /*
           * Nếu body là Uint8Array
           * thì đây là audio
           */

          if (
            result.body instanceof
              Uint8Array ||
            result.body instanceof
              ArrayBuffer ||
            (
              typeof Blob !==
              "undefined" &&
              result.body instanceof Blob
            )
          ) {

            return returnAudio(
              result,
              request
            );

          }


          /*
           * body string = JSON/error
           */

          return returnWrapper(
            result,
            request
          );

        }


        /*
         * Fallback nếu edgeTTS
         * trả trực tiếp Response
         */

        if (
          result instanceof Response
        ) {

          return addCors(
            result,
            request
          );

        }


        /*
         * Fallback object
         */

        return returnWrapper(
          {
            statusCode: 200,

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
              JSON.stringify(
                result || {}
              )
          },
          request
        );

      }


      /* ===================================================
         TIKTOK TTS
      =================================================== */

      if (
        engine === "tiktok"
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
         GOOGLE TTS
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
           * googleTTS trả Response
           */

          if (
            result instanceof Response
          ) {

            return addCors(
              result,
              request
            );

          }


          /*
           * Nếu googleTTS trả wrapper
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
                result.body instanceof Blob
              )
            ) {

              return returnAudio(
                result,
                request
              );

            }


            /*
             * JSON
             */

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
              result instanceof Blob
            )
          ) {

            const response =
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
              );


            return addCors(
              response,
              request
            );

          }


          /*
           * Fallback JSON
           */

          return returnWrapper(
            {
              statusCode: 200,

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
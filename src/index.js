import googleTTS from "../google-tts.js";

import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
} from "../worker.edge-tts.js";

import { generateTikTokTTS } from "../tiktok-tts.js";


/* ==================================================
   CORS CONFIG
================================================== */

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://ai-video-generator-web.netlify.app",
  "https://www.unminifydev.com",
  "https://www.freettspro.com"
]);


function corsHeaders(req) {
  const origin = req.headers.get("origin");

  /*
   * Request không có Origin:
   * server-to-server / curl
   */
  if (!origin || ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin":
        origin || "*",

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",

      "Access-Control-Max-Age":
        "86400"
    };
  }

  /*
   * Origin không được phép
   */
  return {};
}


/* ==================================================
   ADD CORS
================================================== */

function addCors(response, req) {
  const headers =
    corsHeaders(req);

  Object.entries(headers).forEach(
    ([key, value]) => {
      response.headers.set(
        key,
        value
      );
    }
  );

  return response;
}


/* ==================================================
   PARSE REQUEST PAYLOAD
================================================== */

async function getPayload(req) {
  let body = {};

  /*
   * JSON body
   */
  try {
    body = await req.json();

    if (
      !body ||
      typeof body !== "object"
    ) {
      body = {};
    }
  } catch {
    body = {};
  }


  /*
   * FormData
   */
  let formData = null;

  try {
    formData =
      await req.formData();
  } catch {
    formData = null;
  }


  /*
   * Query parameters
   */
  const url =
    new URL(req.url);

  const query =
    Object.fromEntries(
      url.searchParams.entries()
    );


  /*
   * Form parameters
   */
  const form =
    formData
      ? Object.fromEntries(
          formData.entries()
        )
      : {};


  /*
   * Priority:

     body
       ↓
     form
       ↓
     query

   * Query sẽ override body.
   */
  return {
    ...body,
    ...form,
    ...query
  };
}


/* ==================================================
   CONVERT LEGACY RESPONSE
================================================== */

function legacyResponseToResponse(
  result,
  req
) {
  /*
   * Nếu function đã trả Response
   */
  if (
    result instanceof Response
  ) {
    return addCors(
      result,
      req
    );
  }


  /*
   * Nếu function trả:

     {
       statusCode,
       headers,
       body
     }
   */

  if (
    result &&
    typeof result === "object" &&
    (
      "statusCode" in result ||
      "headers" in result ||
      "body" in result
    )
  ) {
    const status =
      result.statusCode || 200;

    const responseHeaders = {
      ...(result.headers || {}),
      ...corsHeaders(req)
    };

    return new Response(
      result.body ?? "",
      {
        status,
        headers:
          responseHeaders
      }
    );
  }


  /*
   * Object bình thường
   */
  if (
    result &&
    typeof result === "object"
  ) {
    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json; charset=utf-8",
          ...corsHeaders(req)
        }
      }
    );
  }


  /*
   * String / Buffer / Uint8Array
   */
  return new Response(
    result,
    {
      status: 200,
      headers:
        corsHeaders(req)
    }
  );
}


/* ==================================================
   CLOUDFLARE WORKER
================================================== */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    /* ==================================================
       OPTIONS / PREFLIGHT
    ================================================== */

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


    /* ==================================================
       MAIN
    ================================================== */

    try {

      /*
       * Parse request
       */
      const payload =
        await getPayload(
          request
        );


      /* ==================================================
         ENGINE / ACTION
      ================================================== */

      const engine =
        payload.engine ||
        "google";

      const action =
        payload.action ||
        "tts";


      /*
       * Không truyền engine/action
       * xuống TTS engine.
       */
      delete payload.engine;
      delete payload.action;


      /* ==================================================
         EDGE TTS
      ================================================== */

      if (
        engine === "edge"
      ) {

        /* ----------------------------------------------
           GROUPS
        ---------------------------------------------- */

        if (
          action === "groups"
        ) {

          const result =
            await edgeTTSGroups(
              payload
            );


          /*
           * QUAN TRỌNG:

           * edgeTTSGroups() trả:

             {
               statusCode: 200,
               headers: {...},
               body: "..."
             }

           * API bên ngoài sẽ trả:

             {
               statusCode: 200,
               headers: {...},
               body: "..."
             }

           * Vì vậy KHÔNG dùng:
             Response.json(result)

           * mà dùng:
             JSON.stringify(result)
           */

          return new Response(
            JSON.stringify(result),
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


        /* ----------------------------------------------
           VOICES BY GROUP
        ---------------------------------------------- */

        if (
          action ===
          "voices-by-group"
        ) {

          const result =
            await edgeTTSVoicesByGroup(
              payload
            );


          /*
           * Trả wrapper JSON giống
           * groups.
           */

          return new Response(
            JSON.stringify(result),
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


        /* ----------------------------------------------
           EDGE SYNTHESIS
        ---------------------------------------------- */

        const result =
          await edgeTTS(
            payload
          );


        /*
         * edgeTTS() trả Response audio
         */

        return addCors(
          result,
          request
        );
      }


      /* ==================================================
         TIKTOK TTS
      ================================================== */

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

        } catch (err) {

          const response =
            new Response(
              JSON.stringify({
                message:
                  err?.message ||
                  "TikTok TTS error"
              }),
              {
                status: 500,

                headers: {
                  "Content-Type":
                    "application/json; charset=utf-8"
                }
              }
            );


          return addCors(
            response,
            request
          );
        }
      }


      /* ==================================================
         GOOGLE TTS
      ================================================== */

      /*
       * Cloudflare Workers KHÔNG có:

         /tmp/
         /var/task/
         FFmpeg binary

       * Vì vậy chỉ gọi:

         googleTTS(payload)

       * google-tts.js phải là Worker-compatible.
       */

      const result =
        await googleTTS(
          payload
        );


      return legacyResponseToResponse(
        result,
        request
      );


    } catch (err) {

      console.error(
        "TTS Worker Error:",
        err
      );


      return new Response(
        JSON.stringify({
          message:
            err?.message ||
            "TTS error"
        }),
        {
          status: 500,

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
  }
};
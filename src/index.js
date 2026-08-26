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


function corsHeaders(request) {
  const origin = request.headers.get("Origin");

  if (!origin || ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };
  }

  return {};
}


/* ==================================================
   ADD CORS
================================================== */

function addCors(response, request) {

  const headers = corsHeaders(request);

  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}


/* ==================================================
   PARSE REQUEST
================================================== */

async function getPayload(request) {

  let body = {};

  const contentType =
    request.headers.get("Content-Type") || "";

  /*
   * JSON
   */
  if (
    contentType.includes("application/json")
  ) {

    try {
      body = await request.json();
    } catch {
      body = {};
    }

  }


  /*
   * FormData
   */
  else if (
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

      body =
        Object.fromEntries(
          formData.entries()
        );

    } catch {

      body = {};

    }

  }


  /*
   * Query parameters
   */
  const url =
    new URL(request.url);

  const query =
    Object.fromEntries(
      url.searchParams.entries()
    );


  return {
    ...body,
    ...query
  };
}


/* ==================================================
   JSON RESPONSE HELPER
================================================== */

function jsonResponse(
  data,
  request,
  status = 200
) {

  return addCors(

    new Response(
      JSON.stringify(data),
      {
        status,
        headers: {
          "Content-Type":
            "application/json; charset=utf-8"
        }
      }
    ),

    request

  );
}


/* ==================================================
   CLOUDFLARE WORKER
================================================== */

export default {

  async fetch(request, env, ctx) {

    /*
     * ================================================
     * OPTIONS / CORS PREFLIGHT
     * ================================================
     */

    if (
      request.method === "OPTIONS"
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


    /*
     * ================================================
     * MAIN
     * ================================================
     */

    try {

      const payload =
        await getPayload(request);


      /*
       * ================================================
       * ENGINE
       * ================================================
       */

      const engine =
        payload.engine || "google";

      const action =
        payload.action || "tts";


      /*
       * Không truyền engine/action
       * xuống TTS
       */

      delete payload.engine;
      delete payload.action;


      /* =================================================
         EDGE TTS
      ================================================= */

      if (engine === "edge") {


        /*
         * -----------------------------------------------
         * GROUPS
         * -----------------------------------------------
         */

        if (
          action === "groups"
        ) {

          const result =
            await edgeTTSGroups(
              payload
            );


          /*
           * edgeTTSGroups()
           * có thể trả Response
           */

          if (
            result instanceof Response
          ) {

            return addCors(
              result,
              request
            );

          }


          return jsonResponse(
            result,
            request
          );

        }


        /*
         * -----------------------------------------------
         * VOICES BY GROUP
         * -----------------------------------------------
         */

        if (
          action ===
          "voices-by-group"
        ) {

          const result =
            await edgeTTSVoicesByGroup(
              payload
            );


          if (
            result instanceof Response
          ) {

            return addCors(
              result,
              request
            );

          }


          return jsonResponse(
            result,
            request
          );

        }


        /*
         * -----------------------------------------------
         * SYNTHESIS
         * -----------------------------------------------
         */

        const result =
          await edgeTTS(
            payload
          );


        /*
         * worker.edge-tts.js
         * trả Response JSON
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
         * fallback
         */

        return jsonResponse(
          result,
          request
        );

      }


      /* =================================================
         TIKTOK TTS
      ================================================= */

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

        catch (err) {

          return jsonResponse(
            {
              success: false,
              message:
                err?.message ||
                "TikTok TTS error"
            },
            request,
            500
          );

        }

      }


      /* =================================================
         GOOGLE TTS
      ================================================= */

      /*
       * Cloudflare Worker KHÔNG có:
       *
       * /tmp/
       * /var/task/
       * FFmpeg binary
       *
       * Vì vậy chỉ gọi:
       *
       * googleTTS(payload)
       */

      const result =
        await googleTTS(
          payload
        );


      if (
        result instanceof Response
      ) {

        return addCors(
          result,
          request
        );

      }


      return jsonResponse(
        result,
        request
      );


    }

    catch (err) {

      console.error(
        "TTS Worker Error:",
        err
      );


      return jsonResponse(

        {
          success: false,

          message:
            err?.message ||
            "TTS error"
        },

        request,

        500

      );

    }

  }

};
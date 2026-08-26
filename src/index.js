import googleTTS from "../google-tts.js";

import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
} from "../edge-tts.js";

import { generateTikTokTTS } from "../tiktok-tts.js";


/* ===============================
   CORS CONFIG
================================ */

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://ai-video-generator-web.netlify.app",
  "https://www.unminifydev.com",
  "https://www.freettspro.com"
]);


function corsHeaders(req) {

  const origin = req.headers.get("origin");


  // Request không có Origin
  // server-to-server / curl

  if (!origin || ALLOWED_ORIGINS.has(origin)) {

    return {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

  }


  // Origin không được phép

  return {};
}


/* ===============================
   ADD CORS TO RESPONSE
================================ */

function addCors(response, req) {

  const headers = corsHeaders(req);

  Object.entries(headers).forEach(([key, value]) => {

    response.headers.set(key, value);

  });

  return response;
}


/* ===============================
   PARSE REQUEST PAYLOAD
================================ */

async function getPayload(req) {

  let body = {};

  try {

    body = await req.json();

  } catch {

    body = {};

  }


  let formData = null;

  try {

    formData = await req.formData();

  } catch {

    formData = null;

  }


  const url = new URL(req.url);

  const query = Object.fromEntries(
    url.searchParams.entries()
  );


  const form = formData
    ? Object.fromEntries(formData.entries())
    : {};


  return {
    ...body,
    ...form,
    ...query
  };
}


/* ===============================
   CLOUDFLARE WORKER
================================ */

export default {

  async fetch(request, env, ctx) {

    /* ===============================
       OPTIONS / PREFLIGHT
    ================================= */

    if (request.method === "OPTIONS") {

      return new Response(null, {

        status: 204,

        headers: corsHeaders(request)

      });

    }


    /* ===============================
       MAIN
    ================================= */

    try {

      const payload =
        await getPayload(request);


      /* ===============================
         ENGINE / ACTION
      ================================= */

      const engine =
        payload.engine || "google";

      const action =
        payload.action || "tts";


      delete payload.engine;
      delete payload.action;


      /* ==================================================
         EDGE TTS
      ================================================== */

      if (engine === "edge") {


        /* ---------- GROUPS ---------- */

        if (action === "groups") {

          const result =
            await edgeTTSGroups(payload);


          // edgeTTSGroups trả về Response
          return addCors(
            result instanceof Response
              ? result
              : Response.json(result),
            request
          );

        }


        /* ---------- VOICES BY GROUP ---------- */

        if (
          action === "voices-by-group"
        ) {

          const result =
            await edgeTTSVoicesByGroup(
              payload
            );


          return addCors(
            result instanceof Response
              ? result
              : Response.json(result),
            request
          );

        }


        /* ---------- SYNTHESIZE ---------- */

        const result =
          await edgeTTS(payload);


        return addCors(
          result instanceof Response
            ? result
            : new Response(result),
          request
        );

      }


      /* ==================================================
         TIKTOK TTS
      ================================================== */

      if (engine === "tiktok") {

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
                    "inline; filename=tiktok-tts.mp3"

                }
              }
            );


          return addCors(
            response,
            request
          );

        } catch (err) {

          const response =
            Response.json(

              {
                message:
                  err?.message ||
                  "TikTok TTS error"
              },

              {
                status: 500
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
       * IMPORTANT:
       *
       * Cloudflare Workers không có:
       *
       * /tmp/
       * /var/task/bin/ffmpeg
       *
       * Vì vậy KHÔNG truyền các path này.
       *
       * google-tts.js cần được sửa riêng nếu nó
       * đang sử dụng FFmpeg hoặc filesystem.
       */


      const result =
        await googleTTS(payload);


      return addCors(
        result instanceof Response
          ? result
          : new Response(result),
        request
      );


    } catch (err) {

      console.error(
        "TTS Worker Error:",
        err
      );


      return new Response(

        err?.message ||
        "TTS error",

        {
          status: 500,

          headers: {
            ...corsHeaders(request),
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        }

      );

    }

  }

};


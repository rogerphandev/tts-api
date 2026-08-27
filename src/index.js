import googleTTS from "../worker.google-tts.js";
import {
  edgeTTS,
  edgeTTSGroups,
  edgeTTSVoicesByGroup
} from "../worker.edge-tts.js";
import { generateTikTokTTS } from "../worker.tiktok-tts.js";

/* =========================================================
   CORS & ORIGINS
========================================================= */
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://ai-video-generator-web.netlify.app",
  "https://www.unminifydev.com",
  "https://www.freettspro.com"
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400"
    };
  }

  if (ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400"
    };
  }

  return {};
}

function addCors(response, request) {
  const headers = corsHeaders(request);
  const newHeaders = new Headers(response.headers);

  for (const [key, value] of Object.entries(headers)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/* =========================================================
   PARSE REQUEST
========================================================= */
async function getPayload(request) {
  let body = {};
  let form = {};
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    try {
      const formData = await request.formData();
      form = Object.fromEntries(formData.entries());
    } catch {
      form = {};
    }
  }

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  return { ...body, ...form, ...query };
}

/* =========================================================
   HELPERS & ERRORS
========================================================= */
function jsonError(message, status, request, extra = {}) {
  return new Response(
    JSON.stringify({ statusCode: status, message, ...extra }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(request)
      }
    }
  );
}

/* =========================================================
   MAIN WORKER
========================================================= */
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    try {
      const payload = await getPayload(request);

      const engine = String(payload.engine || "google").toLowerCase();
      const action = String(payload.action || "tts").toLowerCase();

      delete payload.engine;
      delete payload.action;

      /* ===================================================
          EDGE TTS ENGINE (FIXED)
      =================================================== */
      if (engine === "edge") {
        let result;

        if (action === "groups") {
          result = await edgeTTSGroups(payload);
        } else if (action === "voices-by-group") {
          result = await edgeTTSVoicesByGroup(payload);
        } else {
          result = await edgeTTS(payload);
        }

        // Trường hợp 1: Trả về Native Fetch Response (Tối ưu nhất cho CF Worker)
        if (result instanceof Response) {
          return addCors(result, request);
        }

        // Trường hợp 2: Trả về dạng object chứa { statusCode, headers, body }
        if (result && typeof result === "object" && "body" in result) {
          const headers = new Headers(result.headers || {});
          const cors = corsHeaders(request);
          for (const [k, v] of Object.entries(cors)) {
            headers.set(k, v);
          }

          return new Response(result.body, {
            status: result.statusCode || 200,
            headers
          });
        }

        // Trường hợp 3: Trả về mảng/đối tượng JSON thông thường
        return new Response(JSON.stringify(result || {}), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders(request)
          }
        });
      }

      /* ===================================================
          TIKTOK TTS ENGINE
      =================================================== */
      if (engine === "tiktok") {
        try {
          const audioBuffer = await generateTikTokTTS(payload);

          const response = new Response(audioBuffer, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Disposition": "inline; filename=tiktok-tts.mp3",
              "Cache-Control": "no-store"
            }
          });

          return addCors(response, request);
        } catch (error) {
          return jsonError(
            error?.message || "TikTok TTS error",
            500,
            request
          );
        }
      }

      /* ===================================================
          GOOGLE TTS ENGINE
      =================================================== */
      if (engine === "google") {
        try {
          const result = await googleTTS(payload);

          if (result instanceof Response) {
            return addCors(result, request);
          }

          if (
            result instanceof Uint8Array ||
            result instanceof ArrayBuffer ||
            (typeof Blob !== "undefined" && result instanceof Blob)
          ) {
            const response = new Response(result, {
              status: 200,
              headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-store"
              }
            });
            return addCors(response, request);
          }

          return new Response(JSON.stringify(result || {}), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              ...corsHeaders(request)
            }
          });
        } catch (error) {
          return jsonError(
            error?.message || "Google TTS error",
            500,
            request
          );
        }
      }

      /* ===================================================
          UNKNOWN ENGINE
      =================================================== */
      return jsonError(`Unknown TTS engine: ${engine}`, 400, request, {
        availableEngines: ["edge", "google", "tiktok"]
      });
    } catch (error) {
      console.error("TTS Worker Error:", error);
      return jsonError(error?.message || "TTS error", 500, request);
    }
  }
};
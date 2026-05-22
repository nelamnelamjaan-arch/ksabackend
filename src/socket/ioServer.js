import { Server } from "socket.io";
import { createClient } from "redis";
import { verifyAuthToken } from "../services/auth/jwt.js";
import { MAGIC_IMPORT_PROGRESS_CHANNEL } from "../services/jobs/magicImportProgressBus.js";
import { getCorsAllowedOrigins } from "../config/clientOrigins.js";

/**
 * @param {import("http").Server} httpServer
 */
export function attachSocketIo(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: getCorsAllowedOrigins(),
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
  });

  io.on("connection", (socket) => {
    socket.on("auth", (rawToken) => {
      try {
        const token = String(rawToken || "").replace(/^Bearer\s+/i, "").trim();
        const payload = verifyAuthToken(token);
        const sub = payload?.sub;
        if (sub) {
          socket.join(`user:${sub}`);
          socket.emit("authed", { ok: true });
        } else {
          socket.emit("authed", { ok: false });
        }
      } catch {
        socket.emit("authed", { ok: false });
      }
    });
  });

  void wireRedisMagicImportFanout(io);
  return io;
}

async function wireRedisMagicImportFanout(io) {
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    const sub = createClient({ url });
    sub.on("error", (e) => console.warn("[RedisSub]", e.message));
    await sub.connect();
    await sub.subscribe(MAGIC_IMPORT_PROGRESS_CHANNEL, (message) => {
      try {
        const data = JSON.parse(message);
        if (data?.userId) {
          io.to(`user:${data.userId}`).emit("magic-import-progress", data);
        }
      } catch {
        /* ignore */
      }
    });
    console.log("[Socket.io] Subscribed to Redis magic-import progress channel.");
  } catch (e) {
    console.warn("[Socket.io] Redis subscriber not started:", e?.message || e);
  }
}

// Overdrive 的 ps5-manager 客户端：只依赖 @ps5-react/core 的原生 Http。
//
// 服务端接口（见 ps5-manager/internal/server/overdrive.go）：
//   GET /api/overdrive/ping               探活，秒回，不查库
//   GET /api/overdrive/manifest           在库游戏清单（只含 PS5 / PS4 本体）
//   GET /api/overdrive/releases/{titleId} 本体 → 补丁 → DLC 的直装地址
//
// 这里不做缓存与重试策略，由调用方（NasScreen / install）决定。

import { Http } from "@ps5-react/core";

export const DEFAULT_PORT = 8280;

export function serverURL(server) {
  return `http://${server.host}:${server.port}`;
}

/** 服务端给的是相对封面地址（/api/v1/games/1/icon），拼上 host 才能给 <Image> 用。 */
export function absoluteURL(server, path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return serverURL(server) + (path.startsWith("/") ? path : `/${path}`);
}

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** 给 Http.request 加超时：原生请求本身没有 deadline，卡住时靠 AbortController 收尾。 */
async function withTimeout(ms, run) {
  if (!ms || typeof AbortController !== "function") return run(null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJSON(server, path, { signal, timeoutMs = 8000 } = {}) {
  const url = serverURL(server) + path;
  let response;
  try {
    response = await withTimeout(timeoutMs, (own) => Http.request(url, { signal: own ?? signal }));
  } catch (error) {
    if (error?.name === "AbortError") throw failure("timeout", `${url}: timed out`);
    throw failure("offline", `${url}: ${error?.message || error}`);
  }
  if (!response.ok) throw failure("http", `${url}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw failure("bad-json", `${url}: ${error?.message || error}`);
  }
}

/** 探活并校验身份：同网段别的服务也可能占着 8280，不能只看端口通。 */
export async function ping(server, options = {}) {
  const body = await requestJSON(server, "/api/overdrive/ping", { timeoutMs: 4000, ...options });
  if (body?.service !== "ps5-manager") {
    throw failure("not-manager", `not a ps5-manager: ${server.host}:${server.port}`);
  }
  return body;
}

export function manifest(server, options = {}) {
  return requestJSON(server, "/api/overdrive/manifest", { timeoutMs: 15000, ...options });
}

export function releases(server, titleId, options = {}) {
  return requestJSON(server, `/api/overdrive/releases/${encodeURIComponent(titleId)}`, {
    timeoutMs: 8000,
    ...options,
  });
}

// 局域网自动发现。
//
// 两级：
//   1. UDP 广播（LocalNetwork.broadcast）问一句，ps5-manager 的 beacon 原路回 JSON
//   2. 拿到 address + http_port 后调 /api/overdrive/ping 复核身份
//
// 广播不可用（某些网络屏蔽广播、NAS 用桥接网络没映射 UDP）时，退回上次成功连接的地址；
// 两条路都失败就如实报告"没找到"，由界面提示检查网络。

import { LocalNetwork } from "@ps5-react/core";
import { loadList, saveList } from "../state/saved.js";
import { DEFAULT_PORT, ping } from "./api.js";

export const DISCOVERY_PORT = 48620;
export const PROBE = "OVERDRIVE/1 DISCOVER ps5-manager";

var SETTINGS = "settings.json";

function settings() {
  try {
    return loadList(SETTINGS, "settings");
  } catch {
    return {};
  }
}

/** 上次连上的服务器，开机先试它，省掉一次广播等待。 */
export function cachedServer() {
  const saved = settings().ps5manager;
  if (!saved || typeof saved.host !== "string" || !saved.host) return null;
  const port = Number(saved.port);
  return {
    host: saved.host,
    port: port > 0 && port <= 65535 ? port : DEFAULT_PORT,
    name: typeof saved.name === "string" ? saved.name : saved.host,
  };
}

export function rememberServer(server) {
  if (!server?.host) return;
  const { ps5manager: _old, ...rest } = settings();
  saveList(SETTINGS, "settings", {
    ...rest,
    ps5manager: { host: server.host, port: server.port, name: server.name ?? "" },
  });
}

export function forgetServer() {
  const { ps5manager: _old, ...rest } = settings();
  saveList(SETTINGS, "settings", rest);
}

function parseReply(reply) {
  let info = null;
  try {
    info = JSON.parse(reply.text);
  } catch {
    info = null;
  }
  const port = Number(info?.http_port);
  return {
    host: reply.address,
    port: port > 0 && port <= 65535 ? port : DEFAULT_PORT,
    name: typeof info?.name === "string" && info.name ? info.name : reply.address,
    manifestPath: typeof info?.manifest_path === "string" ? info.manifest_path : "",
  };
}

/**
 * 广播发现所有可用的 ps5-manager。
 * @returns {Promise<Array<{host: string, port: number, name: string, version?: string}>>}
 */
export async function discoverServers({ timeoutMs = 1800, maxReplies = 8, signal } = {}) {
  let replies;
  try {
    replies = await LocalNetwork.broadcast({
      port: DISCOVERY_PORT,
      message: PROBE,
      timeoutMs,
      maxReplies,
      signal,
    });
  } catch (error) {
    const failure = new Error(`broadcast failed: ${error?.message || error}`);
    failure.code = "broadcast";
    throw failure;
  }

  const candidates = [];
  const seen = new Set();
  for (const reply of replies) {
    const candidate = parseReply(reply);
    if (!candidate.host || seen.has(candidate.host)) continue;
    seen.add(candidate.host);
    candidates.push(candidate);
  }

  const verified = [];
  for (const candidate of candidates) {
    try {
      const pong = await ping(candidate, { timeoutMs: 2500, signal });
      verified.push({
        host: candidate.host,
        port: candidate.port,
        name: pong.name || candidate.name,
        version: pong.version,
        platforms: pong.platform ?? [],
      });
    } catch (error) {
      // 同网段别的服务回了广播：跳过，不打断其它候选。
      console.log(`[nas] ${candidate.host}:${candidate.port} 不是 ps5-manager: ${error.message}`);
    }
  }
  return verified;
}

/** 直接验证一个已知地址（手动填写的地址也走这里）。 */
export async function verifyServer(host, port = DEFAULT_PORT, { signal, timeoutMs = 4000 } = {}) {
  const server = { host: String(host).trim(), port: Number(port) || DEFAULT_PORT };
  if (!server.host) throw new Error("empty host");
  const pong = await ping(server, { signal, timeoutMs });
  return { ...server, name: pong.name || server.host, version: pong.version, platforms: pong.platform ?? [] };
}

/**
 * 发现流程：缓存地址 → 广播。
 * 返回第一个可用的服务器，找不到返回 null（广播本身失败时抛出，便于区分"没服务"和"网络不通"）。
 */
export async function findServer({ signal, skipCache = false } = {}) {
  if (!skipCache) {
    const cached = cachedServer();
    if (cached) {
      try {
        const server = await ping(cached, { signal, timeoutMs: 3000 });
        const found = { ...cached, name: server.name || cached.name, version: server.version };
        rememberServer(found);
        return { server: found, via: "cache" };
      } catch (error) {
        console.log(`[nas] 缓存的 ${cached.host}:${cached.port} 不可用: ${error.message}`);
      }
    }
  }
  const servers = await discoverServers({ signal });
  if (!servers.length) return null;
  rememberServer(servers[0]);
  return { server: servers[0], via: "broadcast", all: servers };
}

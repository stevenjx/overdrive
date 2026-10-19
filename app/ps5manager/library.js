// 把 ps5-manager 的 manifest 条目转成 Overdrive 现有卡片能直接渲染的形状。
//
// GameCard / Cover / lightBar 只依赖这几个字段：
//   id, title, genres, platforms, sizeGb, art.cover / art.tint, shots
// 因此不需要把 NAS 游戏塞进静态 catalog（那样会改动 1845 条数据的索引与筛选逻辑），
// 只在 NAS 页面里用同一套卡片组件渲染即可，布局与主商店完全一致。

import { absoluteURL } from "./api.js";

function platformOf(entry) {
  const value = String(entry.platform || "PS5").toUpperCase();
  return value === "PS4" ? "ps4" : "ps5";
}

export function toCard(entry, server) {
  const platform = platformOf(entry);
  const sizeBytes = Number(entry.size_bytes) || 0;
  return {
    // 前缀避免和商店的 TitleID 撞车：愿望单、最近浏览都按 id 记。
    id: `nas:${entry.id}`,
    titleId: entry.id,
    title: entry.title || entry.id,
    platform,
    platforms: [platform],
    genres: [],
    sizeGb: sizeBytes ? sizeBytes / 1e9 : null,
    sizeBytes,
    shots: [],
    art: {
      cover: absoluteURL(server, entry.cover_url),
      coverFallbacks: [],
      tint: "#17171a",
    },
    nas: {
      titleId: entry.id,
      version: entry.version || "",
      packageCount: Number(entry.package_count) || 0,
      hasPatch: Boolean(entry.has_patch),
      hasDlc: Boolean(entry.has_dlc),
      rating: Number(entry.rating) || 0,
      developer: entry.developer || "",
      releaseDate: entry.release_date || "",
      server,
    },
  };
}

/** manifest 是对象数组；按名称排序，让每次打开的顺序稳定。 */
export function toCards(manifest, server) {
  const games = Array.isArray(manifest?.games) ? manifest.games : [];
  return games
    .filter((entry) => entry && entry.id)
    .map((entry) => toCard(entry, server))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
}

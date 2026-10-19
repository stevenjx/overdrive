// 从 NAS 下载 PKG 并交给主机的安装服务。
//
// 为什么不是 ShadowMount：商店里的 exFAT 镜像靠 ShadowMount+ 挂载；
// ps5-manager 里是标准 PKG，走主机自带的安装服务（Packages.install）即可，
// 安装完成后文件可以删掉，不占双份空间。
//
// 一次只装一款：主机安装服务本身是串行的，并发只会让进度互相打架。

import { Downloads, FileSystem, Packages, Platform } from "@ps5-react/core";
import { storageRoots } from "../state/downloads.js";
import { MARGIN2 } from "../state/space.js";
import { releases as fetchReleases } from "./api.js";

var FOLDER = "ps5-manager";
var LIVE = ["preparing", "downloading", "installing"];

function safeSegment(text) {
  return String(text || "")
    .replace(/[\\/\0]/g, "_")
    .replace(/^\.+$/, "_")
    .slice(0, 120);
}

function fileName(release, titleId) {
  const raw = safeSegment(release.filename) || `${titleId}.pkg`;
  return /\.pkg$/i.test(raw) ? raw : `${raw}.pkg`;
}

function freeBytes(root) {
  try {
    return FileSystem.diskUsage(root).free;
  } catch {
    return null;
  }
}

function roots() {
  try {
    const list = storageRoots();
    return Array.isArray(list) && list.length ? list : ["/data"];
  } catch {
    return ["/data"];
  }
}

/** 选一个装得下的盘：优先内置 /data，空间不够再看 USB。 */
function pickRoot(bytes) {
  const need = bytes + MARGIN2;
  const candidates = roots().map((root) => ({ root, free: freeBytes(root) }));
  const fits = candidates.find((item) => item.free != null && item.free >= need);
  if (fits) return fits;
  const known = candidates.filter((item) => item.free != null).sort((a, b) => b.free - a.free)[0];
  const error = new Error("no space");
  error.code = "no-space";
  error.need = need;
  error.root = known?.root ?? "/data";
  error.free = known?.free ?? 0;
  throw error;
}

function busyError() {
  const error = new Error("another install is running");
  error.code = "busy";
  return error;
}

/**
 * 安装器。一个实例对应一个页面，页面卸载时 cancel()。
 *
 * job 的字段：
 *   phase      preparing | downloading | installing | done | error | cancelled
 *   title      游戏名
 *   titleId    TitleID
 *   step/totalSteps   当前第几个包 / 共几个（本体、补丁、DLC）
 *   received/bytes    当前阶段已写字节 / 总字节
 *   fraction   0..1，跨全部包的总进度
 *   root       目标盘
 *   file       当前文件路径
 *   error      失败原因
 */
export function createInstaller() {
  let job = null;
  let task = null;
  let cancelled = false;
  const listeners = new Set();

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(job);
      } catch (error) {
        console.error("[nas] install listener failed:", error);
      }
    }
  };

  const update = (patch) => {
    job = { ...job, ...patch };
    emit();
  };

  const cleanup = async (path) => {
    for (const target of [path, `${path}.complete`, `${path}.part`]) {
      try {
        if (FileSystem.exists(target)) await FileSystem.removeAsync(target);
      } catch (error) {
        console.log(`[nas] ${target} 未删除: ${error.message}`);
      }
    }
  };

  async function installOne(release, index, count, baseBytes) {
    const dir = `${job.root}/${FOLDER}/${safeSegment(job.titleId)}`;
    const path = `${dir}/${fileName(release, job.titleId)}`;
    FileSystem.mkdir(dir, { recursive: true });
    await cleanup(path);

    const size = Number(release.size_bytes) || 0;
    const kind = release.kind || "base";
    update({
      phase: "downloading",
      step: index + 1,
      file: path,
      received: 0,
      bytes: size,
      fraction: count ? baseBytes / job.totalBytes : 0,
      releaseKind: kind,
      releaseName: release.title || job.title,
    });

    task = Downloads.enqueue({ url: release.url, destination: path });
    task.subscribe((progress) => {
      const received = Number(progress.received) || 0;
      const total = Number(progress.total) || size;
      update({
        received,
        bytes: total,
        fraction: job.totalBytes ? (baseBytes + received) / job.totalBytes : 0,
      });
    });
    await task.done;
    task = null;

    update({ phase: "installing", received: 0, bytes: size });
    const install = Packages.install({ path, name: release.title || job.title });
    task = install;
    install.subscribe((progress) => {
      const written = Number(progress.written) || 0;
      const total = Number(progress.total) || size;
      update({
        received: written,
        bytes: total,
        fraction: job.totalBytes ? (baseBytes + (total ? (written / total) * size : 0)) / job.totalBytes : 0,
      });
    });
    await install.done;
    task = null;

    // 装完就删，避免一个 100GB 的游戏占两份空间；安装失败时保留，方便在 Files 里重试。
    await cleanup(path);
    return size;
  }

  async function run(game) {
    const server = game?.nas?.server;
    const titleId = game?.nas?.titleId;
    if (!server || !titleId) throw new Error("not a ps5-manager game");

    job = {
      titleId,
      title: game.title,
      gameId: game.id,
      phase: "preparing",
      step: 0,
      totalSteps: 0,
      received: 0,
      bytes: 0,
      totalBytes: 0,
      fraction: 0,
      root: "",
      file: "",
      error: "",
    };
    emit();

    const payload = await fetchReleases(server, titleId);
    const items = (payload?.releases ?? []).filter((release) => release?.url);
    if (!items.length) {
      const error = new Error("no releases");
      error.code = "no-releases";
      throw error;
    }

    const totalBytes = items.reduce((sum, release) => sum + (Number(release.size_bytes) || 0), 0);
    const target = pickRoot(totalBytes);
    job = {
      ...job,
      root: target.root,
      totalBytes,
      totalSteps: items.length,
      releases: items,
      bytes: totalBytes,
    };
    emit();

    let doneBytes = 0;
    for (let index = 0; index < items.length; index++) {
      if (cancelled) {
        const error = new Error("cancelled");
        error.code = "cancelled";
        throw error;
      }
      doneBytes += await installOne(items[index], index, items.length, doneBytes);
      job = { ...job, totalBytes, fraction: totalBytes ? doneBytes / totalBytes : 1 };
      emit();
    }

    update({ phase: "done", fraction: 1, received: totalBytes, bytes: totalBytes });
  }

  return {
    get job() {
      return job;
    },
    busy() {
      return Boolean(job && LIVE.includes(job.phase));
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(job);
      return () => listeners.delete(listener);
    },
    start(game) {
      if (job && LIVE.includes(job.phase)) throw busyError();
      if (Platform.OS !== "ps5") {
        const error = new Error("install needs a PS5");
        error.code = "not-ps5";
        return Promise.reject(error);
      }
      cancelled = false;
      return run(game).catch((error) => {
        if (cancelled || error?.code === "cancelled") {
          // 取消时清掉半截文件，别把 .part 留在盘上。
          if (job?.file) void cleanup(job.file);
          update({ phase: "cancelled", error: "" });
        } else {
          update({ phase: "error", error: error?.message || String(error), errorCode: error?.code || "" });
        }
        throw error;
      });
    },
    cancel() {
      cancelled = true;
      try {
        task?.cancel();
      } catch (error) {
        console.log(`[nas] cancel: ${error.message}`);
      }
    },
    clear() {
      job = null;
      emit();
    },
  };
}

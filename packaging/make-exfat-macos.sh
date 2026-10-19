#!/usr/bin/env bash
# macOS 版打包：把构建好的 PS5 应用目录做成 ShadowMount+ 用的裸 exFAT 镜像。
#
# 产物与 packaging/make-exfat.sh（Linux）一致：裸 exFAT 卷、64 KiB 簇、
# 卷标 OVERDRIVE、应用文件位于镜像根目录。区别只在做法：macOS 没有 loop 设备，
# 改用 hdiutil 拿到块设备节点，再用系统自带的 newfs_exfat 格式化。
#
# 不需要 sudo：hdiutil 以当前用户挂载即可。
#
# usage: make-exfat-macos.sh <app-folder> <out.exfat> [label] [cluster-size]
set -euo pipefail

app="${1:-}"
out="${2:-}"
label="${3:-OVERDRIVE}"
cluster="${4:-64K}"

if [ -z "$app" ] || [ -z "$out" ]; then
    echo "usage: $0 <app-folder> <out.exfat> [label] [cluster-size]" >&2
    exit 2
fi
[ -d "$app" ] || { echo "error: no such app folder: $app" >&2; exit 1; }
[ -f "$app/eboot.bin" ] || { echo "error: $app has no eboot.bin, it is not a built PS5 app" >&2; exit 1; }
command -v hdiutil >/dev/null || { echo "error: hdiutil not found, this script is for macOS" >&2; exit 1; }
command -v newfs_exfat >/dev/null || { echo "error: newfs_exfat not found, this script is for macOS" >&2; exit 1; }

# 簇大小以扇区数交给 newfs_exfat（512 字节/扇区）。
case "$cluster" in
    32K|32k) sectors=64 ;;
    128K|128k) sectors=256 ;;
    *) sectors=128 ;;
esac
cluster_bytes=$(( sectors * 512 ))

# 与 Linux 脚本同样的估算：每个文件按簇取整（应用里有几千个小 JSON，
# 按文件大小算会严重低估），目录也各占一个簇，再加 128 MiB 余量。
payload=$(/usr/bin/find "$app" -type f -exec stat -f '%z' {} + |
    awk -v c="$cluster_bytes" '{ n += int(($1 + c - 1) / c) } END { print n + 0 }')
directories=$(/usr/bin/find "$app" -type d | wc -l | tr -d ' ')
size=$(( (payload + directories) * cluster_bytes + 128 * 1024 * 1024 ))
size=$(( (size + 1048575) / 1048576 * 1048576 ))

echo "→ creating $out ($size bytes, $cluster clusters)"
mkdir -p "$(dirname "$out")"
rm -f "$out"
mkfile -n "$size" "$out"

# 1) 拿到块设备节点，格式化；2) 卸下，再以可写方式挂到临时目录复制文件。
dev=$(hdiutil attach -nomount -imagekey diskimage-class=CRawDiskImage "$out" | head -1 | awk '{print $1}')
[ -n "$dev" ] || { echo "error: could not attach $out" >&2; exit 1; }
trap 'hdiutil detach "$dev" >/dev/null 2>&1 || true' EXIT

newfs_exfat -v "$label" -c "$sectors" "$dev" >/dev/null
hdiutil detach "$dev" >/dev/null
trap - EXIT

mnt=$(mktemp -d /tmp/overdrive-exfat.XXXXXX)
hdiutil attach -imagekey diskimage-class=CRawDiskImage -mountpoint "$mnt" -nobrowse "$out" >/dev/null
trap 'hdiutil detach "$mnt" >/dev/null 2>&1 || true; rmdir "$mnt" 2>/dev/null || true' EXIT

cp -R "$app/." "$mnt/"
sync

src=$(/usr/bin/find "$app" -type f | wc -l | tr -d ' ')
dst=$(/usr/bin/find "$mnt" -type f | wc -l | tr -d ' ')
[ "$src" = "$dst" ] || { echo "error: wrote $dst files, the app has $src" >&2; exit 1; }

hdiutil detach "$mnt" >/dev/null
trap - EXIT
rmdir "$mnt" 2>/dev/null || true

echo "wrote $out ($(stat -f%z "$out") bytes, $src files)"

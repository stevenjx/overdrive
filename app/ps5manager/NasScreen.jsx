// NAS 页面：列出局域网 ps5-manager 上的游戏，一键装到本机。
//
// 与商店页面刻意隔离：
//   - 不往静态 catalog 里塞条目，筛选 / 排序 / 收藏的逻辑一行不动
//   - 卡片、按钮、进度条全部复用现有组件，所以视觉与主商店一致
//   - 安装走 Packages.install，不碰 ShadowMount 的 exFAT 流程

import { useCallback, useEffect, useState } from "react";
import { FocusScope, ScrollView, Text, View, VirtualList } from "@ps5-react/core";
import { useT } from "../i18n/index.js";
import { useNavActions } from "../state/nav.jsx";
import { formatBytes } from "../state/size.js";
import { Button2 as Button } from "../ui/Button.jsx";
import { Cover } from "../ui/Cover.jsx";
import { GameCard } from "../ui/GameCard.jsx";
import { Icon } from "../ui/Icon.jsx";
import { HINT, useHints } from "../ui/Legend.jsx";
import { ProgressBar } from "../ui/ProgressBar.jsx";
import { colors } from "../ui/colors.js";
import { manifest as fetchManifest } from "./api.js";
import { findServer } from "./discovery.js";
import { createInstaller } from "./install.js";
import { toCards } from "./library.js";

const COLUMNS = 6;
const CARD_WIDTH = 182;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 4) / 3) + 96;
const ROW_GAP = 40;
const COLUMN_GAP = 24;

const HINTS = [
  HINT.select,
  HINT.back,
  { button: "triangle", label: "nas.hints.rescan" },
];

// 模块级单例：离开页面再回来时安装进度还在，也不会出现两个页面各装一份。
const installer = createInstaller();

function errorText(t, code, fallback) {
  switch (code) {
    case "broadcast":
      return t("nas.error.broadcast");
    case "not-ps5":
      return t("nas.error.notPs5");
    case "no-space":
      return t("nas.error.noSpace");
    default:
      return fallback || t("nas.error.generic");
  }
}

function phaseText(t, job) {
  switch (job.phase) {
    case "preparing":
      return t("nas.phase.preparing");
    case "downloading":
      return t("nas.phase.downloading", { step: job.step, steps: job.totalSteps });
    case "installing":
      return t("nas.phase.installing", { step: job.step, steps: job.totalSteps });
    case "done":
      return t("nas.phase.done");
    case "cancelled":
      return t("nas.phase.cancelled");
    default:
      return t("nas.phase.error");
  }
}

function Chip({ children }) {
  return (
    <View style={{ borderRadius: 9, backgroundColor: colors.surface2, paddingHorizontal: 18, paddingVertical: 9 }}>
      <Text style={{ fontFamily: "Inter-Regular", fontSize: 20, color: "#f2f2f3e6", lineHeight: 28 }}>{children}</Text>
    </View>
  );
}

function Header({ server, count, onRescan, busy }) {
  const t = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          backgroundColor: colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="hardDrive" size={22} color={colors.fg} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={{
            fontFamily: "Inter-Regular",
            fontSize: 30,
            fontWeight: 600,
            color: colors.fg,
            lineHeight: 42,
            letterSpacing: -0.75,
          }}
        >
          {t("nas.title")}
        </Text>
        <Text style={{ fontFamily: "Inter-Regular", fontSize: 21, color: colors.subtle, lineHeight: 30 }}>
          {server
            ? t("nas.subtitle", { count, server: server.name || server.host })
            : t("nas.subtitle.searching")}
        </Text>
      </View>
      <Button
        variant="secondary"
        size="md"
        label={t("nas.rescan")}
        icon="restart"
        onPress={onRescan}
        focusKey="nas:rescan"
        style={busy ? { opacity: 0.5 } : null}
      />
    </View>
  );
}

function Notice({ title, detail, action, onAction }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 120 }}>
      <Icon name="hardDrive" size={32} color={colors.subtle} />
      <Text style={{ marginTop: 24, fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: colors.fg, lineHeight: 42 }}>
        {title}
      </Text>
      <Text
        style={{
          marginTop: 6,
          width: 720,
          textAlign: "center",
          fontFamily: "Inter-Regular",
          fontSize: 23,
          color: colors.muted,
          lineHeight: 34,
          numberOfLines: 3,
          ellipsizeMode: "tail",
        }}
      >
        {detail}
      </Text>
      {action ? (
        <Button
          variant="primary"
          size="lg"
          label={action}
          icon="restart"
          onPress={onAction}
          autoFocus
          focusKey="nas:retry"
          style={{ marginTop: 36 }}
        />
      ) : null}
    </View>
  );
}

function InstallSheet({ game, installer, job, onClose }) {
  const t = useT();
  const active = Boolean(job && job.gameId === game.id);
  const running = active && ["preparing", "downloading", "installing"].includes(job.phase);
  const finished = active && job.phase === "done";
  const failed = active && job.phase === "error";
  const otherRunning = Boolean(
    job && job.gameId !== game.id && ["preparing", "downloading", "installing"].includes(job.phase)
  );
  const fraction = active ? Math.max(0, Math.min(1, job.fraction || 0)) : 0;
  const percent = Math.round(fraction * 100);

  const start = () => {
    try {
      void installer.start(game).catch(() => {});
    } catch (error) {
      console.log(`[nas] start: ${error.message}`);
    }
  };

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 30,
        backgroundColor: "#000000d9",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <FocusScope trap autoFocus onBack={() => { onClose(); return true; }}>
        <View
          style={{
            width: 1120,
            borderRadius: 24,
            backgroundColor: colors.surface,
            padding: 40,
            flexDirection: "row",
            gap: 40,
          }}
        >
          <Cover game={game} style={{ width: 300, height: 400, borderRadius: 12 }} />
          <View style={{ flex: 1, gap: 18 }}>
            <Text
              style={{
                fontFamily: "Inter-Regular",
                fontSize: 34,
                fontWeight: 600,
                color: colors.fg,
                lineHeight: 46,
                numberOfLines: 2,
                ellipsizeMode: "tail",
              }}
            >
              {game.title}
            </Text>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Chip>{game.platform.toUpperCase()}</Chip>
              {game.sizeBytes ? <Chip>{formatBytes(game.sizeBytes)}</Chip> : null}
              {game.nas.packageCount > 0 ? <Chip>{t("nas.packages", { count: game.nas.packageCount })}</Chip> : null}
              {game.nas.hasPatch ? <Chip>{t("nas.patch")}</Chip> : null}
              {game.nas.hasDlc ? <Chip>{t("nas.dlc")}</Chip> : null}
            </View>
            <Text style={{ fontFamily: "Inter-Regular", fontSize: 21, color: colors.subtle, lineHeight: 30 }}>
              {t("nas.server", { server: `${game.nas.server.name || game.nas.server.host} · ${game.nas.server.host}` })}
            </Text>

            <View style={{ marginTop: 6, minHeight: 118, justifyContent: "center", gap: 12 }}>
              {active ? (
                <>
                  <Text
                    style={{
                      fontFamily: "Inter-Regular",
                      fontSize: 23,
                      color: finished ? colors.ok : failed ? colors.warn : colors.fg,
                      lineHeight: 32,
                    }}
                  >
                    {finished
                      ? t("nas.phase.done")
                      : failed
                        ? errorText(t, job.errorCode, job.error)
                        : phaseText(t, job)}
                  </Text>
                  {running || finished ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
                      <ProgressBar fraction={fraction} width={560} active={running} />
                      <Text style={{ fontFamily: "Inter-Regular", fontSize: 20, color: colors.muted }}>
                        {running ? `${percent}%` : ""}
                      </Text>
                    </View>
                  ) : null}
                  {active && job.file ? (
                    <Text
                      style={{
                        fontFamily: "JetBrainsMono-Regular",
                        fontSize: 18,
                        color: colors.subtle,
                        numberOfLines: 1,
                        ellipsizeMode: "tail",
                      }}
                    >
                      {job.file}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={{ fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }}>
                  {otherRunning ? t("nas.busyOther", { title: job.title }) : t("nas.installDetail")}
                </Text>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
              {running ? (
                <Button variant="secondary" size="lg" label={t("nas.cancel")} onPress={() => installer.cancel()} focusKey="nas:cancel" />
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  label={finished ? t("nas.installed") : failed || (active && job.phase === "cancelled") ? t("nas.retryInstall") : t("nas.install")}
                  icon="download"
                  onPress={finished || otherRunning ? undefined : start}
                  autoFocus
                  focusKey="nas:install"
                  style={finished || otherRunning ? { opacity: 0.6 } : null}
                />
              )}
              <Button variant="secondary" size="lg" label={t("nas.close")} onPress={onClose} focusKey="nas:close" />
            </View>
          </View>
        </View>
      </FocusScope>
    </View>
  );
}

export function NasScreen({ onBack }) {
  const t = useT();
  const { focusLater } = useNavActions();
  const [state, setState] = useState({ status: "discovering", server: null, games: [], error: "", errorCode: "" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(null);
  const [job, setJob] = useState(null);

  useHints(HINTS);

  useEffect(() => installer.subscribe(setJob), [installer]);

  useEffect(() => {
    let live = true;
    setState((previous) => ({ ...previous, status: "discovering", error: "", errorCode: "" }));
    (async () => {
      try {
        const found = await findServer({});
        if (!live) return;
        if (!found) {
          setState({ status: "empty", server: null, games: [], error: "", errorCode: "" });
          return;
        }
        const payload = await fetchManifest(found.server);
        if (!live) return;
        setState({ status: "ready", server: found.server, games: toCards(payload, found.server), error: "", errorCode: "" });
      } catch (error) {
        if (!live) return;
        setState({ status: "error", server: null, games: [], error: error?.message || String(error), errorCode: error?.code || "" });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  const rescan = useCallback(() => setAttempt((value) => value + 1), []);

  const open = useCallback((game) => setSelected(game), []);

  const closeSheet = useCallback(() => {
    const game = selected;
    setSelected(null);
    if (game) focusLater(`card:${game.id}`);
  }, [selected, focusLater]);

  const renderItem = useCallback(
    ({ item, index }) => (
      <GameCard
        game={item}
        width={CARD_WIDTH}
        detailed
        rowEnd={index % COLUMNS === COLUMNS - 1 || index === state.games.length - 1}
        rowStart={index % COLUMNS === 0}
        onPress={() => open(item)}
      />
    ),
    [open, state.games.length]
  );

  const ready = state.status === "ready";
  const busy = state.status === "discovering";

  return (
    <FocusScope
      trap
      autoFocus
      onBack={() => {
        onBack();
        return true;
      }}
      onAction={(action) => {
        if (action !== "triangle") return false;
        rescan();
        return true;
      }}
    >
      <View style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1, paddingHorizontal: 48, paddingTop: 36 }}>
          <Header server={state.server} count={state.games.length} onRescan={rescan} busy={busy} />

          {ready && state.games.length > 0 ? (
            <VirtualList
              style={{ marginTop: 36 }}
              data={state.games}
              numColumns={COLUMNS}
              itemHeight={CARD_HEIGHT}
              rowGap={ROW_GAP}
              columnGap={COLUMN_GAP}
              initialNumRows={3}
              keyExtractor={(game) => game.id}
              renderItem={renderItem}
            />
          ) : null}

          {state.status === "discovering" ? (
            <Notice
              title={t("nas.searching.title")}
              detail={t("nas.searching.detail")}
            />
          ) : null}

          {state.status === "empty" ? (
            <Notice
              title={t("nas.empty.title")}
              detail={t("nas.empty.detail")}
              action={t("nas.rescan")}
              onAction={rescan}
            />
          ) : null}

          {state.status === "error" ? (
            <Notice
              title={t("nas.error.title")}
              detail={errorText(t, state.errorCode, state.error)}
              action={t("nas.rescan")}
              onAction={rescan}
            />
          ) : null}

          {ready && state.games.length === 0 ? (
            <Notice title={t("nas.emptyLibrary.title")} detail={t("nas.emptyLibrary.detail")} action={t("nas.rescan")} onAction={rescan} />
          ) : null}
        </ScrollView>

        {selected ? <InstallSheet game={selected} installer={installer} job={job} onClose={closeSheet} /> : null}
      </View>
    </FocusScope>
  );
}

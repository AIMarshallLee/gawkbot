import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { restartBroker } from "../../api/client";
import { getHealth, type HealthResponse } from "../../api/platform";
import {
  getUpgradeCheck,
  UPGRADE_CHECK_QUERY_KEY,
  type UpgradeCheckResponse,
} from "../../api/upgrade";
import { useOfficeMembers } from "../../hooks/useMembers";
import { appTitle } from "../../lib/constants";
import { bilingual } from "../../lib/bilingual";
import { useCurrentRoute } from "../../routes/useCurrentRoute";
import { useAppStore } from "../../stores/app";
import { Kbd } from "../ui/Kbd";
import { deriveStatus } from "../ui/VersionModal";
import { StatusPill } from "../workspaces/StatusPill";
import { GovernorControl } from "./GovernorControl";
import { formatVersion } from "./upgradeBanner.utils";

/**
 * Bottom status bar mirroring the legacy IIFE: shows the active channel/app,
 * mode (office vs 1:1), bot count, broker connection, and runtime provider.
 */
export function StatusBar() {
  const route = useCurrentRoute();
  const brokerConnected = useAppStore((s) => s.brokerConnected);
  const setComposerHelpOpen = useAppStore((s) => s.setComposerHelpOpen);
  const setVersionModalOpen = useAppStore((s) => s.setVersionModalOpen);

  const [retrying, setRetrying] = useState(false);

  // Clear the in-progress state once the broker reconnects.
  useEffect(() => {
    if (brokerConnected) setRetrying(false);
  }, [brokerConnected]);

  const handleRestart = useCallback(async () => {
    setRetrying(true);
    try {
      await restartBroker();
      // 202 received — broker is exiting and will respawn. Keep retrying=true
      // until brokerConnected flips back via the useEffect above.
    } catch {
      // Broker unreachable or spawn failed: reset immediately so the button
      // is clickable again.
      setRetrying(false);
    }
  }, []);
  const { data: members = [] } = useOfficeMembers();

  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: () => getHealth(),
    refetchInterval: 15_000,
    enabled: brokerConnected,
  });

  // /upgrade-check is broker-cached for an hour, so a 5-min refetch is
  // cheap and keeps the freshness dot honest after a release lands. The
  // VersionModal shares this query key (and matching staleTime) so
  // opening the modal doesn't re-fire the request.
  // TODO(version-banner): UpgradeBanner.tsx still calls getUpgradeCheck()
  // directly from a useEffect — migrate it to this query so all three
  // surfaces (banner, chip, modal) share one cache and the modal's
  // refetch after runUpgrade naturally drives a banner re-render.
  const { data: upgradeCheck, isFetching: upgradeChecking } =
    useQuery<UpgradeCheckResponse>({
      queryKey: UPGRADE_CHECK_QUERY_KEY,
      queryFn: () => getUpgradeCheck(),
      enabled: brokerConnected,
      staleTime: 5 * 60_000,
      refetchInterval: 5 * 60_000,
      refetchOnWindowFocus: false,
    });

  const botCount = members.filter(
    (m) =>
      m.slug && m.slug !== "human" && m.slug !== "you" && m.slug !== "system",
  ).length;

  // Mirrors ChannelHeader.headerTitleAndDesc — the two surfaces should
  // present the same user-facing title for the same route. wiki-lookup
  // shares the Wiki app title; notebooks/reviews are capitalized to
  // match the header copy.
  const channelLabel = (() => {
    switch (route.kind) {
      case "channel":
        return `# ${route.channelSlug}`;
      case "app":
        return appTitle(route.appId);
      case "task-board":
      case "task-detail":
        return appTitle("tasks");
      case "wiki":
      case "wiki-article":
      case "wiki-lookup":
        return appTitle("wiki");
      case "article":
        return bilingual("Article", "文章");
      case "inbox":
        return bilingual("Decision Inbox", "决策收件箱");
      case "task-decision":
        return bilingual(`Task ${route.taskId}`, `任务 ${route.taskId}`);
      case "task-new":
        return bilingual("New task", "新建任务");
      case "agents":
        return bilingual("Bots", "机器人");
      case "bot-detail":
        return `@${route.agentSlug}`;
      case "skill-detail":
        return `skill · ${route.skillName}`;
      case "routine-detail":
        return bilingual(`Routine ${route.routineSlug}`, `流程 ${route.routineSlug}`);
      case "routine-new":
        return bilingual("New scheduled task", "新建定时任务");
      case "home":
        return bilingual("Home", "首页");
      case "unknown":
        return "";
      default: {
        // Exhaustiveness check — see MainContent's matching switch.
        const _exhaustive: never = route;
        void _exhaustive;
        return "";
      }
    }
  })();
  const modeLabel = bilingual("office", "办公室");
  const provider = health?.provider;
  const providerModel = health?.provider_model?.trim();

  // Prefer the live /health value for the chip label so it reflects the
  // running binary, not whatever /upgrade-check (cached an hour) reports.
  const currentVersion = health?.build?.version ?? upgradeCheck?.current ?? "";
  const versionLabel = formatVersion(currentVersion, "—");
  const versionStatus = deriveStatus(upgradeCheck, upgradeChecking);
  const versionTitle = (() => {
    const latest = formatVersion(upgradeCheck?.latest, "");
    switch (versionStatus.kind) {
      case "ok":
        return `gawkbot ${versionLabel} — up to date`;
      case "outdated":
        return latest
          ? `gawkbot ${versionLabel} — update available (${latest})`
          : `gawkbot ${versionLabel} — update available`;
      case "dev":
        return `gawkbot ${versionLabel} — dev build`;
      case "error":
        return `gawkbot ${versionLabel} — version check failed`;
      case "loading":
        return `gawkbot ${versionLabel} — checking for updates…`;
      default:
        return `gawkbot ${versionLabel}`;
    }
  })();

  return (
    <div className="status-bar">
      <StatusPill />
      <span className="status-bar-item">{channelLabel}</span>
      <span className="status-bar-item">{modeLabel}</span>
      <span className="status-bar-spacer" />
      <GovernorControl />
      <button
        type="button"
        className="status-bar-shortcut"
        onClick={() => setComposerHelpOpen(true)}
        title={bilingual("Keyboard shortcuts", "键盘快捷键")}
        aria-label={bilingual("Open keyboard shortcuts", "打开键盘快捷键")}
      >
        <Kbd size="sm">?</Kbd>
        <span>{bilingual("shortcuts", "快捷键")}</span>
      </button>
      <span className="status-bar-item">
        {bilingual(`${botCount} bot${botCount === 1 ? "" : "s"}`, `${botCount} 个机器人`)}
      </span>
      {provider ? (
        <span
          className="status-bar-item"
          title={
            providerModel
              ? `Runtime: ${provider} · ${providerModel}`
              : `Runtime provider: ${provider}`
          }
        >
          {"⚙ "}
          {provider}
          {providerModel ? (
            <>
              <span className="status-bar-sep"> · </span>
              <span className="status-bar-model">{providerModel}</span>
            </>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        className={`status-bar-item status-bar-version status-bar-version--${versionStatus.kind}`}
        onClick={() => setVersionModalOpen(true)}
        title={versionTitle}
        aria-label={versionTitle}
      >
        <span className="status-bar-version-dot" aria-hidden={true} />
        <span>{versionLabel}</span>
      </button>
      {brokerConnected ? (
        <span className="status-bar-item status-bar-conn">{bilingual("connected", "已连接")}</span>
      ) : (
        <button
          type="button"
          className="status-bar-item status-bar-conn status-bar-conn-retry disconnected"
          onClick={handleRestart}
          disabled={retrying}
          title={bilingual("Click to restart broker", "点击重启代理")}
          aria-label={retrying ? bilingual("Restarting broker…", "正在重启代理…") : bilingual("Restart broker", "重启代理")}
        >
          {retrying ? bilingual("restarting…", "正在重启…") : bilingual("disconnected", "未连接")}
        </button>
      )}
    </div>
  );
}

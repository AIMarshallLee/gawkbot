/**
 * BotsTool — the dedicated Bots surface.
 *
 * Two views, both mounted under `/bots`:
 *   • `BotsTool`   (/bots)            — a roster grid of every bot.
 *   • `BotDetail`  (/bots/$botSlug) — the per-bot config page,
 *                                           reusing BotProfilePanel.
 *
 * Bots are first-class in gawkbot, but they are NOT chat surfaces. The
 * pure task-scoped model reaches a bot through the tasks it owns (each
 * task has its own channel where the bot is a member); this tool is for
 * seeing the roster and configuring a bot's provider / role / skills.
 */

import { useMemo } from "react";

import type { OfficeMember } from "../../api/client";
import { useDefaultHarness } from "../../hooks/useConfig";
import { useOfficeMembers } from "../../hooks/useMembers";
import { type HarnessKind, resolveHarness } from "../../lib/harness";
import { bilingual } from "../../lib/bilingual";
import { router } from "../../lib/router";
import { HarnessBadge } from "../ui/HarnessBadge";
import { PixelAvatar } from "../ui/PixelAvatar";
import { BotSubspace } from "./BotSubspace";
import { BotWizard, useBotWizard } from "./BotWizard";

/** Short descriptors for the always-present default bots. */
const DEFAULT_AGENT_HINT: Record<string, string> = {
  cos: "Orchestrator · 协调者 — present on every task · 参与每项任务",
  librarian: "Librarian · 图书管理员 — writes and organizes the wiki · 编写并整理知识库",
};

function navigateToBot(slug: string): void {
  void router.navigate({
    to: "/agents/$agentSlug",
    params: { agentSlug: slug },
  });
}

function roleHint(agent: OfficeMember): string {
  return DEFAULT_AGENT_HINT[agent.slug] ?? agent.role ?? bilingual("Specialist", "专家");
}

interface BotCardProps {
  agent: OfficeMember;
  defaultHarness: HarnessKind;
}

function BotCard({ agent, defaultHarness }: BotCardProps) {
  const harness = resolveHarness(agent.provider, defaultHarness);
  const displayName = agent.name || agent.slug;
  const isActive = (agent.status || "").toLowerCase() === "active";

  return (
    <button
      type="button"
      className="agents-tool-card"
      onClick={() => navigateToBot(agent.slug)}
      data-bot-slug={agent.slug}
      aria-label={`Configure ${displayName}`}
    >
      <span className="bots-tool-card-avatar avatar-with-harness">
        <PixelAvatar slug={agent.slug} size={40} />
        <HarnessBadge
          kind={harness}
          size={12}
          className="harness-badge-on-avatar"
        />
        {agent.online ? (
          <span className="online-badge" aria-hidden="true" />
        ) : null}
      </span>
      <span className="agents-tool-card-name">{displayName}</span>
      <span className="agents-tool-card-role">{roleHint(agent)}</span>
      <span
        className={`agents-tool-card-status${isActive ? " is-active" : ""}`}
      >
        {isActive ? bilingual("Working", "工作中") : bilingual("Idle", "空闲")}
      </span>
    </button>
  );
}

export function BotsTool() {
  const { data: members = [] } = useOfficeMembers();
  const defaultHarness = useDefaultHarness();
  const wizard = useBotWizard();

  // CEO first (orchestrator), then the rest in broker order. Keeps the
  // default bots (CEO + Librarian) reading as the spine of the roster.
  // Key on `members` (stable across polls): filtering inline outside the memo
  // produced a new array every render, so the memo never actually cached.
  const ordered = useMemo<OfficeMember[]>(() => {
    const agents = members.filter((m) => m.slug && m.slug !== "human");
    const cos = agents.find((a) => a.slug === "cos");
    const rest = agents.filter((a) => a.slug !== "cos");
    return cos ? [cos, ...rest] : rest;
  }, [members]);

  return (
    <div className="app-panel active bots-tool" data-testid="agents-tool">
      <header className="agents-tool-header">
        <h2 className="agents-tool-heading">{bilingual("Bots", "机器人")}</h2>
        <button
          type="button"
          className="issues-new-btn issues-new-btn--header"
          onClick={wizard.show}
          data-testid="agents-tool-new-btn"
          title={bilingual("Create a new bot", "新建机器人")}
        >
          + {bilingual("New bot", "新建机器人")}
        </button>
      </header>
      {ordered.length === 0 ? (
        <p className="agents-tool-empty">{bilingual("No bots yet.", "暂无机器人。")}</p>
      ) : (
        <div className="agents-tool-grid" data-testid="agents-tool-grid">
          {ordered.map((agent) => (
            <BotCard
              key={agent.slug}
              agent={agent}
              defaultHarness={defaultHarness}
            />
          ))}
        </div>
      )}
      <BotWizard open={wizard.open} onClose={wizard.hide} />
    </div>
  );
}

interface BotDetailProps {
  agentSlug: string;
  tab?: string;
}

export function BotDetail({ agentSlug, tab }: BotDetailProps) {
  const { data: members = [] } = useOfficeMembers();
  const agent = useMemo(
    () => members.find((m) => m.slug === agentSlug),
    [members, agentSlug],
  );

  function back() {
    void router.navigate({ to: "/agents" });
  }

  if (!agent) {
    return (
      <div className="app-panel active bots-tool" data-testid="bot-detail">
        <div className="agents-tool-empty">
          <p>{bilingual(`No bot "${agentSlug}".`, `未找到机器人“${agentSlug}”。`)}</p>
          <button
            type="button"
            className="issues-new-btn"
            onClick={back}
            data-testid="bot-detail-back"
          >
            ← {bilingual("Back to Bots", "返回机器人")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-panel active bot-detail-panel"
      data-testid="bot-detail"
      data-bot-slug={agentSlug}
    >
      <BotSubspace agent={agent} tab={tab ?? "chat"} />
    </div>
  );
}

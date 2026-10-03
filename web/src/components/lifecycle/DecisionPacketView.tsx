import { useEffect, useState } from "react";
import { Globe, Loader2 } from "lucide-react";

import { router } from "../../lib/router";
import { translateToChinese } from "../../lib/translateService";
import type {
  DecisionPacket,
  FeedbackItem,
  LifecycleState,
  PacketBanner,
} from "../../lib/types/lifecycle";
import { Bilingual } from "../ui/Bilingual";
import { LifecycleStatePill } from "./LifecycleStatePill";
import { PacketActionSidebar } from "./PacketActionSidebar";
import { SeverityGradeCard } from "./SeverityGradeCard";

interface DecisionPacketViewProps {
  packet: DecisionPacket;
  /** Streaming state: owner bot still working. Locks decision buttons. */
  isStreaming?: boolean;
  /** Persistence-error banner shown above everything else. */
  hasPersistenceError?: boolean;
  /** Reviewer-convergence-timeout banner shown above everything else. */
  hasReviewerTimeout?: boolean;
  /** Callback the route uses to navigate back to /inbox on Esc. */
  onClose: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onDefer: () => void;
  onBlock: () => void;
  onReject?: (body: string) => void | Promise<void>;
  onOpenInWorktree: () => void;
}

/**
 * Three-column Decision Packet view. NOT centered hero, NOT stacked
 * cards, NOT a chat thread.
 *
 *   - Left: deps / sub-issues / reviewer set context (`role=navigation`).
 *   - Center: spec → AC → session report → diff → grades reading flow
 *     (`role=main`).
 *   - Right: sticky action sidebar (`role=complementary`).
 *
 * State coverage handled here: populated, streaming, reviewer-timeout,
 * persistence-error, missing-packet (regenerated). Loading/error are
 * handled at the route layer above this so the view always receives a
 * concrete `DecisionPacket`.
 */
export function DecisionPacketView({
  packet,
  isStreaming = false,
  hasPersistenceError = false,
  hasReviewerTimeout = false,
  onClose,
  onApprove,
  onRequestChanges,
  onDefer,
  onBlock,
  onReject,
  onOpenInWorktree,
}: DecisionPacketViewProps) {
  // Keyboard shortcuts — a / r / b / w / Esc per locked v1 design.
  useEffect(() => {
    const actionMap: Record<string, () => void> = {
      a: onApprove,
      r: onRequestChanges,
      b: onBlock,
      w: onOpenInWorktree,
    };
    function handler(e: KeyboardEvent) {
      if (shouldIgnoreShortcut(e)) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (isStreaming) return;
      const action = actionMap[e.key.toLowerCase()];
      if (action) action();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    isStreaming,
    onClose,
    onApprove,
    onRequestChanges,
    onBlock,
    onOpenInWorktree,
  ]);

  const acDoneCount = packet.spec.acceptanceCriteria.filter(
    (ac) => ac.done,
  ).length;
  const acTotal = packet.spec.acceptanceCriteria.length;
  const totalAdds = packet.changedFiles.reduce((n, f) => n + f.additions, 0);
  const totalDels = packet.changedFiles.reduce((n, f) => n + f.deletions, 0);
  const grades = packet.reviewerGrades;
  const gradedCount = grades.filter((g) => g.severity !== "skipped").length;
  const skippedCount = grades.filter((g) => g.severity === "skipped").length;

  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [isAllTranslated, setIsAllTranslated] = useState(false);
  const [translatedMap, setTranslatedMap] = useState<Record<string, string>>({});

  const toggleTranslateAll = async () => {
    if (isTranslatingAll) return;
    if (isAllTranslated) {
      setIsAllTranslated(false);
      return;
    }
    setIsTranslatingAll(true);
    try {
      const [titleZh, assignZh, problemZh, highlightsZh] = await Promise.all([
        packet.title ? translateToChinese(packet.title) : Promise.resolve(""),
        packet.spec.assignment ? translateToChinese(packet.spec.assignment) : Promise.resolve(""),
        packet.spec.problem ? translateToChinese(packet.spec.problem) : Promise.resolve(""),
        packet.sessionReport.highlights ? translateToChinese(packet.sessionReport.highlights) : Promise.resolve(""),
      ]);
      setTranslatedMap({
        title: titleZh,
        assignment: assignZh,
        problem: problemZh,
        highlights: highlightsZh,
      });
      setIsAllTranslated(true);
    } catch (err) {
      console.error("Translation error", err);
    } finally {
      setIsTranslatingAll(false);
    }
  };

  const displayTitle = isAllTranslated ? (translatedMap.title || packet.title) : packet.title;
  const displayAssignment = isAllTranslated ? (translatedMap.assignment || packet.spec.assignment) : packet.spec.assignment;
  const displayProblem = isAllTranslated ? (translatedMap.problem || packet.spec.problem) : packet.spec.problem;
  const displayHighlights = isAllTranslated ? (translatedMap.highlights || packet.sessionReport.highlights) : packet.sessionReport.highlights;

  return (
    <div className="packet-shell">
      <PacketLeftColumn packet={packet} />
      <main className="packet-center">
        {hasPersistenceError ? <PersistenceBanner /> : null}
        {hasReviewerTimeout ? <ReviewerTimeoutForcedBanner /> : null}
        {packet.regeneratedFromMemory ? <RegeneratedBanner /> : null}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <PacketMeta packet={packet} />
          <button
            type="button"
            className={`translate-btn ${isAllTranslated ? "is-translated" : ""}`}
            onClick={toggleTranslateAll}
            disabled={isTranslatingAll}
            style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "6px" }}
            title={isAllTranslated ? "点击恢复显示英文原文" : "一键将标题、需求规范、决策说明、变更亮点翻译为中文"}
          >
            {isTranslatingAll ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Globe size={14} />
            )}
            <span>
              {isTranslatingAll
                ? "正在翻译…"
                : isAllTranslated
                  ? "🌐 还原英文原文"
                  : "🌐 一键翻译审核内容为中文"}
            </span>
          </button>
        </div>
        <h1 className="packet-task-title">{displayTitle}</h1>

        <div className="packet-assignment">
          <div className="label">
            <Bilingual en="Your call" zh="您的决策" layout="inline" />
          </div>
          <p>{displayAssignment}</p>
        </div>

        <section
          className="packet-section"
          aria-label="Spec and acceptance criteria"
        >
          <h3>
            Spec · 需求规范{" "}
            <span className="count">
              {acDoneCount}/{acTotal} acceptance criteria done · 已完成 {acDoneCount}/{acTotal} 项验收标准
            </span>
          </h3>
          <p>{displayProblem}</p>
          <div className="packet-ac">
            {packet.spec.acceptanceCriteria.map((ac, idx) => (
              <div
                key={`${idx}-${ac.statement}`}
                className={`packet-ac-item ${ac.done ? "done" : "todo"}`}
              >
                <div className="packet-ac-check" aria-hidden="true">
                  {ac.done ? "✓" : ""}
                </div>
                <span>{ac.statement}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="packet-section" aria-label="Session report">
          <h3 className={isStreaming ? "is-streaming" : undefined}>
            What changed · 变更内容{" "}
            <span className="count">
              +{totalAdds} / −{totalDels} across {packet.changedFiles.length}{" "}
              files · 涉及 {packet.changedFiles.length} 个文件
            </span>
          </h3>
          {isStreaming ? (
            <p className="packet-streaming-hint">
              <Bilingual
                en="Owner bot still working… acceptance criteria can update mid-view."
                zh="负责机器人仍在工作中… 验收标准可能在查看过程中动态更新。"
                layout="stacked"
              />
            </p>
          ) : null}
          <div className="packet-report">
            <h4>Highlights · 亮点摘要</h4>
            <p className="highlights-prose">
              {displayHighlights}
            </p>
          </div>
          {packet.sessionReport.topWins.length > 0 ? (
            <div className="packet-report">
              <h4>What I tried that worked (kept) · 尝试有效的方法 (已保留)</h4>
              <ul>
                {packet.sessionReport.topWins.map((win) => (
                  <li key={`${win.delta}-${win.description}`}>
                    <span className="delta">{win.delta}</span>
                    <span>{win.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {packet.sessionReport.deadEnds.length > 0 ? (
            <div className="packet-report">
              <h4>What I tried that didn't work (dead ends) · 尝试但未奏效的死胡同</h4>
              <ul>
                {packet.sessionReport.deadEnds.map((d) => (
                  <li key={`${d.tried}-${d.reason}`} className="dead-end">
                    <span className="delta">{d.tried}</span>
                    <span>{d.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="packet-diff">
            {packet.changedFiles.map((f) => (
              <div key={f.path} className="packet-diff-row">
                <span className="stat-pos">+{f.additions}</span>
                <span className="stat-neg">−{f.deletions}</span>
                <span className="file-path">{f.path}</span>
                {f.status === "added" ? (
                  <span className="file-tag">new · 新增</span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="packet-section" aria-label="Reviewer grades">
          <h3>
            Reviewer grades · 审查评分{" "}
            <span className="count">
              {gradedCount} of {grades.length} graded · 已完成 {gradedCount}/{grades.length} 项
              {skippedCount > 0 ? ` · ${skippedCount} timed out · ${skippedCount} 项超时` : ""}
            </span>
          </h3>
          {packet.banners
            .filter((b) => b.kind === "reviewer_timeout")
            .map((banner, idx) => (
              <ReviewerTimeoutBanner
                key={`${banner.kind}-${banner.reviewerSlug ?? idx}`}
                banner={banner}
              />
            ))}
          <div className="packet-grades">
            {grades.map((g) => (
              <SeverityGradeCard
                key={`${g.reviewerSlug}-${g.submittedAt}-${g.suggestion}`}
                grade={g}
              />
            ))}
          </div>
        </section>

        <DiscussionSection
          feedback={packet.spec.feedback ?? []}
          channel={packet.channel}
        />
      </main>
      <PacketActionSidebar
        packet={packet}
        isDecisionLocked={isStreaming}
        onApprove={onApprove}
        onRequestChanges={onRequestChanges}
        onDefer={onDefer}
        onBlock={onBlock}
        onReject={onReject}
        onOpenInWorktree={onOpenInWorktree}
      />
    </div>
  );
}

function PacketMeta({ packet }: { packet: DecisionPacket }) {
  const ago = formatHoursAgo(packet.updatedAt);
  return (
    <div className="packet-task-meta">
      <LifecycleStatePill state={packet.lifecycleState} />
      <span aria-hidden="true">·</span>
      <span>{packet.taskId}</span>
      <span aria-hidden="true">·</span>
      <span>
        {packet.ownerSlug} · {ago}
      </span>
    </div>
  );
}

function PacketLeftColumn({ packet }: { packet: DecisionPacket }) {
  const allReviewersGraded = packet.reviewers.every((r) => r.hasGraded);
  return (
    <nav className="packet-left" aria-label="Task context">
      <div className="crumb">
        <a href="#/inbox">inbox · 收件箱</a> / task · 任务
      </div>
      {packet.subIssues.length > 0 ? (
        <>
          <h2>Sub-tasks · 子任务</h2>
          <div className="packet-deps">
            {packet.subIssues.map((sub) => (
              <div key={sub.taskId} className="packet-dep">
                <span className="dot" aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0 }}>{sub.title}</span>
                <span
                  style={{
                    color: "var(--text-tertiary)",
                    fontSize: 12,
                  }}
                >
                  {stateLabel(sub.state)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {packet.dependencies.blockedOn.length > 0 ? (
        <>
          <h2>Blocked on · 阻塞于</h2>
          <div className="packet-deps">
            {packet.dependencies.blockedOn.map((id) => (
              <div key={id} className="packet-dep blocked">
                <span className="dot" aria-hidden="true" />
                {id} · waiting approval · 等待审批
              </div>
            ))}
          </div>
        </>
      ) : null}
      <h2>
        Reviewer set · 审查组{" "}
        {allReviewersGraded ? <span aria-hidden="true">·</span> : null}
      </h2>
      <div className="packet-deps">
        {packet.reviewers.map((r) => (
          <div
            key={r.slug}
            className={`packet-dep ${r.hasGraded ? "is-graded" : ""}`}
          >
            <span className="dot" aria-hidden="true" />
            <span style={{ flex: 1 }}>
              {r.slug}
              {r.isHuman ? " (you · 你)" : ""}
            </span>
            <span
              style={{
                color: "var(--text-tertiary)",
                fontSize: 12,
              }}
            >
              {r.hasGraded ? "graded · 已评分" : "—"}
            </span>
          </div>
        ))}
      </div>
    </nav>
  );
}

function ReviewerTimeoutBanner({ banner }: { banner: PacketBanner }) {
  const elapsed = banner.elapsed ?? "10m";
  return (
    <div className="packet-banner warning" role="status">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <Bilingual
          en={`Reviewer ${banner.reviewerSlug} timed out at ${elapsed}. ${banner.message}`}
          zh={`审查员 ${banner.reviewerSlug} 在 ${elapsed} 超时。系统已填入跳过占位符，您仍可合并或重新发起审查。`}
          layout="stacked"
        />
      </div>
    </div>
  );
}

// ReviewerTimeoutForcedBanner is the screenshot/E2E forced-state banner.
// It does not require a banner object because the only consumer is the
// route layer's forceState path; the in-packet banner case is handled
// by ReviewerTimeoutBanner with a real PacketBanner payload.
function ReviewerTimeoutForcedBanner() {
  return (
    <div className="packet-banner warning" role="status">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <Bilingual
          en="At least one reviewer hit the convergence timeout. The Decision Packet is presented with their grade marked as skipped so a human can still resolve the task."
          zh="至少有一位审查员达到收敛超时。决策数据包将其评分标记为跳过，以便人工仍可处理并解决此任务。"
          layout="stacked"
        />
      </div>
    </div>
  );
}

function PersistenceBanner() {
  return (
    <div className="packet-banner error" role="alert">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <Bilingual
          en="Persistence error on this task — your changes are still in memory but not saved to disk yet. Fix the underlying issue (disk space, permissions) and the next transition will retry."
          zh="此任务出现持久化错误 — 您的修改仍保存在内存中，但尚未写入磁盘。请修复底层问题（磁盘空间或权限不足），下一个状态转换将自动重试。"
          layout="stacked"
        />
      </div>
    </div>
  );
}

function RegeneratedBanner() {
  return (
    <div className="packet-banner warning" role="status">
      <span className="banner-dot" aria-hidden="true" />
      <div>
        <Bilingual
          en="Packet regenerated from in-memory state. Some fields may be incomplete — verify before merging."
          zh="数据包已从内存状态重新生成。部分字段可能不完整 — 请在合并前核验。"
          layout="stacked"
        />
      </div>
    </div>
  );
}

function stateLabel(state: LifecycleState): string {
  return state.replace(/_/g, " ");
}

/** True when the keydown event came from a text input or carries a modifier. */
function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function formatHoursAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffMs = Date.now() - then;
  const mins = Math.max(1, Math.round(diffMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

interface DiscussionSectionProps {
  feedback: FeedbackItem[];
  /** The task's own channel slug, used to link to the conversation. */
  channel?: string;
}

function DiscussionSection({ feedback, channel }: DiscussionSectionProps) {
  const channelSlug = channel?.trim();
  return (
    <section
      className="packet-section packet-discussion"
      aria-label="Discussion"
      data-testid="packet-discussion"
    >
      <h3>
        Discussion · 讨论区{" "}
        <span className="count">
          {feedback.length} {feedback.length === 1 ? "comment" : "comments"} · {feedback.length} 条评论
        </span>
      </h3>
      {feedback.length === 0 ? (
        <p className="packet-discussion-empty">
          <Bilingual
            en="No review notes yet. Approvals, requested changes, and reviewer notes appear here."
            zh="暂无审查备注。批准、修改请求与审查员意见将显示在此处。"
            layout="stacked"
          />
          {/* No channel doorway from a task: the office is one room, and the
              discussion lives in the channel the task was created from, which
              the sidebar lists directly. */}
        </p>
      ) : (
        <ol className="packet-discussion-thread">
          {feedback.map((item, idx) => (
            <li
              key={`${item.appendedAt}-${idx}`}
              className="packet-discussion-item"
            >
              <header className="packet-discussion-header">
                <span className="packet-discussion-author">
                  @{item.author || "unknown"}
                </span>
                <span className="packet-discussion-time">
                  {formatHoursAgo(item.appendedAt)}
                </span>
              </header>
              <div className="packet-discussion-body">{item.body}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ChatLines,
  CheckCircle,
  GitFork,
  HelpCircle,
  Refresh,
  Xmark,
} from "iconoir-react";

import {
  getTaskActivity,
  type TaskActivityEvent,
  type TaskActivityEventKind,
} from "../../api/tasks";
import {
  humanizeLifecycleState,
  humanizeStateTokens,
  humanizeTurnOutcome,
} from "../../lib/humanizeActivity";
import { router } from "../../lib/router";
import { Bilingual } from "../ui/Bilingual";

interface TaskActivityFeedProps {
  taskId: string;
}

/**
 * Activity is a structured audit of an Issue's state changes — NOT a second
 * copy of the conversation. It surfaces only:
 *   - lifecycle transitions (officeActionLog kind=lifecycle_*)
 *   - human_interview requests with their resolution
 *   - sub-issue creations
 *
 * Comments are deliberately excluded — they render in the chat stream
 * (TaskCommentCard) which is the canonical reply thread, so duplicating
 * them here would just be the chat again. Generic `action` log entries are
 * excluded too; only the three state-event kinds above belong in the audit.
 *
 * Open requests are clickable — they deep-link into the Inbox so the
 * human can answer without leaving the Activity view.
 */
const FEED_KINDS: ReadonlySet<TaskActivityEventKind> = new Set([
  "lifecycle",
  "request",
  "sub_issue",
  "turn",
]);

export function TaskActivityFeed({ taskId }: TaskActivityFeedProps) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["issue", taskId, "activity"],
    queryFn: () => getTaskActivity(taskId),
    refetchInterval: 8_000,
    staleTime: 4_000,
  });

  // Keep only state-event kinds (lifecycle / request / sub-issue), then show
  // newest first — the broker returns oldest → newest for stable server-side
  // rendering, so reverse here for most-recent-on-top.
  const events = useMemo(() => {
    const list = (data?.events ?? []).filter((ev) => FEED_KINDS.has(ev.kind));
    return [...list].reverse();
  }, [data]);

  if (isLoading) {
    return (
      <div className="issue-activity-feed">
        <p className="issue-activity-feed-empty">
          <Bilingual layout="inline" en="Loading activity…" zh="正在加载活动记录…" />
        </p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="issue-activity-feed">
        <p className="issue-activity-feed-empty issue-activity-feed-empty--error">
          <Bilingual layout="inline" en="Could not load activity." zh="无法加载活动记录。" />
          <button
            type="button"
            className="issue-activity-feed-retry"
            onClick={() => void refetch()}
          >
            <Refresh width={12} height={12} aria-hidden="true" />{" "}
            <Bilingual layout="inline" en="Retry" zh="重试" />
          </button>
        </p>
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="issue-activity-feed">
        <p className="issue-activity-feed-empty">
          <Bilingual
            layout="stacked"
            en="No activity yet. Events appear here as the issue moves through its lifecycle."
            zh="暂无活动记录。随着任务状态流转，记录将显示在此处。"
          />
        </p>
      </div>
    );
  }

  return (
    <div className="issue-activity-feed" data-fetching={isFetching}>
      <ul className="issue-activity-feed-list">
        {events.map((ev) => (
          <ActivityRow key={ev.id} event={ev} />
        ))}
      </ul>
    </div>
  );
}

function ActivityRow({ event }: { event: TaskActivityEvent }) {
  const icon = iconForKind(event.kind);
  const verb = verbForEvent(event);
  const isOpenRequest =
    event.kind === "request" && event.request?.status === "open";

  const handleClick = () => {
    if (!isOpenRequest) return;
    // Open requests live in the board's "Needs human input" lane now that
    // the standalone Inbox was consolidated into /tasks.
    void router.navigate({ to: "/tasks" });
  };

  return (
    <li
      className={`issue-activity-feed-row${isOpenRequest ? " issue-activity-feed-row--clickable" : ""}`}
      onClick={isOpenRequest ? handleClick : undefined}
      onKeyDown={
        isOpenRequest
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      role={isOpenRequest ? "button" : undefined}
      tabIndex={isOpenRequest ? 0 : undefined}
    >
      <span
        className={`issue-activity-feed-icon issue-activity-feed-icon--${event.kind}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="issue-activity-feed-body">
        <div className="issue-activity-feed-row-head">
          {event.actor ? (
            <span className="issue-activity-feed-actor">@{event.actor}</span>
          ) : (
            <span className="issue-activity-feed-actor issue-activity-feed-actor--system">
              system
            </span>
          )}
          <span className="issue-activity-feed-verb">{verb}</span>
          <time className="issue-activity-feed-time">
            {formatTimestamp(event.timestamp)}
          </time>
        </div>
        {event.kind === "lifecycle" && event.lifecycle ? (
          <div className="issue-activity-feed-lifecycle">
            <span className="issue-activity-feed-state">
              {humanizeLifecycleState(event.lifecycle.from ?? "") || "—"}
            </span>
            <ArrowRight width={12} height={12} aria-hidden="true" />
            <span className="issue-activity-feed-state">
              {humanizeLifecycleState(event.lifecycle.to ?? "") || "—"}
            </span>
          </div>
        ) : null}
        <ActivitySummary event={event} />
        {event.kind === "request" && event.request ? (
          <RequestResolution req={event.request} />
        ) : null}
        {event.kind === "turn" ? (
          <TurnContextList items={event.context_used} />
        ) : null}
      </div>
    </li>
  );
}

/**
 * Render-boundary humanization (ten-out-of-ten E1): the activity feed is a
 * human surface, so raw runtime exhaust never renders verbatim. Settled
 * turn outcomes route through humanizeTurnOutcome ("signal: killed:
 * signal: killed" → an honest one-liner, v3 [18:14:10]); other summaries
 * get lifecycle enum tokens replaced with plain labels.
 */
function ActivitySummary({ event }: { event: TaskActivityEvent }) {
  const raw = event.summary?.trim() ?? "";
  if (!raw) return null;
  const text =
    event.kind === "turn" ? humanizeTurnOutcome(raw) : humanizeStateTokens(raw);
  if (!text) return null;
  return <p className="issue-activity-feed-summary">{text}</p>;
}

/**
 * B4 context transparency: the knowledge-item ids a turn's work packet
 * injected ("learning:<id>", "wiki:<ref>", ...), recorded deterministically
 * at packet-build time and surfaced under the turn's activity entry.
 */
function TurnContextList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return null;
  }
  return (
    <p className="issue-activity-feed-context">context: {items.join(", ")}</p>
  );
}

function RequestResolution({
  req,
}: {
  req: NonNullable<TaskActivityEvent["request"]>;
}) {
  if (req.status === "answered") {
    const answer =
      req.custom_text?.trim() || req.choice_text?.trim() || req.choice_id;
    return (
      <div className="issue-activity-feed-resolution issue-activity-feed-resolution--answered">
        <CheckCircle width={12} height={12} aria-hidden="true" />
        <span>
          <Bilingual
            layout="inline"
            en={`Answered: ${answer || "—"}`}
            zh={`已回答: ${answer || "—"}`}
          />
        </span>
      </div>
    );
  }
  if (req.status === "canceled") {
    return (
      <div className="issue-activity-feed-resolution issue-activity-feed-resolution--canceled">
        <Xmark width={12} height={12} aria-hidden="true" />
        <span>
          <Bilingual layout="inline" en="Canceled" zh="已取消" />
        </span>
      </div>
    );
  }
  // Open — clickable into the Tasks board (Needs human input lane).
  return (
    <div className="issue-activity-feed-resolution issue-activity-feed-resolution--open">
      <HelpCircle width={12} height={12} aria-hidden="true" />
      <span>
        <Bilingual
          layout="inline"
          en="Open — answer in Tasks →"
          zh="待处理 — 前往任务看板回答 →"
        />
      </span>
    </div>
  );
}

function iconForKind(kind: TaskActivityEventKind) {
  switch (kind) {
    case "lifecycle":
      return <ArrowRight width={14} height={14} aria-hidden="true" />;
    case "comment":
      return <ChatLines width={14} height={14} aria-hidden="true" />;
    case "request":
      return <HelpCircle width={14} height={14} aria-hidden="true" />;
    case "sub_issue":
      return <GitFork width={14} height={14} aria-hidden="true" />;
    case "turn":
      return <Refresh width={14} height={14} aria-hidden="true" />;
    default:
      // "action" and any future kinds.
      return <CheckCircle width={14} height={14} aria-hidden="true" />;
  }
}

function verbForEvent(event: TaskActivityEvent): string {
  switch (event.kind) {
    case "lifecycle":
      return "moved state · 变更了状态";
    case "comment":
      return "commented · 发表了评论";
    case "request":
      if (event.request?.status === "answered") return "request answered · 请求已回复";
      if (event.request?.status === "canceled") return "request canceled · 请求已取消";
      return "asked · 提问";
    case "sub_issue":
      return "added a sub-task · 添加了子任务";
    case "turn":
      return "ran a turn · 执行了一轮";
    default:
      // "action" and any future kinds.
      return event.summary || "took action · 执行了操作";
  }
}

function formatTimestamp(ts: string): string {
  if (!ts) return "";
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts;
  const delta = Date.now() - ms;
  const sec = Math.floor(delta / 1000);
  if (sec < 5) return "just now · 刚刚";
  if (sec < 60) return `${sec}s ago · ${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago · ${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago · ${hr}小时前`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago · ${days}天前`;
  return new Date(ms).toLocaleDateString();
}

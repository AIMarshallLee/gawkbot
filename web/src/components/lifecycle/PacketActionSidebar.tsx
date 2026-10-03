import { useCallback, useEffect, useState } from "react";

import type { DecisionPacket } from "../../lib/types/lifecycle";

interface PacketActionSidebarProps {
  packet: DecisionPacket;
  /** True during streaming/loading — disables decision actions. */
  isDecisionLocked: boolean;
  /**
   * Optional human-authored comment to attach to the decision. The
   * sidebar owns the textarea state and passes the trimmed value
   * back through these callbacks; the route reads spec.feedback on
   * the next packet fetch to render the comment in-thread.
   */
  onApprove: (comment?: string) => void;
  onRequestChanges: (comment?: string) => void;
  onDefer: (comment?: string) => void;
  onBlock: (comment?: string) => void;
  /**
   * Optional terminal-reject handler. When provided, a "Reject" button
   * appears alongside the other decision actions; pressing it posts a
   * terminal rejection (downstream dependents stay blocked, because
   * the work did not land).
   */
  onReject?: (comment: string) => void | Promise<void>;
  onOpenInWorktree: () => void;
}

/**
 * Sticky right column of the Decision Packet view. Action button
 * hierarchy is locked by /plan-design-review:
 *  - Approve:    primary CTA (cyan accent, key `a`).
 *  - Request:    secondary (bg-card + strong border, key `r`).
 *  - Defer:      quiet (transparent + border, no keybind).
 *  - Block:      tertiary danger (transparent + red-500 border, key `b`).
 *  - Worktree:   quiet (transparent + border, key `w`).
 *
 * Disabled when the packet is in `streaming` / `loading` state. A11y:
 * `role="complementary"` so the right column reads as a sidebar
 * landmark, distinct from the center reading column.
 */
export function PacketActionSidebar({
  packet,
  isDecisionLocked,
  onApprove,
  onRequestChanges,
  onDefer,
  onBlock,
  onReject,
  onOpenInWorktree,
}: PacketActionSidebarProps) {
  const [comment, setComment] = useState("");
  const trimmedComment = comment.trim();
  const submit = (callback: (comment?: string) => void) => {
    callback(trimmedComment ? trimmedComment : undefined);
    setComment("");
  };
  // submitReject defers the async call into a microtask (so any synchronous
  // throw from the caller doesn't escape this handler), and only clears the
  // textarea on success AND if the user hasn't typed something new in the
  // meantime. Failure paths log and leave the draft alone for retry.
  const submitReject = useCallback(() => {
    if (!onReject || trimmedComment.length === 0) return;
    const body = trimmedComment;
    void Promise.resolve()
      .then(() => onReject(body))
      .then(() => {
        setComment((prev) => (prev.trim() === body ? "" : prev));
      })
      .catch((err) => {
        console.error("submitReject failed", err);
      });
  }, [onReject, trimmedComment]);
  const lockedTooltip = isDecisionLocked ? "Wait for review state" : undefined;

  // Keyboard shortcut for the action this sidebar owns (Reject).
  // Approve/Request changes/Block/Worktree shortcuts are registered by
  // DecisionPacketView at the page level. Ignore key events that originate
  // inside form controls so the comment textarea remains typeable.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (isDecisionLocked) return;
      // Don't hijack Cmd/Ctrl/Alt + x — that is the OS-level cut shortcut
      // the user expects to keep working.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === "x" && onReject) {
        e.preventDefault();
        submitReject();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDecisionLocked, onReject, submitReject]);
  const runtime = packet.sessionReport?.metadata?.runtime;
  const toolCalls = packet.sessionReport?.metadata?.tool_calls;
  const ownerSummary = runtime
    ? `${packet.ownerSlug} · ran ${runtime} · 运行了 ${runtime}${
        toolCalls ? ` · ${toolCalls} tool calls · ${toolCalls} 次工具调用` : ""
      }`
    : packet.ownerSlug;

  const watchingValue = packet.reviewers
    .filter((r) => !r.isHuman)
    .map((r) => r.slug)
    .join(", ");

  return (
    <aside className="packet-right" aria-label="Decision actions">
      <h3>Decision · 决策</h3>
      <label className="packet-comment-label" htmlFor="packet-comment">
        Add a comment · 添加备注
        <span className="packet-comment-optional">optional · 可选</span>
      </label>
      <textarea
        id="packet-comment"
        className="packet-comment"
        placeholder={
          trimmedComment.length > 0
            ? ""
            : "Why are you approving / requesting changes? The bot reads this.\n说明批准或要求修改的原因，机器人将根据此反馈继续迭代。"
        }
        value={comment}
        disabled={isDecisionLocked}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
      />
      <div className="packet-actions">
        <button
          type="button"
          className="packet-action packet-action--approve"
          onClick={() => submit(onApprove)}
          disabled={isDecisionLocked}
          title={lockedTooltip ? "Wait for review state · 请等待审查状态就绪" : undefined}
        >
          Approve · 批准 <span className="kbd">a</span>
        </button>
        <button
          type="button"
          className="packet-action packet-action--secondary"
          onClick={() => submit(onRequestChanges)}
          disabled={isDecisionLocked}
          title={lockedTooltip ? "Wait for review state · 请等待审查状态就绪" : undefined}
        >
          Request changes · 要求修改 <span className="kbd">r</span>
        </button>
        <button
          type="button"
          className="packet-action packet-action--quiet"
          onClick={() => submit(onDefer)}
          disabled={isDecisionLocked}
          title={lockedTooltip ? "Wait for review state · 请等待审查状态就绪" : undefined}
        >
          Defer · 推迟
          <span className="kbd" aria-hidden="true">
            ·
          </span>
        </button>
        <button
          type="button"
          className="packet-action packet-action--danger"
          onClick={() => submit(onBlock)}
          disabled={isDecisionLocked}
          title={lockedTooltip ? "Wait for review state · 请等待审查状态就绪" : undefined}
        >
          Block · 阻止 <span className="kbd">b</span>
        </button>
        {onReject ? (
          <button
            type="button"
            className="packet-action packet-action--danger"
            onClick={submitReject}
            disabled={isDecisionLocked || trimmedComment.length === 0}
            title={
              trimmedComment.length === 0
                ? "Reject needs a reason — type one in the comment box first · 拒绝需要填写原因 — 请先在输入框中输入"
                : "Reject is terminal — downstream dependents stay blocked · 终态拒绝 — 下游依赖项将保持受阻"
            }
            data-testid="packet-reject-submit"
          >
            Reject · 拒绝 <span className="kbd">x</span>
          </button>
        ) : null}
        <button
          type="button"
          className="packet-action packet-action--quiet"
          onClick={onOpenInWorktree}
        >
          Open in worktree · 在工作区打开 <span className="kbd">w</span>
        </button>
      </div>

      <h3>Context · 上下文</h3>
      <div className="packet-aside-card">
        <div className="label">Owner bot · 负责机器人</div>
        <div className="value">{ownerSummary}</div>
      </div>
      <div className="packet-aside-card">
        <div className="label">Worktree · 工作区</div>
        <div className="value">
          <code>{packet.worktreePath}</code>
        </div>
      </div>
      {watchingValue ? (
        <div className="packet-aside-card">
          <div className="label">Watching · 协同关注</div>
          <div className="value">{watchingValue}</div>
        </div>
      ) : null}
      {packet.dependencies.blockedOn.length > 0 ? (
        <div className="packet-aside-card">
          <div className="label">Blocked on · 阻塞于</div>
          <div className="value" style={{ color: "var(--warning-500)" }}>
            {packet.dependencies.blockedOn.join(", ")} · waiting merge · 等待合并
          </div>
        </div>
      ) : null}
    </aside>
  );
}

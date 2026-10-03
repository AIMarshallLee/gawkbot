import type { GovernorReason, GovernorStatus } from "../../api/governor";
import { bilingual } from "../../lib/bilingual";

/** "152k" / "980" — compact token count for chips and banners. */
export function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${Math.round(n / 1000)}k`;
  }
  return `${Math.max(0, Math.round(n))}`;
}

/** "$2.10" — cost with two decimals; "$0.00" when unknown. */
export function formatCost(n: number): string {
  return `$${Math.max(0, n).toFixed(2)}`;
}

/** One-line reason headline for the paused banner. */
export function reasonHeadline(reason: GovernorReason): string {
  switch (reason) {
    case "budget":
      return bilingual("Budget checkpoint", "预算检查点");
    case "turns":
      return bilingual("Review checkpoint", "审查检查点");
    case "stop":
      return bilingual("Stopped", "已停止");
    case "manual":
      return bilingual("Paused", "已暂停");
    default:
      return bilingual("Paused", "已暂停");
  }
}

/** Human sentence describing what tripped the pause. */
export function reasonDetail(status: GovernorStatus): string {
  const tokens = formatTokens(status.tokensSinceCheckpoint);
  const cost = formatCost(status.costSinceCheckpoint);
  const turns = status.turnsSinceCheckpoint;
  switch (status.reason) {
    case "budget":
      return bilingual(
        `The team has used ${tokens} tokens (${cost}) since the last checkpoint. Review the work, then continue or stop.`,
        `团队自上次检查点已使用 ${tokens} 个令牌（${cost}）。请审查工作后继续或停止。`,
      );
    case "turns":
      return bilingual(
        `The team has run ${turns} turns without a human in the loop. Review the work, then continue or stop.`,
        `团队在无人介入时已运行 ${turns} 轮。请审查工作后继续或停止。`,
      );
    case "stop":
      return bilingual("In-flight work was cancelled. Resume when you are ready.", "进行中的工作已取消。准备好后可恢复。");
    default:
      return bilingual("Dispatch is paused. Review the work, then continue or stop.", "调度已暂停。请审查工作后继续或停止。");
  }
}

/** Compact "12 turns · 152k tok · $2.10" meter for the status bar. */
export function meterSummary(status: GovernorStatus): string {
  const turns = status.turnsSinceCheckpoint;
  const tokens = formatTokens(status.tokensSinceCheckpoint);
  const cost = formatCost(status.costSinceCheckpoint);
  return bilingual(
    `${turns} ${turns === 1 ? "turn" : "turns"} · ${tokens} tok · ${cost}`,
    `${turns} 轮 · ${tokens} 个令牌 · ${cost}`,
  );
}

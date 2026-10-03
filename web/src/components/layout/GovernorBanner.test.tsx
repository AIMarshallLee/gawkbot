import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GovernorStatus } from "../../api/governor";
import { GovernorBannerView } from "./GovernorBanner";
import { GovernorControlView } from "./GovernorControl";

function status(overrides: Partial<GovernorStatus> = {}): GovernorStatus {
  return {
    paused: true,
    reason: "budget",
    turnsSinceCheckpoint: 12,
    tokensSinceCheckpoint: 152_000,
    costSinceCheckpoint: 2.1,
    maxTokens: 150_000,
    maxCostUsd: 3,
    maxTurns: 12,
    disabled: false,
    ...overrides,
  };
}

describe("<GovernorBannerView>", () => {
  it("shows the budget reason and spend since checkpoint", () => {
    render(
      <GovernorBannerView
        status={status()}
        busy={false}
        onResume={vi.fn()}
        onResumeMore={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Budget checkpoint · 预算检查点")).toBeTruthy();
    expect(screen.getByText(/152k tokens/)).toBeTruthy();
    expect(screen.getByText(/\$2\.10/)).toBeTruthy();
  });

  it("fires resume / resume_more / stop from the three buttons", () => {
    const onResume = vi.fn();
    const onResumeMore = vi.fn();
    const onStop = vi.fn();
    render(
      <GovernorBannerView
        status={status()}
        busy={false}
        onResume={onResume}
        onResumeMore={onResumeMore}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByText("Continue · 继续"));
    fireEvent.click(screen.getByText("Continue +budget · 继续并增加预算"));
    fireEvent.click(screen.getByText("Stop · 停止"));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onResumeMore).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("hides Continue +budget for a turn-count checkpoint", () => {
    render(
      <GovernorBannerView
        status={status({ reason: "turns" })}
        busy={false}
        onResume={vi.fn()}
        onResumeMore={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Review checkpoint · 审查检查点")).toBeTruthy();
    expect(screen.queryByText("Continue +budget · 继续并增加预算")).toBeNull();
    expect(screen.getByText("Continue · 继续")).toBeTruthy();
    expect(screen.getByText("Stop · 停止")).toBeTruthy();
  });

  it("renders a manual pause with Continue and Stop but no budget bump", () => {
    render(
      <GovernorBannerView
        status={status({ reason: "manual" })}
        busy={false}
        onResume={vi.fn()}
        onResumeMore={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Paused · 已暂停")).toBeTruthy();
    expect(screen.queryByText("Continue +budget · 继续并增加预算")).toBeNull();
  });

  it("collapses to a single Resume action once stopped", () => {
    render(
      <GovernorBannerView
        status={status({ reason: "stop" })}
        busy={false}
        onResume={vi.fn()}
        onResumeMore={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Resume · 恢复")).toBeTruthy();
    expect(screen.queryByText("Continue +budget · 继续并增加预算")).toBeNull();
    expect(screen.queryByText("Stop · 停止")).toBeNull();
  });

  it("disables actions while a command is in flight", () => {
    render(
      <GovernorBannerView
        status={status()}
        busy={true}
        onResume={vi.fn()}
        onResumeMore={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Continue · 继续").closest("button")?.disabled).toBe(true);
  });
});

describe("<GovernorControlView>", () => {
  it("renders the live meter and fires pause / stop", () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    render(
      <GovernorControlView
        status={status({ paused: false, reason: "" })}
        busy={false}
        showMeter={true}
        onPause={onPause}
        onStop={onStop}
      />,
    );
    expect(screen.getByText(/12 turns · 152k tok · \$2\.10 · 12 轮 · 152k 个令牌 · \$2\.10/)).toBeTruthy();
    fireEvent.click(screen.getByText("Pause · 暂停"));
    fireEvent.click(screen.getByText("Stop · 停止"));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("hides the meter but keeps Pause/Stop when checkpoints are disabled", () => {
    render(
      <GovernorControlView
        status={status({ paused: false, reason: "", disabled: true })}
        busy={false}
        showMeter={false}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.queryByText(/turns ·/)).toBeNull();
    expect(screen.getByText("Pause · 暂停")).toBeTruthy();
    expect(screen.getByText("Stop · 停止")).toBeTruthy();
  });
});

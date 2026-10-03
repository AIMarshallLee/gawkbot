import {
  Building,
  Key,
  Lock,
  MediaImage,
  Puzzle,
  Settings as SettingsIcon,
  Terminal,
  Timer,
  WarningTriangle,
} from "iconoir-react";

import type { SectionGroup } from "./types";

// Sidebar nav grouping. The order here is the user-facing order in the
// settings shell. Adding a new section means adding a row to the right
// group + an entry in SectionId in types.ts + a `case` in SettingsApp's
// section switch.
export const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Workspace · 工作区",
    items: [
      { id: "general", Icon: SettingsIcon, name: "General · 常规" },
      { id: "local-llms", Icon: Terminal, name: "Local LLMs · 本地 LLM" },
      { id: "image-gen", Icon: MediaImage, name: "Image generation · 图像生成" },
      { id: "company", Icon: Building, name: "Company · 公司信息" },
    ],
  },
  {
    label: "Credentials · 凭据",
    items: [
      { id: "keys", Icon: Key, name: "API Keys · API 密钥" },
      { id: "integrations", Icon: Puzzle, name: "Integrations · 集成" },
    ],
  },
  {
    label: "System · 系统",
    items: [
      { id: "intervals", Icon: Timer, name: "Polling · 轮询" },
      { id: "flags", Icon: Terminal, name: "CLI Flags · CLI 参数" },
      { id: "privacy", Icon: Lock, name: "Privacy & Analytics · 隐私与分析" },
    ],
  },
  {
    label: "Advanced · 高级",
    items: [{ id: "danger", Icon: WarningTriangle, name: "Danger Zone · 危险操作" }],
  },
];

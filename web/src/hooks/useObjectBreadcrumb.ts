/**
 * useObjectBreadcrumb — derives a typed ObjectRef + resolved route from the
 * current URL-driven route shape. Returns null for route kinds that don't
 * map to a discrete object (channels, "unknown").
 *
 * Phase 5 PR 2 — app navigation refresh.
 */

import {
  type ObjectRouteResolution,
  resolveObjectRoute,
} from "../lib/objectRoutes";
import type { CurrentRoute } from "../routes/useCurrentRoute";
import { bilingual } from "../lib/bilingual";

export interface BreadcrumbItem {
  /** User-visible label. */
  label: string;
  /** Canonical deep-link href (hash URL). */
  href: string;
}

/**
 * Derive up to two breadcrumb segments from the current route:
 *   [section, object]
 * e.g. ["Wiki", "Wiki: people/nazz"] or ["Bots", "Bot: gaia"].
 *
 * Returns an empty array for conversation routes (channels) and unknown.
 * Pure function so tests can call it without a React context.
 */
export function deriveBreadcrumbs(
  route: CurrentRoute,
  /** Resolved display name for a custom app, when the caller has the apps
   *  list. Without it the generic-app branch falls back to title-casing the
   *  record id, which surfaced as "App_ad2f6211ad746d37" in the header.
   *  Optional so this stays callable from tests with no React context. */
  customAppName?: string,
): BreadcrumbItem[] {
  switch (route.kind) {
    case "task-board": {
      return [{ label: bilingual("Tasks", "任务"), href: "#/tasks" }];
    }
    case "task-detail": {
      const res = resolveObjectRoute({ kind: "task", id: route.taskId });
      return [
        { label: bilingual("Tasks", "任务"), href: "#/tasks" },
        breadcrumbItem(res, `Task ${route.taskId}`),
      ];
    }
    case "wiki": {
      return [{ label: bilingual("Wiki", "知识库"), href: "#/wiki" }];
    }
    case "wiki-article": {
      const res = resolveObjectRoute({
        kind: "wiki-page",
        path: route.articlePath,
      });
      return [
        { label: bilingual("Wiki", "知识库"), href: "#/wiki" },
        breadcrumbItem(res, route.articlePath),
      ];
    }
    case "wiki-lookup": {
      return [{ label: bilingual("Wiki", "知识库"), href: "#/wiki" }];
    }
    case "article": {
      return [{ label: "Article", href: `#/articles/${route.articleId}` }];
    }
    case "app": {
      if (route.appId === "settings" || isSettingsSection(route.appId)) {
        const section = route.appId === "settings" ? "workspace" : route.appId;
        const res = resolveObjectRoute({
          kind: "settings-section",
          section: section as "providers" | "team" | "workspace" | "skills",
        });
        return [
          {
            label:
              route.appId === "settings"
                ? "Settings · 设置"
                : res.fallback
                  ? appLabel(route.appId)
                  : res.label,
            href: res.href,
          },
        ];
      }
      // Generic app — one segment with the app title. Prefer the real name
      // when the caller resolved it; appLabel only title-cases the id.
      return [
        {
          label: customAppName?.trim() || appLabel(route.appId),
          href: `#/apps/${encodeURIComponent(route.appId)}`,
        },
      ];
    }
    case "inbox": {
      return [{ label: "Inbox", href: "#/inbox" }];
    }
    case "task-decision": {
      return [
        { label: "Inbox", href: "#/inbox" },
        {
          label: route.taskId,
          href: `#/task/${encodeURIComponent(route.taskId)}`,
        },
      ];
    }
    case "channel":
      return [];
    // Tasks surface breadcrumbs
    case "task-new":
      return [
        { label: bilingual("Tasks", "任务"), href: "#/tasks" },
        { label: bilingual("New task", "新建任务"), href: "#/tasks/new" },
      ];
    case "agents":
      return [{ label: bilingual("Bots", "机器人"), href: "#/agents" }];
    case "bot-detail": {
      const res = resolveObjectRoute({ kind: "agent", slug: route.agentSlug });
      return [
        { label: bilingual("Bots", "机器人"), href: "#/agents" },
        breadcrumbItem(res, `@${route.agentSlug}`),
      ];
    }
    case "skill-detail":
      return [
        { label: bilingual("Skills", "技能"), href: "#/apps/skills" },
        {
          label: route.skillName,
          href: `#/skills/${encodeURIComponent(route.skillName)}`,
        },
      ];
    case "routine-detail":
      return [
        { label: bilingual("Scheduled Tasks", "定时任务"), href: "#/apps/routines" },
        {
          label: route.routineSlug,
          href: `#/routines/${encodeURIComponent(route.routineSlug)}`,
        },
      ];
    case "routine-new":
      return [
        { label: bilingual("Scheduled Tasks", "定时任务"), href: "#/apps/routines" },
        { label: bilingual("New scheduled task", "新建定时任务"), href: "#/routines/new" },
      ];
    case "home":
      return [];
    case "unknown":
      return [];
    default: {
      const _exhaustive: never = route;
      void _exhaustive;
      return [];
    }
  }
}

function breadcrumbItem(
  res: ObjectRouteResolution,
  fallbackLabel: string,
): BreadcrumbItem {
  return { label: res.fallback ? fallbackLabel : res.label, href: res.href };
}

/** Map an app id to a friendly label without importing SIDEBAR_APPS. */
function appLabel(appId: string): string {
  const LABELS: Record<string, string> = {
    tasks: "Tasks · 任务",
    requests: "Requests · 请求",
    graph: "Graph · 知识图谱",
    policies: "Policies · 策略",
    routines: "Routines · 定时任务",
    skills: "Skills · 技能",
    activity: "Dashboard · 仪表盘",
    integrations: "Integrations · 集成",
    "health-check": "Access & Health · 访问与健康检查",
  };
  return (
    LABELS[appId] ??
    appId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

type SettingsSection = "providers" | "team" | "workspace" | "skills";
const SETTINGS_SECTIONS = new Set<string>([
  "providers",
  "team",
  "workspace",
  "skills",
]);
function isSettingsSection(v: string): v is SettingsSection {
  return SETTINGS_SECTIONS.has(v);
}

// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrop uses pointer hit-testing while dialog controls retain keyboard handling.
// biome-ignore-all lint/a11y/useKeyWithClickEvents: Backdrop pointer dismissal is paired with a window Escape listener while the modal is open.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  generateBot,
  getConfig,
  getLocalProvidersStatus,
  type LLMRuntimeKind,
  type LocalProviderStatus,
  post,
} from "../../api/client";
import { useWindowEscape } from "../../hooks/useWindowEscape";
import { track } from "../../lib/analytics";
import {
  CUSTOM_MODEL_VALUE,
  INHERIT_MODEL_VALUE,
  isCatalogModel,
  modelOptionsForKind,
} from "../../lib/modelCatalog";
import { Bilingual } from "../ui/Bilingual";

// "inherit" is the wizard-only sentinel that maps to an absent ProviderBinding
// in the POST body (the broker then falls back to the install-wide default at
// dispatch time). Gateway kinds (openclaw / hermes-bot) are deliberately
// absent — bots bound to a gateway are imported through the Integrations
// app, not created in this wizard.
type ProviderChoice = "inherit" | LLMRuntimeKind;
type WizardMode = "describe" | "manual";

interface BotFormData {
  name: string;
  slug: string;
  role: string;
  emoji: string;
  provider: ProviderChoice;
  model: string;
  expertise: string;
  soul: string;
}

const INITIAL_FORM: BotFormData = {
  name: "",
  slug: "",
  role: "",
  emoji: "",
  provider: "inherit",
  model: "",
  expertise: "",
  soul: "",
};

// Human-readable labels for the runtime picker. Kinds the broker hasn't
// registered are skipped at render time, so missing labels here aren't fatal —
// they just fall back to the raw kind string.
const PROVIDER_LABELS: Record<LLMRuntimeKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "Opencode",
  antigravity: "Antigravity · Google 会员",
  "antigravity-2": "Antigravity 备用 · Google 会员 2号",
  custom: "Custom API · 自定义模型",
  "mlx-lm": "MLX-LM",
  ollama: "Ollama",
  exo: "Exo",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface BotWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const AGENT_WIZARD_DIALOG_PROPS = {
  role: "dialog",
  "aria-modal": true,
  "aria-labelledby": "bot-wizard-title",
} as const;

// WizardModelPicker mirrors BotProfilePanel's ModelPicker — curated catalog
// dropdown plus a "Custom…" escape hatch for power users. The wizard's
// "Inherit default" provider state disables the picker entirely; the field is
// re-enabled when the user picks a specific runtime.
function WizardModelPicker({
  providerKind,
  value,
  disabled,
  onChange,
  localStatuses,
}: {
  providerKind: LLMRuntimeKind | "";
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
  localStatuses: LocalProviderStatus[];
}) {
  const options = modelOptionsForKind(providerKind, localStatuses);
  const valueIsCatalog = isCatalogModel(providerKind, value, localStatuses);
  const [customMode, setCustomMode] = useState(!valueIsCatalog && value !== "");
  // Re-sync custom mode when the runtime kind switches under us.
  // Without this, picking a different runtime after entering a custom
  // model leaves the dropdown stuck in custom mode against the new
  // catalog (or vice versa).
  useEffect(() => {
    const shouldBeCustom =
      !isCatalogModel(providerKind, value, localStatuses) && value !== "";
    setCustomMode(shouldBeCustom);
  }, [providerKind, value, localStatuses]);
  // useRef-driven focus into the custom input. Matches the
  // BotProfilePanel ModelPicker pattern: biome forbids the JSX
  // autoFocus attribute but the imperative form is sanctioned and the
  // immediate-focus UX is load-bearing after picking Custom….
  const customInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (customMode) customInputRef.current?.focus();
  }, [customMode]);
  const selectValue =
    customMode || !valueIsCatalog
      ? CUSTOM_MODEL_VALUE
      : value || INHERIT_MODEL_VALUE;
  return (
    <div style={{ display: "flex", gap: 6, width: "100%" }}>
      <select
        id="bot-model"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM_MODEL_VALUE) {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
        style={{ flex: customMode ? "0 0 160px" : 1 }}
      >
        {options.map((o) => (
          <option key={o.value || "default"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {customMode && (
        <input
          ref={customInputRef}
          className="input"
          type="text"
          placeholder="e.g. claude-opus-4-7"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            flex: 1,
          }}
          aria-label="Custom model id"
        />
      )}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing cognitive complexity is baselined for a focused follow-up refactor.
export function BotWizard({ open, onClose, onCreated }: BotWizardProps) {
  const [mode, setMode] = useState<WizardMode>("describe");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<BotFormData>(INITIAL_FORM);
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Pull the registered runtime list off the wire so the picker stays in sync
  // with whatever providers the Go layer has registered. Falls back to a
  // hardcoded core set on first paint / fetch failure so the wizard is
  // usable even when /config is briefly unavailable.
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    enabled: open,
    staleTime: 30_000,
  });
  const localStatusQuery = useQuery({
    queryKey: ["local-providers-status"],
    queryFn: getLocalProvidersStatus,
    enabled: open,
    staleTime: 30_000,
  });
  const localStatuses: LocalProviderStatus[] = localStatusQuery.data ?? [];
  const llmKinds: LLMRuntimeKind[] = (configQuery.data?.llm_provider_kinds ?? [
    "claude-code",
    "codex",
    "opencode",
    "mlx-lm",
    "ollama",
    "exo",
  ]) as LLMRuntimeKind[];

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Describe the bot you want first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const tmpl = await generateBot(trimmed);
      const generatedSlug = tmpl.slug || "";
      // The CEO-side generator may suggest a runtime/model pair. Only
      // honor it when the suggested provider is one we'd surface in the
      // picker (i.e. a non-gateway registered kind) — gateway kinds must
      // come in through the Integrations app, never through the wizard.
      const suggestedProvider = tmpl.provider as LLMRuntimeKind | undefined;
      const providerInList =
        suggestedProvider && llmKinds.includes(suggestedProvider);
      setForm({
        name: tmpl.name || "",
        slug: generatedSlug,
        role: tmpl.role || "",
        emoji: tmpl.emoji || "",
        provider: providerInList ? suggestedProvider : "inherit",
        model: tmpl.model || "",
        expertise: (tmpl.expertise || []).join(", "),
        soul: tmpl.personality || "",
      });
      setSlugEdited(generatedSlug.length > 0);
      setMode("manual");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
    } finally {
      setGenerating(false);
    }
  }

  const updateField = useCallback(
    <K extends keyof BotFormData>(field: K, value: BotFormData[K]) => {
      setForm((prev) => {
        const next = { ...prev, [field]: value };
        if (field === "name" && !slugEdited) {
          next.slug = slugify(value as string);
        }
        return next;
      });
      setError(null);
    },
    [slugEdited],
  );

  const expertiseTags = useMemo(() => {
    return form.expertise
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [form.expertise]);

  const canSubmit = form.name.trim().length > 0 && form.slug.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      // Encode provider as an explicit binding only when the user picked a
      // specific runtime. "inherit" sends an absent provider field so the
      // broker leaves Provider zero-valued; the dispatch resolver then
      // falls back to the install-wide default at turn time.
      const trimmedModel = form.model.trim();
      const providerBody =
        form.provider === "inherit"
          ? undefined
          : trimmedModel
            ? { kind: form.provider, model: trimmedModel }
            : { kind: form.provider };
      const body = {
        action: "create",
        slug: form.slug,
        name: form.name,
        role: form.role || undefined,
        emoji: form.emoji || undefined,
        provider: providerBody,
        expertise: expertiseTags.length > 0 ? expertiseTags : undefined,
        // The soul/personality seeds the bot's SOUL.md (its persona, voice,
        // and boundaries) — the file the broker loads into the system prompt.
        personality: form.soul.trim() || undefined,
      };

      await post("/office-members", body);
      track("agent_created", { source: "wizard", from_blueprint: false });
      await queryClient.invalidateQueries({ queryKey: ["office-members"] });

      setForm(INITIAL_FORM);
      setSlugEdited(false);
      onCreated?.();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create bot";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const handleCancel = useCallback(() => {
    if (generating || submitting) return;
    setForm(INITIAL_FORM);
    setSlugEdited(false);
    setError(null);
    setMode("describe");
    setPrompt("");
    onClose();
  }, [generating, onClose, submitting]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }

  useWindowEscape(open, handleCancel);

  if (!open) return null;

  return (
    <div
      className="bot-wizard-overlay"
      role="presentation"
      onClick={handleOverlayClick}
    >
      <div className="bot-wizard-modal card" {...AGENT_WIZARD_DIALOG_PROPS}>
        <div className="bot-wizard-title" id="bot-wizard-title">
          <Bilingual layout="inline" en="Create bot" zh="创建机器人" />
        </div>

        {/* Mode toggle */}
        <div className="channel-wizard-tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            aria-label="Describe"
            className={`channel-wizard-tab${mode === "describe" ? " active" : ""}`}
            onClick={() => {
              setMode("describe");
              setError(null);
            }}
          >
            <Bilingual layout="inline" en="Describe" zh="描述创建" />
          </button>
          <button
            type="button"
            aria-label="Manual"
            className={`channel-wizard-tab${mode === "manual" ? " active" : ""}`}
            onClick={() => {
              setMode("manual");
              setError(null);
            }}
          >
            <Bilingual layout="inline" en="Manual" zh="手动配置" />
          </button>
        </div>

        {mode === "describe" ? (
          <div className="bot-wizard-form">
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-prompt">
                <Bilingual layout="inline" en="Describe the bot you want" zh="描述你需要的机器人" />
              </label>
              <textarea
                id="bot-prompt"
                className="input"
                placeholder='e.g. "A DevOps engineer who manages CI/CD and infrastructure" · 例如：“负责管理 CI/CD 与基础设施的运维工程师”'
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setError(null);
                }}
                rows={3}
                style={{
                  minHeight: 80,
                  resize: "vertical",
                  padding: "10px 12px",
                  lineHeight: 1.5,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  marginTop: 6,
                  display: "block",
                }}
              >
                <Bilingual
                  layout="stacked"
                  en="AI will draft a slug, name, role, expertise, and personality. You can edit before creating."
                  zh="AI 将自动起草标识、名称、职责、专长和人设。创建前你均可再次调整。"
                />
              </span>
            </div>

            {error ? <div className="bot-wizard-error">{error}</div> : null}

            <div className="bot-wizard-footer">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleCancel}
                disabled={generating}
              >
                <Bilingual layout="inline" en="Cancel" zh="取消" />
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
              >
                {generating ? "Generating… · 正在生成…" : <Bilingual layout="inline" en="Generate" zh="AI 生成" />}
              </button>
            </div>
          </div>
        ) : (
          <form className="bot-wizard-form" onSubmit={handleSubmit}>
            {/* Name */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-name">
                <Bilingual layout="inline" en="Name" zh="名称" />
              </label>
              <input
                id="bot-name"
                aria-label="Name"
                className="input"
                type="text"
                placeholder="e.g. Sales Rep · 例如：销售代表"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>

            {/* Slug */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-slug">
                <Bilingual layout="inline" en="Slug" zh="唯一标识 (Slug)" />
              </label>
              <input
                id="bot-slug"
                aria-label="Slug"
                className="input"
                type="text"
                placeholder="auto-generated-from-name · 随名称自动生成"
                value={form.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  updateField("slug", e.target.value);
                }}
              />
            </div>

            {/* Role */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-role">
                <Bilingual layout="inline" en="Role" zh="职责角色" />
              </label>
              <input
                id="bot-role"
                aria-label="Role"
                className="input"
                type="text"
                placeholder="e.g. SDR, Engineer, Support · 例如：开发工程师、客服"
                value={form.role}
                onChange={(e) => updateField("role", e.target.value)}
              />
            </div>

            {/* Soul / personality — seeds SOUL.md */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-soul">
                <Bilingual layout="inline" en="Soul" zh="人设性格 (Soul)" />{" "}
                <span
                  style={{ fontWeight: 400, color: "var(--text-tertiary)" }}
                >
                  (personality, voice, boundaries — optional · 性格、语气与行为边界 — 可选)
                </span>
              </label>
              <textarea
                id="bot-soul"
                aria-label="Soul"
                className="input"
                placeholder="e.g. Relentless about pipeline, allergic to vanity metrics. Direct, never fluffy. · 例如：专注实际产出，拒绝华而不实。直接、严谨。"
                value={form.soul}
                onChange={(e) => updateField("soul", e.target.value)}
                rows={3}
                style={{
                  minHeight: 72,
                  resize: "vertical",
                  padding: "10px 12px",
                  lineHeight: 1.5,
                }}
              />
              <span className="op-hint">
                <Bilingual
                  layout="stacked"
                  en="Seeds this agent's SOUL.md — the persona loaded into its system prompt. You can refine it (and the other instruction files) anytime from the agent's profile."
                  zh="预置此机器人的 SOUL.md — 作为系统提示词加载的人设核心。创建后可随时在其专属档案中调整。"
                />
              </span>
            </div>

            {/* Emoji */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-emoji">
                <Bilingual layout="inline" en="Emoji" zh="图标 Emoji" />
              </label>
              <input
                id="bot-emoji"
                aria-label="Emoji"
                className="input"
                type="text"
                placeholder="🤖"
                value={form.emoji}
                onChange={(e) => updateField("emoji", e.target.value)}
                maxLength={4}
                style={{ width: 80 }}
              />
            </div>

            {/* Provider + Model */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-provider">
                <Bilingual layout="inline" en="Runtime" zh="运行时引擎" />
              </label>
              <select
                id="bot-provider"
                aria-label="Runtime"
                value={form.provider}
                onChange={(e) =>
                  updateField("provider", e.target.value as ProviderChoice)
                }
              >
                <option value="inherit">
                  Inherit default (
                  {configQuery.data?.llm_provider ?? "claude-code"}) · 继承默认
                </option>
                {llmKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {PROVIDER_LABELS[kind] ?? kind}
                  </option>
                ))}
              </select>
              {form.provider === "inherit" ? (
                <span className="op-hint">
                  <Bilingual
                    layout="stacked"
                    en="Inherits the install default. Pick a specific runtime to pin this agent — you can also change it later from the agent's profile."
                    zh="继承全局默认配置。选择特定运行时可锁定该机器人 — 稍后也可随时在其档案中更改。"
                  />
                </span>
              ) : (
                <span className="op-hint">
                  <Bilingual
                    layout="stacked"
                    en={`This bot will run on ${PROVIDER_LABELS[form.provider] ?? form.provider} on every turn. Change anytime from the agent's profile.`}
                    zh={`该机器人每轮执行都将使用 ${PROVIDER_LABELS[form.provider] ?? form.provider}。可随时在档案中更改。`}
                  />
                </span>
              )}
            </div>
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-model">
                <Bilingual layout="inline" en="Model" zh="模型" />{" "}
                <span
                  style={{ fontWeight: 400, color: "var(--text-tertiary)" }}
                >
                  (optional · 可选)
                </span>
              </label>
              <WizardModelPicker
                providerKind={form.provider === "inherit" ? "" : form.provider}
                value={form.model}
                disabled={form.provider === "inherit"}
                onChange={(next) => updateField("model", next)}
                localStatuses={localStatuses}
              />
              <span className="op-hint">
                <Bilingual
                  layout="stacked"
                  en="Pick from common models for the chosen runtime, or use &quot;Custom…&quot; to type any model id. Leave on &quot;Use runtime default&quot; to let the runtime decide."
                  zh="为所选运行时选择常用模型，或使用“自定义…”输入任意模型标识。留空则使用运行时默认配置。"
                />
              </span>
            </div>

            {/* Expertise */}
            <div className="bot-wizard-field">
              <label className="label" htmlFor="bot-expertise">
                <Bilingual layout="inline" en="Expertise" zh="专长领域" />{" "}
                <span
                  style={{ fontWeight: 400, color: "var(--text-tertiary)" }}
                >
                  (comma-separated · 逗号分隔)
                </span>
              </label>
              <input
                id="bot-expertise"
                aria-label="Expertise"
                className="input"
                type="text"
                placeholder="e.g. outreach, cold email, pipeline · 例如：后端开发, 性能调优"
                value={form.expertise}
                onChange={(e) => updateField("expertise", e.target.value)}
              />
              {expertiseTags.length > 0 && (
                <div className="bot-panel-tags" style={{ marginTop: 6 }}>
                  {expertiseTags.map((tag) => (
                    <span key={tag} className="bot-panel-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error ? <div className="bot-wizard-error">{error}</div> : null}

            {/* Footer */}
            <div className="bot-wizard-footer">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleCancel}
                disabled={submitting}
              >
                <Bilingual layout="inline" en="Cancel" zh="取消" />
              </button>
              <button
                type="submit"
                aria-label="Create"
                className="btn btn-primary btn-sm"
                disabled={!canSubmit || submitting}
              >
                {submitting ? "Creating… · 正在创建…" : <Bilingual layout="inline" en="Create" zh="创建机器人" />}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to manage wizard open/close state from any component.
 * Usage:
 *   const { open, show, hide } = useBotWizard()
 *   <button onClick={show}>New Bot</button>
 *   <BotWizard open={open} onClose={hide} />
 */
export function useBotWizard() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, show, hide };
}

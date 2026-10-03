import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

import { useInlineArtifacts } from "../../hooks/useInlineArtifacts";
import {
  messageMarkdownComponents,
  messageRemarkPlugins,
} from "../../lib/messageMarkdown";
import { keyedByOccurrence } from "../../lib/reactKeys";
import { stripStandaloneRichArtifactReferenceLines } from "../../lib/richArtifactReferences";
import RichArtifactEmbed from "../rich-artifacts/RichArtifactEmbed";
import { TranslateButton } from "../ui/TranslateButton";

// ── Linear-style description ──────────────────────────────────────────

interface TaskDescriptionProps {
  description: string;
  isDrafting: boolean;
}

export function TaskDescription({
  description,
  isDrafting,
}: TaskDescriptionProps) {
  const [translatedBody, setTranslatedBody] = useState<string | null>(null);
  const body = description.trim();
  const inlineArtifacts = useInlineArtifacts(body || null);
  const renderedBody = useMemo(
    () => stripStandaloneRichArtifactReferenceLines(body),
    [body],
  );
  const hasMarkdown = renderedBody.length > 0;
  const hasArtifacts = inlineArtifacts.length > 0;

  if (!(body && (hasMarkdown || hasArtifacts))) {
    return (
      <section
        className="issue-doc-description issue-doc-description--empty"
        aria-label="Description"
      >
        <p className="issue-doc-description-empty-line">
          {isDrafting
            ? "暂无任务描述 (No description yet. Add one in chat — the scoping conversation firms it up.)"
            : "暂无描述 · No description."}
        </p>
      </section>
    );
  }

  const activeMarkdown = translatedBody ?? renderedBody;

  return (
    <section className="issue-doc-description" aria-label="Description">
      {hasMarkdown ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <TranslateButton
            originalText={renderedBody}
            onToggle={(isZh, text) => setTranslatedBody(isZh ? text : null)}
          />
        </div>
      ) : null}
      <div
        className="issue-doc-description-body"
        data-testid="issue-doc-description-body"
      >
        {keyedByOccurrence(inlineArtifacts, (detail) => detail.artifact.id).map(
          ({ key, value: detail }) => (
            <RichArtifactEmbed
              key={key}
              title={detail.artifact.title}
              html={detail.html}
            />
          ),
        )}
        {hasMarkdown ? (
          <ReactMarkdown
            remarkPlugins={messageRemarkPlugins}
            components={messageMarkdownComponents}
          >
            {activeMarkdown}
          </ReactMarkdown>
        ) : null}
      </div>
    </section>
  );
}

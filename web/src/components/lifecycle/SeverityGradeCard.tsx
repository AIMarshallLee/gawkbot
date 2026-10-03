import { type CSSProperties, useState } from "react";

import { formatRelativeTime } from "../../lib/format";
import { type ReviewerGrade, SEVERITY_TOKENS } from "../../lib/types/lifecycle";
import { Bilingual } from "../ui/Bilingual";
import { TranslateButton } from "../ui/TranslateButton";

const SEVERITY_ZH: Record<string, string> = {
  critical: "严重缺陷",
  major: "重要问题",
  minor: "次要细节",
  nitpick: "优化建议",
  skipped: "已跳过",
};

interface SeverityGradeCardProps {
  grade: ReviewerGrade;
}

export function SeverityGradeCard({ grade }: SeverityGradeCardProps) {
  const [translatedSugg, setTranslatedSugg] = useState<string | null>(null);
  const [translatedReason, setTranslatedReason] = useState<string | null>(null);

  const tokens = SEVERITY_TOKENS[grade.severity];
  const containerStyle: CSSProperties = {
    borderLeftColor: tokens.border,
    background: tokens.bg,
  };
  const pillStyle: CSSProperties = {
    background: tokens.pillBg,
    color: tokens.pillText,
  };
  const submittedAt = formatRelativeTime(grade.submittedAt);

  const textToTranslate = [
    grade.suggestion ? `建议: ${grade.suggestion}` : "",
    grade.reasoning ? `理由: ${grade.reasoning}` : "",
  ].filter(Boolean).join("\n");

  const handleTranslate = (isZh: boolean, text: string) => {
    if (!isZh) {
      setTranslatedSugg(null);
      setTranslatedReason(null);
      return;
    }
    const lines = text.split("\n");
    const s = lines.find((l) => l.startsWith("建议:"))?.replace(/^建议:\s*/, "") || grade.suggestion;
    const r = lines.find((l) => l.startsWith("理由:"))?.replace(/^理由:\s*/, "") || grade.reasoning;
    setTranslatedSugg(s);
    setTranslatedReason(r);
  };

  const displaySugg = translatedSugg ?? grade.suggestion;
  const displayReason = translatedReason ?? grade.reasoning;

  return (
    <article
      className={`packet-grade ${grade.severity === "skipped" ? "skipped" : ""}`}
      style={containerStyle}
      data-severity={grade.severity}
      aria-label={`${tokens.label} grade from ${grade.reviewerSlug}`}
    >
      <span className="sev-pill" style={pillStyle}>
        <Bilingual
          en={tokens.label}
          zh={SEVERITY_ZH[grade.severity] ?? tokens.label}
          layout="inline"
        />
      </span>
      <div className="body">
        <div className="sugg">{displaySugg}</div>
        <div className="reason">{displayReason}</div>
        {grade.filePath ? (
          <div className="file">
            {grade.filePath}
            {grade.line ? `:${grade.line}` : ""}
          </div>
        ) : null}
      </div>
      <div className="reviewer">
        {grade.suggestion ? (
          <div style={{ marginBottom: 4 }}>
            <TranslateButton
              originalText={textToTranslate}
              onToggle={handleTranslate}
              label="🌐 翻译审查意见"
            />
          </div>
        ) : null}
        {grade.reviewerSlug}
        <br />
        {grade.severity === "skipped" ? "—" : submittedAt || ""}
      </div>
    </article>
  );
}

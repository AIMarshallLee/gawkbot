import { useState } from "react";

import type { TaskDefinition } from "../../api/tasks";
import { Bilingual } from "../ui/Bilingual";
import { TranslateButton } from "../ui/TranslateButton";

interface TaskDefinitionViewProps {
  /** The structured intake contract (R4) set via team_task action=define. */
  definition: TaskDefinition;
}

export function TaskDefinitionView({ definition }: TaskDefinitionViewProps) {
  const deliverables = definition.deliverables ?? [];
  const criteria = definition.success_criteria ?? [];
  const access = definition.access_needed ?? [];

  const [translatedGoal, setTranslatedGoal] = useState<string | null>(null);
  const [translatedCriteria, setTranslatedCriteria] = useState<string[] | null>(null);

  const fullTextToTranslate = [
    definition.goal ? `目标: ${definition.goal}` : "",
    ...criteria.map((c, i) => `标准 ${i + 1}: ${c}`),
  ]
    .filter(Boolean)
    .join("\n");

  const handleTranslateToggle = (isZh: boolean, text: string) => {
    if (!isZh) {
      setTranslatedGoal(null);
      setTranslatedCriteria(null);
      return;
    }
    const lines = text.split("\n");
    const goalLine = lines.find((l) => l.startsWith("目标:"))?.replace(/^目标:\s*/, "") || definition.goal;
    setTranslatedGoal(goalLine);

    const translatedC: string[] = [];
    for (let i = 0; i < criteria.length; i++) {
      const match = lines.find((l) => l.startsWith(`标准 ${i + 1}:`));
      if (match) {
        translatedC.push(match.replace(new RegExp(`^标准 ${i + 1}:\\s*`), ""));
      } else {
        translatedC.push(criteria[i]);
      }
    }
    setTranslatedCriteria(translatedC);
  };

  const displayGoal = translatedGoal ?? definition.goal;
  const displayCriteria = translatedCriteria ?? criteria;

  return (
    <div className="task-definition" data-testid="task-definition">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <TranslateButton
          originalText={fullTextToTranslate}
          onToggle={handleTranslateToggle}
          label="🌐 翻译目标与标准"
        />
      </div>
      <div className="task-definition-group">
        <span className="task-definition-label">
          <Bilingual layout="inline" en="Goal" zh="目标" />
        </span>
        <p className="task-definition-goal">{displayGoal}</p>
      </div>
      {deliverables.length > 0 ? (
        <div className="task-definition-group">
          <span className="task-definition-label">
            <Bilingual layout="inline" en="Deliverables" zh="交付成果" />
          </span>
          <ul className="task-definition-list">
            {deliverables.map((d) => (
              <li
                key={`${d.name}::${d.format ?? ""}`}
                className="task-definition-deliverable"
              >
                <span className="task-definition-deliverable-name">
                  {d.name}
                </span>
                {d.format ? (
                  <span className="task-definition-chip">{d.format}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {displayCriteria.length > 0 ? (
        <div className="task-definition-group">
          <span className="task-definition-label">
            <Bilingual layout="inline" en="Success criteria" zh="验收标准" />
          </span>
          <ul className="task-definition-list">
            {displayCriteria.map((c) => (
              <li key={c} className="task-definition-criterion">
                <span className="task-definition-check" aria-hidden="true">
                  ☐
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {access.length > 0 ? (
        <div className="task-definition-group">
          <span className="task-definition-label">
            <Bilingual layout="inline" en="Access needed" zh="所需权限" />
          </span>
          <div className="task-definition-access">
            {access.map((a) => (
              <span key={a} className="task-definition-chip">
                {a}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

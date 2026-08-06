WITH updated AS (
  SELECT
    name,
    jsonb_set(
      rules_json,
      '{layout,paragraphVariant}',
      to_jsonb(CASE
        WHEN rules_json #>> '{layout,headingVariant}' = 'left-bar' THEN 'indent'
        WHEN rules_json #>> '{layout,headingVariant}' = 'numbered' THEN 'report'
        WHEN rules_json #>> '{layout,headingVariant}' = 'shadow-card' THEN 'rail'
        WHEN rules_json #>> '{layout,headingVariant}' = 'stamp' THEN 'indent'
        WHEN rules_json #>> '{layout,headingVariant}' = 'center-underline' THEN 'newspaper'
        WHEN rules_json #>> '{layout,headingVariant}' = 'band' THEN 'card'
        ELSE 'plain'
      END),
      true
    ) AS rules_json
  FROM wechat_layout_system_presets
)
UPDATE wechat_layout_system_presets preset
SET rules_json = updated.rules_json
FROM updated
WHERE preset.name = updated.name;

WITH current_rules AS (
  SELECT
    template.workspace_id,
    template.id AS template_id,
    jsonb_set(
      version.rules_json,
      '{layout,paragraphVariant}',
      to_jsonb(CASE
        WHEN version.rules_json #>> '{layout,headingVariant}' = 'left-bar' THEN 'indent'
        WHEN version.rules_json #>> '{layout,headingVariant}' = 'numbered' THEN 'report'
        WHEN version.rules_json #>> '{layout,headingVariant}' = 'shadow-card' THEN 'rail'
        WHEN version.rules_json #>> '{layout,headingVariant}' = 'stamp' THEN 'indent'
        WHEN version.rules_json #>> '{layout,headingVariant}' = 'center-underline' THEN 'newspaper'
        WHEN version.rules_json #>> '{layout,headingVariant}' = 'band' THEN 'card'
        ELSE 'plain'
      END),
      true
    ) AS rules_json,
    COALESCE(max(existing.version_number), 0) + 1 AS next_version
  FROM wechat_layout_templates template
  JOIN wechat_layout_template_versions version
    ON version.workspace_id = template.workspace_id AND version.id = template.current_version_id
  LEFT JOIN wechat_layout_template_versions existing
    ON existing.workspace_id = template.workspace_id AND existing.template_id = template.id
  WHERE template.kind = 'SYSTEM'
  GROUP BY template.workspace_id, template.id, version.rules_json
),
inserted AS (
  INSERT INTO wechat_layout_template_versions (workspace_id, template_id, version_number, rules_json, source_type)
  SELECT workspace_id, template_id, next_version, rules_json, 'SYSTEM'
  FROM current_rules
  RETURNING workspace_id, template_id, id
)
UPDATE wechat_layout_templates template
SET current_version_id = inserted.id, updated_at = now()
FROM inserted
WHERE template.workspace_id = inserted.workspace_id AND template.id = inserted.template_id;

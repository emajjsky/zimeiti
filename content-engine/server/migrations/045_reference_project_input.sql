ALTER TABLE project_inputs DROP CONSTRAINT IF EXISTS project_inputs_kind_check;
ALTER TABLE project_inputs ADD CONSTRAINT project_inputs_kind_check CHECK (kind IN ('IDEA', 'DRAFT', 'NOTE', 'TRANSCRIPT', 'REFERENCE'));

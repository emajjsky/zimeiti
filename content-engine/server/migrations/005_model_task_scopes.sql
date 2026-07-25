UPDATE agent_model_policies SET scope = 'TEXT_TO_IMAGE' WHERE scope = 'IMAGE_GENERATION';
UPDATE agent_model_policies SET scope = 'TEXT_TO_VIDEO' WHERE scope = 'VIDEO_GENERATION';

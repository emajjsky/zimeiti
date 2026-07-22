export type ModelProvider = 'DASHSCOPE' | 'SILICONFLOW' | 'VOLCENGINE_ARK' | 'KIMI' | 'ZHIPU' | 'OPENAI' | 'OPENAI_COMPATIBLE';

export type ModelPurpose = 'INTELLIGENCE_SUMMARY' | 'INTELLIGENCE_FILTER' | 'TOPIC_RECOMMENDATION' | 'CONTENT_WRITING';

export interface ModelConnection {
  id: string;
  provider: ModelProvider;
  label: string;
  baseUrl: string;
  model: string;
  purposes: ModelPurpose[];
  status: 'UNTESTED' | 'READY' | 'ERROR';
  lastTestedAt?: string;
  lastError?: string;
}

export interface ModelConnectionInput extends Omit<ModelConnection, 'id' | 'status' | 'lastTestedAt' | 'lastError'> {
  id?: string;
  apiKey?: string;
}

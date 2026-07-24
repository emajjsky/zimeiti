/// <reference types="vite/client" />

import type { LocalState } from './data/localRepository';
import type { ApiUsageLog, ApiUsageSummary, BailianCliInput, BailianCliStatus, ModelCatalogItem, ModelConnection, ModelConnectionInput, ModelTaskPolicy } from './domain/integrations';

declare global {
  interface Window {
    contentEngine?: {
      platform: string;
      version: string;
      state: {
        load: () => Promise<{ state: LocalState; revision: number; updatedAt: string } | null>;
        save: (state: LocalState) => Promise<{ revision: number; updatedAt: string }>;
      };
      intelligence: {
        refreshRss: (sources: LocalState['sources']) => Promise<{
          items: LocalState['intelligence'];
          results: { sourceId: string; ok: boolean; count: number; error?: string }[];
        }>;
        previewLink: (url: string) => Promise<{ url: string; title: string; summary: string; source: string }>;
        analyze: (item: LocalState['intelligence'][number]) => Promise<NonNullable<LocalState['intelligence'][number]['analysis']>>;
        onUpdated: (callback: (items: LocalState['intelligence']) => void) => () => void;
      };
      models: {
        list: () => Promise<ModelConnection[]>;
        save: (input: ModelConnectionInput) => Promise<ModelConnection>;
        test: (id: string) => Promise<ModelConnection>;
        remove: (id: string) => Promise<void>;
        syncCatalog: () => Promise<{ items: ModelCatalogItem[]; errors: { connectionLabel: string; message: string }[] }>;
        listCatalog: () => Promise<ModelCatalogItem[]>;
        taskPolicies: () => Promise<ModelTaskPolicy[]>;
        saveTaskPolicy: (input: ModelTaskPolicy) => Promise<ModelTaskPolicy>;
        usageSummary: () => Promise<ApiUsageSummary>;
        usageLogs: () => Promise<ApiUsageLog[]>;
      };
      bailian: {
        status: () => Promise<BailianCliStatus>;
        save: (input: BailianCliInput) => Promise<BailianCliStatus>;
        test: () => Promise<BailianCliStatus>;
        remove: () => Promise<void>;
      };
    };
  }
}

export {};

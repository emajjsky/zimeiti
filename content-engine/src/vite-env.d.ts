/// <reference types="vite/client" />

import type { LocalState } from './data/localRepository';
import type { BailianCliInput, BailianCliStatus, ModelConnection, ModelConnectionInput } from './domain/integrations';

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
        onUpdated: (callback: (items: LocalState['intelligence']) => void) => () => void;
      };
      models: {
        list: () => Promise<ModelConnection[]>;
        save: (input: ModelConnectionInput) => Promise<ModelConnection>;
        test: (id: string) => Promise<ModelConnection>;
        remove: (id: string) => Promise<void>;
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

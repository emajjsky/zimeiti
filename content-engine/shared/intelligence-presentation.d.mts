export function toneForValue(value: string): `tone-${'blue' | 'mint' | 'yellow' | 'coral' | 'lilac'}`;
export function formatIntelligenceTime(value: string, now?: number): string;
export function projectForIntelligence<T extends { originType: string; originReferenceId?: string }>(projects: T[], intelligenceId: string): T | undefined;

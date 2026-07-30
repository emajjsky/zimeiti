export type ChannelView = 'copy' | 'visual' | 'layout' | 'review';
export type ChannelDeliveryStage = 'COPY' | 'VISUAL' | 'LAYOUT' | 'REVIEW' | 'READY';

export function canOpenChannelView(stage: ChannelDeliveryStage | undefined, view: ChannelView, hasCopy?: boolean): boolean;
export function channelViewForStage(stage: ChannelDeliveryStage | undefined, hasCopy?: boolean): ChannelView;

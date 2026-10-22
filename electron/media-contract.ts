export const MEDIA_CHANNELS = {
  select: 'media:select-file',
} as const;

export interface SelectedMediaFile {
  name: string;
  path: string;
}

export interface MediaBridge {
  selectFile(): Promise<SelectedMediaFile | null>;
}

export const MEDIA_CHANNELS = {
  select: 'media:select-file',
  prepareSelected: 'media:prepare-selected',
} as const;

export interface SelectedMediaFile {
  name: string;
  path: string;
}

export interface PreparedMediaFile {
  url: string;
  durationSec: number | null;
}

export interface MediaBridge {
  selectFile(): Promise<SelectedMediaFile | null>;
  prepareSelected(): Promise<PreparedMediaFile>;
}

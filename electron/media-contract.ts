export const MEDIA_CHANNELS = {
  select: 'media:select-file',
  prepareSelected: 'media:prepare-selected',
  trimSelected: 'media:trim-selected',
} as const;

export interface SelectedMediaFile {
  name: string;
  path: string;
}

export interface PreparedMediaFile {
  url: string;
  durationSec: number | null;
}

export interface MediaTrimRequest {
  sourceUrl: string;
  startSec: number;
  endSec: number;
}

export interface TrimmedMediaFile extends MediaTrimRequest {
  id: string;
  url: string;
  durationSec: number;
}

export interface MediaBridge {
  selectFile(): Promise<SelectedMediaFile | null>;
  prepareSelected(): Promise<PreparedMediaFile>;
  trimSelected(request: MediaTrimRequest): Promise<TrimmedMediaFile>;
}

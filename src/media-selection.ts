import type { SelectedMediaFile } from '../electron/media-contract';

export interface MediaSelectionState {
  selected: SelectedMediaFile | null;
  error: string | null;
}

export type MediaSelectionEvent =
  | { type: 'selected'; media: SelectedMediaFile }
  | { type: 'cancelled' }
  | { type: 'failed' };

export function reduceMediaSelection(state: MediaSelectionState, event: MediaSelectionEvent): MediaSelectionState {
  if (event.type === 'cancelled') return state;
  if (event.type === 'failed') {
    return {
      selected: state.selected,
      error: 'No se pudo seleccionar el archivo de audio o vídeo. Inténtalo de nuevo.',
    };
  }
  return { selected: event.media, error: null };
}

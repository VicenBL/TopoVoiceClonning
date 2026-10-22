export interface TestMediaSelectionState {
  selected: { name: string; path: string } | null;
  error: string | null;
}

export type TestMediaSelectionEvent =
  | { type: 'selected'; media: { name: string; path: string } }
  | { type: 'cancelled' }
  | { type: 'failed' };

export function assertMediaSelectionTransitions(
  reduce: (state: TestMediaSelectionState, event: TestMediaSelectionEvent) => TestMediaSelectionState,
): void {
  const previous: TestMediaSelectionState = {
    selected: { name: 'previous.wav', path: 'C:\\media\\previous.wav' },
    error: 'Error previo.',
  };
  const assertState = (actual: TestMediaSelectionState, expected: TestMediaSelectionState) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Estado de selección inesperado: ${JSON.stringify(actual)}`);
    }
  };
  assertState(reduce(previous, {
    type: 'selected', media: { name: 'voice.mp4', path: 'C:\\media\\voice.mp4' },
  }), { selected: { name: 'voice.mp4', path: 'C:\\media\\voice.mp4' }, error: null });
  assertState(reduce(previous, { type: 'cancelled' }), previous);
  assertState(reduce(previous, { type: 'failed' }), {
    selected: previous.selected,
    error: 'No se pudo seleccionar el archivo de audio o vídeo. Inténtalo de nuevo.',
  });
}

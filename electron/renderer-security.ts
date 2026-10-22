export function isTrustedRendererUrl(candidate: string | undefined, trusted: string): boolean {
  if (!candidate) return false;
  try {
    const actual = new URL(candidate);
    const expected = new URL(trusted);
    if (actual.protocol !== expected.protocol) return false;
    if (actual.protocol === 'file:') return actual.pathname === expected.pathname;
    return actual.origin === expected.origin;
  } catch {
    return false;
  }
}

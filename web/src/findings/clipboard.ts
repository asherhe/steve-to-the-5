type ClipboardLike = { writeText(text: string): Promise<void> };

/** Returns false (never throws) when the clipboard is unavailable or denied. */
export async function copyText(text: string, clipboard?: ClipboardLike | null): Promise<boolean> {
  const cb = clipboard === undefined ? (globalThis.navigator as { clipboard?: ClipboardLike } | undefined)?.clipboard : clipboard;
  if (!cb || typeof cb.writeText !== 'function') return false;
  try {
    await cb.writeText(text);
    return true;
  } catch {
    return false;
  }
}

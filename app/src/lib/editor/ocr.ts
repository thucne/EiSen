/** Runs native OCR on the editor pin, or on the exact rendered export snapshot
 *  when edits or a pending crop are visible. */
export async function extractEditorTextWithSnapshot(options: {
  hasRenderedChanges: boolean;
  extractPinned: () => Promise<string>;
  renderSnapshot: () => Promise<Uint8Array>;
  extractRendered: (bytes: Uint8Array) => Promise<string>;
}): Promise<string> {
  if (!options.hasRenderedChanges) return options.extractPinned();
  const bytes = await options.renderSnapshot();
  return options.extractRendered(bytes);
}

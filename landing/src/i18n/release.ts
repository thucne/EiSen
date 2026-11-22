import metadata from "../data/release-metadata.json";

export const releaseMetadata = metadata;

/** Formats the published installer size using the site's localized decimal mark. */
export function formatArtifactSize(bytes: number, locale: "en" | "vi"): string {
  const value = (bytes / 1_000_000).toFixed(2);
  return `${locale === "vi" ? value.replace(".", ",") : value} MB`;
}

/** Formats an exact byte count with the English grouping used in metadata. */
export function formatByteCount(bytes: number): string {
  return bytes.toLocaleString("en-US");
}

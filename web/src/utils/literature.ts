import litdb from "../../docs/litdb.json";
import type { LitDb } from "@exporter/zotero";

const LITDB = litdb as LitDb;

/**
 * A cited entry's reference as formatted by Zotero, with its links opening in a new tab.
 */
export function referenceHtml(key: string): string {
    const bib = LITDB[key]?.bib ?? "Reference unavailable.";
    return bib.replaceAll("<a ", '<a target="_blank" rel="noopener" ');
}

/**
 * The ID of an entry in its page's bibliography, which citations link to.
 */
export function referenceId(key: string): string {
    return `ref-${key.toLowerCase()}`;
}

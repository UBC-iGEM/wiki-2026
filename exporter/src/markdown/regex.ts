const REGEXES: [RegExp, string][] = [
    /**
     * Render Notion date mentions as text.
     * Attributes are emitted in a fixed order per the spec.
     * FROM:
         <mention-date start="YYYY-MM-DD" end="YYYY-MM-DD"/>
         <mention-date start="YYYY-MM-DD" startTime="HH:mm" timeZone="IANA_TIMEZONE"/>
         <mention-date start="YYYY-MM-DD"/>
     * TO:
         DD/MM/YYYY to DD/MM/YYYY
         DD/MM/YYYY at HH:mm
         DD/MM/YYYY
     * These must precede the colon-escape rule below, which would otherwise turn the `:` in
     * `startTime="HH:mm"` into `\:` before the time pattern can match it.
     */
    [/<mention-date\s+start="(\d{4})-(\d{2})-(\d{2})"\s+end="(\d{4})-(\d{2})-(\d{2})"[^>]*\/>/, "$3/$2/$1 to $6/$5/$4"],
    [/<mention-date\s+start="(\d{4})-(\d{2})-(\d{2})"\s+startTime="(\d{2}:\d{2})"[^>]*\/>/, "$3/$2/$1 at $4"],
    [/<mention-date\s+start="(\d{4})-(\d{2})-(\d{2})"[^>]*\/>/, "$3/$2/$1"],

    /**
     * Escape raw colons to avoid unexpected directives
     */
    [/:/, "\\:"],

    /**
     * Convert block component syntax into a container directive with newline terminator.
     * FROM:
         %% START COMPONENT
             ...
         %% END
     * TO:
         ::: COMPONENT
             ...
         :::
     */
    [/%{2,}\s*START\s+([a-zA-Z]+)/, "\n:::$1"],
    [/%{2,}\s*END/, "\n:::\n"],

    /**
     * Convert inline component syntax into an inline text directive.
     * FROM:
         %\{ COMPONENT ... \}%
     * TO:
         :COMPONENT[...]
     */
    [/%\\\{\s*([a-zA-Z]+)\s+([\s\S]*?)\\\}%/, ":$1[$2]"],

    /**
     * Add newline after various elements to ensure parser recognizes them as distinct nodes.
     * Supported elements:
        - Any closing HTML tag (e.g., </details>) on its own line EXCEPT </colgroup> | </tr> since this breaks HTML tables
        - A closing code block fence (i.e., ```) on its own line
        - An opening or closing LaTeX fence (i.e., $$) on its own line
     */
    [/^((<\/(?!colgroup|tr)[a-zA-Z_-]+>)|(```)|(\$\$))$/, "$1\n"],

    /**
     * Remove the ticks that Notion injects around inline math delimiters
     */
    [/\$`/, "$"],
    [/`\$/, "$"],

    /**
     * Replace Notion mentions with standard Markdown blocks.
     * The Markdown blocks may later be parsed and transformed.
     */
    [/<(mention-page|mention-database)\s+url="([^"]*)"(?:\/>|>([^<]*)<\/mention-(?:page|database)>)/, "[$1]($2)"],
    [/<empty-block\/>/, "\n"],

    /**
     * Update Notion callout elements to be parsed as a component.
     */
    [/<(\/?)callout/, "<$1Callout"],

    /**
     * Add newline after last list item
     */
    [/^([\s]*(?:[-]|\d+\.) .*$)(?!\n[\s]*(?:[-]|\d+\.) )/, "$1\n"],

    /**
     * Add newline before and after dividers to avoid parsing issues
     */
    [/^---$/, "\n---\n"],

    /**
     * Notion emits bold spans with whitespace before the closing `**`
     * We need to strip this out.
     */
    [/\*\*(\s*)([^*]+?)(\s*)\*\*/, "$1**$2**$3"],

    /**
     * Strip closing </file> tags to avoid parsing issues
     */
    [/<\/file>/, ""],
];

export function processRegex(s: string): string {
    // Remove <synced_block> ... </synced_block> tags and dedent the inner content
    let processed = s.replace(/<synced_block[^>]*>\n?([\s\S]*?)\n?<\/synced_block>/gi, (_match, body: string) =>
        body.replace(/^\t/gm, ""),
    );

    for (const [search, replace] of REGEXES) {
        // Add flags `Global`, `case Insensitive`, `Multiline` to all
        const search_regex = new RegExp(search, "gim");
        processed = processed.replaceAll(search_regex, replace);
    }

    return processed;
}

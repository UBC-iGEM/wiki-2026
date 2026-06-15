const REGEXES: [RegExp, string][] = [
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
];

export function processRegex(s: string): string {
    let processed = s;

    for (const [search, replace] of REGEXES) {
        // Add flags `Global`, `case Insensitive`, `Multiline`
        const search_regex = new RegExp(search, "gim");
        processed = processed.replaceAll(search_regex, replace);
    }

    return processed;
}

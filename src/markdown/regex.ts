const regexes: [RegExp, string][] = [
    /**
     * Convert block component syntax into container directive with newline terminator
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
     * Convert inline component syntax into text directive
     * FROM:
         %\{ COMPONENT ... \}%
     * TO:
         :COMPONENT[...]
     */
    [/%\\\{\s*([a-zA-Z]+)\s+([\s\S]*?)\s*\\\}%/, ":$1[$2]"],

    /**
     * Add newline after various elements to ensure parser recognizes them as distinct nodes
     * Supported elements:
        - Any closing HTML tag (e.g., </details>) on its own line
        - A closing code block fence (i.e., ```) on its own line
        - An opening or closing LaTeX fence (i.e., $$) on its own line
     */
    [/^((<\/[a-zA-Z_-]+>)|(```)|(\$\$))$/, "$1\n"],

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

    for (const [search, replace] of regexes) {
        // Add flags `Global`, `case Insensitive`, `Multiline`
        const search_regex = new RegExp(search, "gim");
        processed = processed.replaceAll(search_regex, replace);
    }

    return processed;
}

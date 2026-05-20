const regexes: [RegExp, string][] = [
    /**
     * Convert component syntax into Markdown directive with newline terminator
     * FROM:
        %% START COMPONENT
          ...
        %% END
     * TO:
        ::: COMPONENT
          ...
        :::
     */
    [/%{2,}[ ]*START[ ]+([a-zA-Z]+)/, "\n:::$1"],
    [/%{2,}[ ]*END/, "\n:::\n"],

    /**
     * Add newline after various elements to ensure parser recognizes them as distinct nodes
     * Supported elements:
        - Any closing HTML tag (e.g., </details>) on its own line
        - A closing code block fence (i.e., ```) on its own line
        - An opening or closing LaTeX fence (i.e., $$) on its own line
     */
    [/^((<\/[a-zA-Z_-]+>)|(```)|(\$\$))$/, "$1\n"],

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

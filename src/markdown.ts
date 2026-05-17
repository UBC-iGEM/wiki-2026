import * as log from "./log";
import { isErr, save } from "./utils";

import { PagePath, type RouteMap } from "./parse";
import { SKIP, visit } from "unist-util-visit";
import type { Html, Link, ListItem, Paragraph, Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkDirective from "remark-directive";
import parse from "node-html-parser";
import remarkMath from "remark-math";
import { BlockId } from "./notion";

export async function processMarkdown({ md, path, routes }: { md: string; path: PagePath; routes: RouteMap }) {
    const preprocessor_regexes: [RegExp, string][] = [
        /*
  Convert component syntax into Markdown directive with newline terminator
  FROM:
      %% START COMPONENT
          ...
      %% END
  TO:
      ::: COMPONENT
          ...
      :::
*/
        [/^%%[ ]?START ([a-zA-Z]+)[ ]*$/, ":::$1"],
        [/^%%[ ]?END[ ]*$/, ":::\n"],

        // Convert <empty-block/> elements to simple blank line (\n)
        [/^<empty-block\/>$/, "\n"],

        /*
  Add newline after various elements to ensure parser recognizes them as distinct nodes
  Supported elements:
      - Any closing HTML tag (e.g., </details>) on its own line
      - A closing code block fence (i.e., ```) on its own line
      - An opening or closing LaTeX fence (i.e., $$) on its own line
 */
        [/^((<\/[a-zA-Z_-]+>)$|(```)$|(\$\$)$)/, "$1\n"],
    ];

    let preprocessed_markdown = md;
    for (const [search, replace] of preprocessor_regexes) {
        // Add flags `Global`, `case Insensitive`, `Multiline`
        const search_regex = new RegExp(search, "gim");
        preprocessed_markdown = preprocessed_markdown.replaceAll(search_regex, replace);
    }

    const processed_markdown = await unified()
        .use(remarkParse)
        .use(remarkDirective)
        .use(remarkMath)
        .use(processMAst)
        .use(remarkStringify, {
            bullet: "-",
        })
        .process(preprocessed_markdown);
    const result = await save({ content: String(processed_markdown), path: path.withExt("mdx") });

    if (isErr(result)) log.warn_error(result);

    // PROCESSING FUNCTIONS ----------
    function processMAst() {
        return (tree: Root) => {
            // console.dir(tree, { depth: null });
            visit(tree, (node, index, parent) => {
                if (index === undefined || !parent) return;

                switch (node.type) {
                    case "html": {
                        if (node.value.includes("<mention-page")) {
                            const new_link = normalizeMention({ node });

                            if (!new_link) return;
                            if (isErr(new_link)) {
                                log.warn_error(new_link);
                                return;
                            }

                            // The new link must be wrapped in a `paragraph` block
                            parent.children[index] = {
                                type: "paragraph",
                                children: [new_link],
                            };
                            return SKIP;
                        }
                        break;
                    }
                    case "link": {
                        const new_link = normalizeLink({ node });

                        if (!new_link) return;
                        if (isErr(new_link)) {
                            log.warn_error(new_link);
                            return;
                        }

                        parent.children[index] = new_link;
                        return SKIP;
                    }
                    case "image": {
                        const image_url = node.url;
                        if (image_url.includes("file://")) {
                            const decoded_url = decodeURIComponent(image_url.replace("file://", ""));

                            try {
                                interface UrlData {
                                    permissionRecord: {
                                        id: string;
                                    };
                                }
                                const url_data: UrlData = JSON.parse(decoded_url);

                                const block_id = new BlockId(url_data.permissionRecord.id);
                                // TODO! Image upload and transform
                                // console.log(block_id);

                                node.url = `<TOOLS_API_BASE>/${block_id.id}`;
                            } catch (err) {
                                log.warn_error(`Failed to parse image URL ${decoded_url}: ${err}`);
                            }
                        }
                        break;
                    }
                    case "list": {
                        const new_paragraph = splitList({ children: node.children });
                        if (new_paragraph) {
                            parent.children.splice(index + 1, 0, new_paragraph);
                            return [SKIP, index + 2];
                        }
                    }
                }
            });
        };

        function normalizeMention({ node }: { node: Html }): Link | Error | void {
            const err_base = `'mention-page' element on page ${path.path} (${node})`;

            const parsed_node = parse(node.value);
            const mention_element = parsed_node.querySelector("mention-page")!;
            const url = mention_element.attributes["url"];
            if (!url) {
                return new Error(`${err_base} has no valid attribute 'url'`);
            }

            return normalizeUrl({ url, err_base });
        }

        function normalizeLink({ node }: { node: Link }): Link | Error | void {
            const err_base = `'link' element on page ${path.path} (${node})`;
            return normalizeUrl({ url: node.url, err_base });
        }

        /**
         * If a link points to a `www.notion.so` domain, replace it with a link to that page's location in the wiki
         */
        function normalizeUrl({ url, err_base }: { url: string; err_base: string }): Link | Error | void {
            if (!url.includes("www.notion.so")) {
                // External link
                return;
            }

            const page_id = url.match(/(?<=\/|-)[a-f0-9]{32}(?:\?|$)/)?.[0];
            if (!page_id) return new Error(`${err_base} has no valid id`);

            const page_path = routes[page_id];
            if (!page_path) return new Error(`${err_base} links to page ${page_id}, which is not a known wiki path`);

            return {
                type: "link",
                url: page_path.path,
                children: [{ type: "text", value: page_path.components().at(-1)! }],
            };
        }

        /**
         * Walk a Markdown list. If text has been accidentally joined to its end,
         * splice it out and return it as a new Paragraph.
         */
        function splitList({ children }: { children: ListItem[] }): Paragraph | void {
            const last_list_item = children.at(-1);
            if (!last_list_item) return;

            return splitListItem({ item: last_list_item });
        }

        function splitListItem({ item }: { item: ListItem }): Paragraph | void {
            const last_child = item.children.at(-1);
            if (!last_child) return;

            switch (last_child.type) {
                case "paragraph":
                    break;
                case "list":
                    // Time to go deeper
                    return splitList({ children: last_child.children });
                default:
                    return;
            }

            const last_text_element = last_child.children.at(-1);
            if (!last_text_element || last_text_element.type !== "text") return;
            const text = last_text_element.value;

            const split_index = text.indexOf("\n");
            if (split_index === -1) return;

            const before = text.slice(0, split_index).trimEnd();
            const after = text.slice(split_index + 1).trimStart();

            last_text_element.value = before;
            const new_paragraph: Paragraph = {
                type: "paragraph",
                children: [
                    {
                        type: "text",
                        value: after,
                    },
                ],
            };

            return new_paragraph;
        }
    }
}

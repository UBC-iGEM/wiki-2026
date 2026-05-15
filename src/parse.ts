type PageIds = Brand<string[], "pageIds">;

export async function parseAggregate({
    aggregateId,
}: {
    aggregateId: string;
}): Promise<Result<PageIds>> {
    const blocks = await notion.getBlockChildren({ blockId: aggregateId });
    if (blocks instanceof Error) {
        return blocks;
    }

    for (const block of blocks) {
        let pageId = "";

        if (
            block.type === "paragraph" &&
            block.paragraph.rich_text.length > 0
        ) {
            const richText = block.paragraph.rich_text[0];
            let text = "";
            if (richText && richText.href) {
                text = richText.href;
            }

            if (text.includes("www.notion.so")) {
                if (richText.type === "mention") {
                    // Mention
                    pageId = text.substring(text.lastIndexOf("/") + 1);
                } else {
                    // URL
                    const databasePageId = text.match(/p=([a-f0-9]{32})/);

                    if (databasePageId) {
                        // Database page link
                        pageId = databasePageId[1];
                    } else {
                        // Direct page link
                        pageId = text.substring(text.lastIndexOf("-") + 1);
                    }
                }
            }
        } else if (
            block.type === "link_to_page" &&
            block.link_to_page.type === "page_id"
        ) {
            // Linked database view
            pageId = block.link_to_page.page_id;
        }

        if (!pageId) {
            continue;
        }

        const aggregateTitle = await getPageTitle(aggregateId);
        const pageTitle = await getPageTitle(pageId);
        const lastEditedTime = await getPageLastEditedTime(pageId);

        if (
            !syncLog.modified({
                databaseId: aggregateId,
                databaseTitle: aggregateTitle,
                pageId,
                pageTitle,
                lastEditedTime,
                fileExtension: "mdx",
            })
        ) {
            return;
        }

        const codeFence = "---";

        const metadata = `<!--\n${codeFence}\n${await getPageMetadata(pageId)}\n${codeFence}\n-->\n`;
        const pageContent = await parsePage({
            blockId: pageId,
            content: { value: metadata },
            databaseTitle: aggregateTitle,
            pageTitle,
        });

        const codeFenceStart =
            pageContent.indexOf(codeFence) + codeFence.length;
        const codeFenceEnd =
            pageContent.indexOf(codeFence, codeFenceStart) + codeFence.length;

        const content =
            pageContent.slice(0, codeFenceEnd) +
            component.imports() +
            pageContent.slice(codeFenceEnd);

        fileSystem.write({
            folderName: aggregateTitle,
            fileName: pageTitle,
            fileContent: content,
            fileExtension: "mdx",
        });
        syncLog.update({
            databaseId: aggregateId,
            databaseTitle: aggregateTitle,
            pageId,
            pageTitle,
            lastEditedTime,
        });
        syncLog.save();
    }
}

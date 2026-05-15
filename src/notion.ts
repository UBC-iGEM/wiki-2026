import { Client, type ListBlockChildrenResponse } from "@notionhq/client";
import * as log from "./log";

export type PageId = Brand<string, "PageId">;
export type BlockId = Brand<string, "BlockId">;

let notionClient: Client | null = null;

function notion(): Client {
    if (notionClient) {
        return notionClient;
    }

    const key = process.env.NOTION_API_KEY;

    if (key) {
        try {
            notionClient = new Client({ auth: key });
            return notionClient;
        } catch (e) {
            log.error_and_quit(`Failed to connect new Notion client. Error: ${e}`);
        }
    } else {
        log.error_and_quit("NOTION_API_KEY env. variable is unset");
    }
}

export async function getPageName({ page_id }: { page_id: PageId }): Promise<Result<string>> {
    try {
        const page = await notion().pages.retrieve({ page_id });
        if ("properties" in page && page.properties.title && page.properties.title.type === "title") {
            const title_property = page.properties.title;
            const title_plain_text = title_property.title.map((t) => t.plain_text).join("");
            return title_plain_text;
        } else {
            return new Error(`Unable to retrieve title of ${page_id}: 'title' property missing or malformed.`);
        }
    } catch (err) {
        return new Error(`Error while retrieving title of ${page_id}: ${err}`);
    }
}

export async function getPageMarkdown({ page_id }: { page_id: PageId }): Promise<Result<string>> {
    try {
        const page = await notion().pages.retrieveMarkdown({ page_id });
        return page.markdown;
    } catch (error) {
        return new Error(`Unable to fetch page ${page_id} as markdown: ${error}`);
    }
}

export async function getBlockChildren({ blockId }: { blockId: BlockId }): Promise<Result<BlockObjectResponse[]>> {
    const blocks: BlockObjectResponse[] = [];

    async function list_block_children({
        start_cursor = undefined,
    }: {
        start_cursor?: string;
    }): Promise<ListBlockChildrenResponse> {
        return await notion().blocks.children.list({
            block_id: blockId,
            start_cursor,
        });
    }

    try {
        let response = await list_block_children({});
        blocks.push(...(response.results as BlockObjectResponse[]));

        while (response.has_more) {
            response = await list_block_children({
                start_cursor: response.next_cursor!,
            });
            blocks.push(...(response.results as BlockObjectResponse[]));
        }

        return blocks;
    } catch (error) {
        return new Error(`Failed to retrieve blocks of ${blockId}: ${error}`);
    }
}

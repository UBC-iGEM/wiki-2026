import { Client, type ListBlockChildrenResponse } from "@notionhq/client";

let notionClient: Client | null = null;

function notion(): Client {
    if (notionClient) {
        return notionClient;
    }

    const key = process.env.NOTION_API_KEY;

    if (key) {
        try {
            notionClient = new Client({ auth: key });
        } catch (e) {
            log.error_and_quit(
                `Failed to connect new Notion client. Error: ${e}`,
            );
        }
        return notionClient;
    } else {
        log.error_and_quit("NOTION_API_KEY env. variable is unset");
    }
}

export async function getBlockChildren({
    blockId,
}: {
    blockId: string;
}): Promise<Result<BlockObjectResponse[]>> {
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
        return error as Error;
    }
}

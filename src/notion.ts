import { Client, type BlockObjectResponse } from "@notionhq/client";
import * as log from "./log";
import { isErr, type Result } from "./utils";
import { PagePath } from "./parse";

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

interface Queryable {
    getName(): Promise<Result<string>>;
    getPaths(): Promise<Result<[PageId, PagePath][]>>;
}

export class PageId implements Queryable {
    constructor(public id: string) {}

    async getName(): Promise<Result<string>> {
        const error_base = `Unable to retrieve title of page ${this.id}`;

        try {
            const page = await notion().pages.retrieve({ page_id: this.id });

            if (!("properties" in page)) {
                return new Error(`${error_base}: no properties found.`);
            }

            const title_property = Object.values(page.properties).find((p) => p.type === "title");
            if (title_property && title_property.type === "title") {
                return title_property.title.map((t) => t.plain_text).join("");
            } else {
                return new Error(`${error_base}: 'title' property missing.`);
            }
        } catch (err) {
            return new Error(`${error_base}: ${err}`);
        }
    }

    async getPaths(): Promise<Result<[PageId, PagePath][]>> {
        const child_path = await this.getName();
        return isErr(child_path) ? child_path : [[this, new PagePath(child_path)]];
    }

    async getMarkdown(): Promise<Result<string>> {
        try {
            const page = await notion().pages.retrieveMarkdown({ page_id: this.id });
            return page.markdown;
        } catch (error) {
            return new Error(`Unable to fetch page ${this.id} as markdown: ${error}`);
        }
    }
}

export class DatabaseId implements Queryable {
    constructor(public id: string) {}

    async getName(): Promise<Result<string>> {
        const error_base = `Unable to retrieve title of page ${this.id}`;

        try {
            const db = await notion().databases.retrieve({ database_id: this.id });

            if (!("title" in db)) {
                return new Error(`${error_base}: 'title' property missing.`);
            }

            const title_plain_text = db.title.map((t) => t.plain_text).join("");
            return title_plain_text;
        } catch (err) {
            return new Error(`${error_base}: ${err}`);
        }
    }

    async getPaths(): Promise<Result<[PageId, PagePath][]>> {
        const db_name = await this.getName();
        if (isErr(db_name)) return db_name;

        try {
            const children = await this.getEntries();
            if (isErr(children)) return children;

            return await Promise.all(
                children.map(async (db_page) => {
                    // Should only be a single entry, since we are calling on a page
                    const db_page_paths = await db_page.getPaths();
                    if (isErr(db_page_paths)) throw db_page_paths;

                    const [db_page_id, db_page_path] = db_page_paths[0]!;
                    return [db_page_id, new PagePath(db_name).with(db_page_path)] as [PageId, PagePath];
                }),
            );
        } catch (err) {
            return err as Error;
        }
    }

    async getEntries(): Promise<Result<PageId[]>> {
        const error_base = `Error while retrieving entries of database ${this.id}`;

        try {
            const db = await notion().databases.retrieve({ database_id: this.id });
            if (!("data_sources" in db)) {
                return new Error(`${error_base}: db has no data sources!`);
            }

            const pageIds: string[] = [];
            for (const ds of db.data_sources) {
                let cursor: string | undefined = undefined;
                do {
                    const res = await notion().dataSources.query({
                        data_source_id: ds.id,
                        start_cursor: cursor,
                    });
                    pageIds.push(...res.results.map((r) => r.id));
                    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
                } while (cursor);
            }

            return pageIds.map((id) => new PageId(id));
        } catch (err) {
            return new Error(`${error_base}: ${err}`);
        }
    }
}

export class BlockId {
    constructor(public id: string) {}

    async getChildren(): Promise<Result<BlockObjectResponse[]>> {
        try {
            const blocks: BlockObjectResponse[] = [];
            let cursor: string | undefined = undefined;

            do {
                const res = await notion().blocks.children.list({
                    block_id: this.id,
                    start_cursor: cursor,
                });
                blocks.push(...(res.results as BlockObjectResponse[]));
                cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
            } while (cursor);

            return blocks;
        } catch (error) {
            return new Error(`Failed to retrieve blocks of ${this.id}: ${error}`);
        }
    }
}

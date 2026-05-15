import { BlockObjectResponse as _BOR } from "@notionhq/client";
import * as _log from "./log";
import * as _notion from "./notion";

declare global {
    // Helper types
    type Result<T> = T | Error;
    type Brand<K, T> = K & { __phantom: T };

    // Global imports
    type BlockObjectResponse = _BOR;

    // Module auto-imports
    const log: typeof _log;
    const notion: typeof _notion;
}

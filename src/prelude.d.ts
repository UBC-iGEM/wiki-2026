import { BlockObjectResponse as _BlockObjectResponse } from "@notionhq/client";

declare global {
    // Helper types
    type Result<T> = T | Error;
    type Brand<K, T> = K & { __brand: T };

    // Global imports
    type BlockObjectResponse = _BlockObjectResponse;

    // Module auto-imports
    const log: typeof _log;
    const notion: typeof _notion;
}

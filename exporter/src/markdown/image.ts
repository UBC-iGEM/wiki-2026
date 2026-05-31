import { BlockId, Id } from "../notion";
import { $unsafeSync, isErr, type Result } from "../utils";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Image } from "mdast";
import { CONTINUE } from "unist-util-visit";
import { v5 as uuidv5 } from "uuid";

export const IMAGE_PROCESSORS = [updateImageUrl];

/**
 * Replace URL of image block with static URL of image uploaded to `tools.igem.org`
 */
function updateImageUrl({ node, ctx }: ProcessorInput<Image>): ProcessorOutput {
    const image_node_url = node.url;

    // THESE VARIABLES ARE USED FOR IMAGE UPLOAD
    // They are set under all conditions, and will be defined when the upload callback is triggered

    /**
     * A UID that identifies the image.
     * Stable between export runs; can be used to check if an image has already been uploaded.
     */
    let image_id: Id | undefined;
    /**
     * A URL that points to the actual image data.
     */
    let _image_data_url: string | undefined = undefined;

    if (image_node_url.includes("file://")) {
        // This is a file uploaded to Notion
        // The URL contains metadata, including the Notion block id
        const decoded_url = decodeURIComponent(image_node_url.replace("file://", ""));

        interface UrlData {
            // `permissionRecord` matches exactly the property in the URL
            // eslint-disable-next-line @typescript-eslint/naming-convention
            permissionRecord: {
                id: string;
            };
        }

        const url_data: Result<UrlData> = $unsafeSync(JSON.parse, decoded_url);
        if (isErr(url_data))
            return new Error(`Failed to parse image URL ${decoded_url} on page ${ctx.path}: ${url_data}`);

        const id = url_data.permissionRecord.id;
        image_id = new Id(id);
        const block_id = new BlockId(id);

        const callback = async (): Promise<Result<void>> => {
            const block_data = await block_id.get();
            if (isErr(block_data)) return block_data;
            if (block_data.type !== "image" || block_data.image.type !== "file")
                return new Error(`Image block ${block_id} does not point to expected image data`);

            _image_data_url = block_data.image.file.url;

            // TODO: GET AND UPLOAD
        };
        ctx.callbacks.push(callback);
    } else {
        // This is a linked image that exists somewhere online

        // The AWS URLs returned by Notion often have changing query parameters
        const stable_url = image_node_url.split("?")[0]!;

        // A stable hash of the image URL
        const id = uuidv5(stable_url, uuidv5.DNS);
        image_id = new Id(id);

        // Include full query parameters for data to avoid "Access Denied" errors
        _image_data_url = image_node_url; // eslint-disable-line @typescript-eslint/no-unused-vars

        const callback = async (): Promise<Result<void>> => {
            // TODO: GET AND UPLOAD
        };
        ctx.callbacks.push(callback);
    }

    // TODO: replace with static.igem.org/...
    const TOOLS_API_BASE = "TOOLS_API_BASE";

    node.url = `${TOOLS_API_BASE}/${image_id}`;
    return CONTINUE;
}

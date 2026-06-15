import { BlockId, Id } from "../notion";
import { $unsafeSync, ExporterError, isErr, isExporterErr, type ExporterResult, type Result } from "../utils";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Image } from "mdast";
import { todo } from "node:test";
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
    let image_data_url: string | undefined = undefined;

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

        const url_data_res: Result<UrlData> = $unsafeSync(JSON.parse, decoded_url);
        if (isErr(url_data_res))
            return new ExporterError(
                `The image on page "${ctx.path}" with URL ${decoded_url} could not be understood; it does not match the expected format.`,
                ["bug?"],
                url_data_res,
            );

        const id = url_data_res.permissionRecord.id;
        image_id = new Id(id);
        const block_id = new BlockId(id);

        const callback = async (): Promise<ExporterResult<void>> => {
            const block_data = await block_id.get();
            if (isExporterErr(block_data)) return block_data;
            if (block_data.type !== "image" || block_data.image.type !== "file")
                return new ExporterError(
                    `The image on page "${ctx.path}" at Notion block ID ${block_id} could not be understood; its data type is unexpected.`,
                    ["notion server", "bug?"],
                    new Error(JSON.stringify(block_data, null, 2)),
                );

            image_data_url = block_data.image.file.url;

            // TODO: GET AND UPLOAD
            node.url = "https://TODO.com";
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
        image_data_url = image_node_url; // eslint-disable-line @typescript-eslint/no-unused-vars

        const callback = async (): Promise<ExporterResult<void>> => {
            // TODO: GET AND UPLOAD
            node.url = "https://TODO.com";
        };
        ctx.callbacks.push(callback);
    }

    return CONTINUE;
}

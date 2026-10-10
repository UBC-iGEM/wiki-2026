import { Id, type NotionBlock } from "../notion";
import { getToolsClient } from "../tools-api";
import { isExporterErr, type ExporterResult } from "../utils";
import type { ConvertContext } from "./blocks";
import { v5 as uuidv5 } from "uuid";

type MediaBlock = Extract<NotionBlock, { type: "image" | "file" }>;

/**
 * Uploads the media of an image or file block to `tools.igem.org`, returning its static URL.
 *
 * @param keep_original_file uploads the file as-is with its original extension, instead of converting it to an image.
 */
export async function uploadMedia(
    block: MediaBlock,
    ctx: ConvertContext,
    { keep_original_file = false }: { keep_original_file?: boolean } = {},
): Promise<ExporterResult<string>> {
    const media = block.type === "image" ? block.image : block.file;

    // The UID is stable between export runs, so it can be used to check if the media has already been uploaded
    const { uid, url } =
        media.type === "file"
            ? // Uploaded to Notion
              { uid: new Id(block.id), url: media.file.url }
            : // Linked from elsewhere; the AWS URLs returned by Notion often have changing query parameters
              { uid: new Id(uuidv5(media.external.url.split("?")[0]!, uuidv5.DNS)), url: media.external.url };

    const client_res = await getToolsClient();
    if (isExporterErr(client_res)) return client_res;

    const upload_res = await client_res.upload({
        uid: uid.toString(),
        url,
        path: ctx.path,
        original_file: keep_original_file ? { file_name: mediaFileName(block) } : undefined,
    });
    if (isExporterErr(upload_res)) return upload_res;

    return upload_res.location;
}

export function mediaFileName(block: MediaBlock): string {
    if (block.type === "file" && block.file.name) return block.file.name;

    const media = block.type === "image" ? block.image : block.file;
    const url = media.type === "file" ? media.file.url : media.external.url;
    return decodeURIComponent(url.split("?")[0]!.split("/").pop()!);
}

import { Id, type NotionBlock } from "../notion";
import { getToolsClient } from "../tools-api";
import { isExporterErr, type ExporterResult } from "../utils";
import { v5 as uuidv5 } from "uuid";

type MediaBlock = Extract<NotionBlock, { type: "image" | "file" }>;

/**
 * Uploads the media of an image or file block to `tools.igem.org`, returning its static URL.
 *
 * @param keep_original_file uploads the file as-is with its original extension, instead of converting it to an image.
 */
export async function uploadMedia(
    block: MediaBlock,
    { keep_original_file = false }: { keep_original_file?: boolean } = {},
): Promise<ExporterResult<string>> {
    const media = block.type === "image" ? block.image : block.file;

    const url = media.type === "file" ? media.file.url : media.external.url;
    const uid = mediaUid(url);

    const client_res = await getToolsClient();
    if (isExporterErr(client_res)) return client_res;

    const upload_res = await client_res.upload({
        uid: uid.toString(),
        url,
        original_file: keep_original_file ? { file_name: mediaFileName(block) } : undefined,
    });
    if (isExporterErr(upload_res)) return upload_res;

    return upload_res.location;
}

/**
 * The upload UID for the file at `url`, which is used to skip files that have already been uploaded.
 *
 * Notion changes the query of its file URLs on every request, but the path holds an ID for the uploaded file itself.
 * Ignoring the query keeps the UID stable between export run.
 */
export function mediaUid(url: string): Id {
    return new Id(uuidv5(url.split("?")[0]!, uuidv5.DNS));
}

export function mediaFileName(block: MediaBlock): string {
    if (block.type === "file" && block.file.name) return block.file.name;

    const media = block.type === "image" ? block.image : block.file;
    const url = media.type === "file" ? media.file.url : media.external.url;
    return decodeURIComponent(url.split("?")[0]!.split("/").pop()!);
}

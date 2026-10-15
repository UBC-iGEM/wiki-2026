import { Id, type NotionBlock } from "../notion";
import { getToolsClient } from "../tools-api";
import { $unsafe, ExporterError, isErr, isExporterErr, type ExporterResult } from "../utils";
import axios from "axios";
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
    const url = mediaUrl(block);

    const client_res = await getToolsClient();
    if (isExporterErr(client_res)) return client_res;

    const upload_res = await client_res.upload({
        uid: mediaUid(url).toString(),
        url,
        original_file: keep_original_file ? { file_name: mediaFileName(block) } : undefined,
    });
    if (isExporterErr(upload_res)) return upload_res;

    return upload_res.location;
}

/**
 * Downloads a block's media, for components that read the file itself at export time.
 */
export async function fetchMedia(block: MediaBlock): Promise<ExporterResult<Buffer>> {
    const response = await $unsafe(
        async () => await axios.get(mediaUrl(block), { responseType: "arraybuffer", timeout: 30000 }),
    );
    if (isErr(response))
        return new ExporterError(`Could not download the file "${mediaFileName(block)}".`, ["notion server"], response);

    return Buffer.from(response.data as ArrayBuffer);
}

/** Where a block's media lives: uploaded to Notion, or linked from elsewhere. */
export function mediaUrl(block: MediaBlock): string {
    const media = block.type === "image" ? block.image : block.file;
    return media.type === "file" ? media.file.url : media.external.url;
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

    return decodeURIComponent(mediaUrl(block).split("?")[0]!.split("/").pop()!);
}

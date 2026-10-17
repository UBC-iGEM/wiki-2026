import { Id, type NotionBlock } from "../notion";
import { getToolsClient } from "../tools-api";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import { blockContext, type ConvertContext } from "./blocks";
import { asPlainText } from "./rich-text";
import type { ImageBlockObjectResponse } from "@notionhq/client";
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

    const file_name = mediaFileName(block);
    // Converting an SVG would rasterize it, so SVGs are always uploaded as-is
    const is_svg = file_name.toLowerCase().endsWith(".svg");

    const client_res = await getToolsClient();
    if (isExporterErr(client_res)) return client_res;

    const upload_res = await client_res.upload({
        uid: uid.toString(),
        url,
        original_file: keep_original_file || is_svg ? { file_name } : undefined,
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
    // Notion image URLs can end in a suffix like `/Commercialization_roadmap.svg/size`, so take the last segment with an
    // extension rather than the last segment.
    const segments = decodeURIComponent(url.split("?")[0]!).split("/");
    return segments.findLast((segment) => segment.includes(".")) ?? segments.pop()!;
}

/** A `{scale=<percent>}` argument in an image caption, like `{scale=-35}` or `{scale = 20%}`. */
const SCALE_ARG = /\{\s*(?:scale|size)\s*=\s*([+-]?\d+(?:\.\d+)?)\s*%?\s*\}/i;

/**
 * Splits an image caption into its alt text and the percentage scale given by a {@link SCALE_ARG}, defaulting to 0.
 */
export function parseImageCaption(
    block: ImageBlockObjectResponse,
    ctx: ConvertContext,
): { alt: string; scale: number } {
    const caption = asPlainText(block.image.caption);
    const match = SCALE_ARG.exec(caption);
    if (!match && /\{\s*scale/i.test(caption))
        new ExporterError(`Image scaling argument should look like {scale=20} or {scale=-35%}.`, [
            "malformed content",
        ]).warn(blockContext(ctx, block));

    return { alt: caption.replace(SCALE_ARG, "").trim(), scale: match ? Number(match[1]) : 0 };
}

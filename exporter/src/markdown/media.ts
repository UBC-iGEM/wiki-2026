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

/** A `{...}` group of arguments in an image caption, like `{scale=20}` or `{scale=-35%, align=centre}`. */
const CAPTION_ARGS = /\{([^{}]*)\}/g;

/** A `scale=<percent>` argument, like `scale=-35` or `size = 20%`. */
const SCALE_ARG = /^(?:scale|size)\s*=\s*([+-]?\d+(?:\.\d+)?)\s*%?$/i;

/** An `align=left|centre|center` argument. */
const ALIGN_ARG = /^(?:align|alignment)\s*=\s*(left|centre|center)$/i;

export interface ImageCaption {
    alt: string;
    /** The percentage scale given by a {@link SCALE_ARG}, defaulting to 0. */
    scale: number;
    /** The alignment given by an {@link ALIGN_ARG}, defaulting to left. Only standalone images use it. */
    align: "left" | "center";
}

/**
 * Splits an image caption into its alt text and the arguments in its {@link CAPTION_ARGS} groups. Arguments are
 * separated by commas, and each must be a {@link SCALE_ARG} or an {@link ALIGN_ARG}; anything else is warned about and
 * ignored.
 */
export function parseImageCaption(block: ImageBlockObjectResponse, ctx: ConvertContext): ImageCaption {
    const caption = asPlainText(block.image.caption);
    const parsed: ImageCaption = { alt: caption.replace(CAPTION_ARGS, "").trim(), scale: 0, align: "left" };

    const args = [...caption.matchAll(CAPTION_ARGS)].flatMap((group) => group[1]!.split(","));
    for (const arg of args.map((arg) => arg.trim()).filter((arg) => arg !== "")) {
        const scale = SCALE_ARG.exec(arg);
        const align = ALIGN_ARG.exec(arg);
        if (scale) parsed.scale = Number(scale[1]);
        else if (align) parsed.align = align[1]!.toLowerCase() === "left" ? "left" : "center";
        else
            new ExporterError(
                `Unknown image argument {${arg}} was ignored; expected one like {scale=-35%} or {align=centre}.`,
                ["malformed content"],
            ).warn(blockContext(ctx, block));
    }

    return parsed;
}

import { $unsafe, ExporterError, isErr, type ExporterResult } from "./utils";
import axios from "axios";
import heicConvert from "heic-convert";
import mime from "mime-types";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";

const AVIF_OPTIONS = {
    quality: 70,
    effort: 4,
    lossless: false,
    chromaSubsampling: "4:2:0" as const,
};

const HEIC_EXTENSION_PATTERN = /\.hei[cf]$/i;

// Workaround from Sharp's native HEIC decorder: using heic-convert for HEIC -> JPEG first
async function convertHeicToAvifViaFallback(input_path: string, output_path: string): Promise<void> {
    const input_buffer = await readFile(input_path);
    const jpeg_buffer = await heicConvert({ buffer: input_buffer, format: "JPEG", quality: 1 });
    await sharp(Buffer.from(jpeg_buffer)).avif(AVIF_OPTIONS).toFile(output_path);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const timeout_promise = new Promise<never>((_executor, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });

    try {
        return await Promise.race([promise, timeout_promise]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function convertToAvif(input_path: string, output_path: string): Promise<ExporterResult<void>> {
    try {
        await sharp(input_path).avif(AVIF_OPTIONS).toFile(output_path);
    } catch (error) {
        if (HEIC_EXTENSION_PATTERN.test(input_path)) {
            try {
                await convertHeicToAvifViaFallback(input_path, output_path);
                return;
            } catch (fallback_error) {
                return new ExporterError(
                    `Failed to convert HEIC image at ${input_path} to AVIF format, including via the heic-convert fallback.`,
                    ["igem tools server", "notion server"],
                    fallback_error instanceof Error ? fallback_error : new Error(String(fallback_error)),
                );
            }
        }

        return new ExporterError(
            `Failed to convert image at ${input_path} to AVIF format.`,
            ["igem tools server", "notion server"],
            error instanceof Error ? error : new Error(String(error)),
        );
    }
}

export async function downloadToTempFile({
    url,
    uid,
    extension_hint,
}: {
    url: string;
    uid: string;
    /** Force the temp file's extension instead of inferring it from the response content-type. */
    extension_hint?: string;
}): Promise<ExporterResult<{ file_path: string; content_type: string; cleanup: () => Promise<void> }>> {
    const temp_dir = await mkdtemp(nodePath.join(tmpdir(), "igem-download-"));
    const cleanup = async (): Promise<void> => {
        await rm(temp_dir, { recursive: true, force: true });
    };

    const response = await $unsafe(
        async () =>
            await axios.get(url, {
                responseType: "stream",
                timeout: 30000,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            }),
    );
    if (isErr(response)) {
        await cleanup();
        return new ExporterError(
            `Failed to retrieve data from url "${url}".`,
            ["igem tools server", "notion server"],
            response,
        );
    }

    const content_type =
        typeof response.headers["content-type"] === "string"
            ? response.headers["content-type"].split(";")[0]!
            : "image/jpeg";
    const file_extension = extension_hint || mime.extension(content_type) || "jpg";
    const file_path = nodePath.join(temp_dir, `${uid}.${file_extension}`);

    try {
        await withTimeout(pipeline(response.data, createWriteStream(file_path)), 30000, `Download ${uid}`);
    } catch (error) {
        await cleanup();
        return new ExporterError(
            `Failed to download data from url "${url}".`,
            ["igem tools server", "notion server"],
            error instanceof Error ? error : new Error(String(error)),
        );
    }

    return { file_path, content_type, cleanup };
}

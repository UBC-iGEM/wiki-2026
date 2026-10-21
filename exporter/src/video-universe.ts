import { $unsafe, ExporterError, isErr, type ExporterResult } from "./utils";
import axios from "axios";

/**
 * Reading a video's details from iGEM Video Universe (a PeerTube instance) at export time.
 */

export const VIDEO_UNIVERSE = "https://video.igem.org";

/** The path of a watch or embed link, holding the video's UUID or its short ID: `/w/<id>`, `/videos/watch/<id>` or `/videos/embed/<id>`. */
const VIDEO_PATH_PATTERN = /^\/(?:w|videos\/(?:watch|embed))\/([\w-]+)\/?$/;

export interface VideoInfo {
    uuid: string;
    name: string;
    /** In seconds. */
    duration: number;
    /** Width over height. */
    aspect_ratio: number;
    /** The full-size preview image on Video Universe. */
    poster_url: string;
}

/**
 * Pull the video's ID out of a Video Universe link, or nothing if it is not one.
 * Only the path is read, so a share link's `?openModal=share` or a `#t=30` timestamp is dropped.
 */
export function parseVideoId(link: string): string | undefined {
    // Pasted as bare text, a link may have lost its scheme
    const href = /^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`;
    if (!URL.canParse(href)) return undefined;
    const url = new URL(href);
    if (url.hostname !== new URL(VIDEO_UNIVERSE).hostname) return undefined;
    return VIDEO_PATH_PATTERN.exec(url.pathname)?.[1];
}

/**
 * Fetch a video's details.
 * The ID comes from {@link parseVideoId}, so only Video Universe is ever requested.
 */
export async function fetchVideo(video_id: string): Promise<ExporterResult<VideoInfo>> {
    const response = await $unsafe(
        async () => await axios.get(`${VIDEO_UNIVERSE}/api/v1/videos/${video_id}`, { timeout: 30000 }),
    );
    if (isErr(response))
        return new ExporterError(
            `Could not find the Video Universe video ${video_id}. Check that it is public and the link is correct.`,
            ["igem video server"],
            response,
        );

    const video = response.data as Partial<{
        uuid: string;
        name: string;
        duration: number;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aspectRatio: number | null;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        previewPath: string;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        thumbnailPath: string;
    }>;
    const poster_path = video.previewPath ?? video.thumbnailPath;
    if (!video.uuid || !poster_path)
        return new ExporterError(`The Video Universe video ${video_id} did not come back as a video.`, [
            "igem video server",
            "bug?",
        ]);

    return {
        uuid: video.uuid,
        name: video.name ?? "",
        duration: video.duration ?? 0,
        // Older uploads have no ratio recorded, and are almost all 16:9
        aspect_ratio: video.aspectRatio || 16 / 9,
        poster_url: `${VIDEO_UNIVERSE}${poster_path}`,
    };
}

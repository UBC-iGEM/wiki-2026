import { $unsafe, ExporterError, isErr, type ExporterResult } from "./utils";
import axios from "axios";

/**
 * Reading a video's details from iGEM Video Universe (a PeerTube instance) at export time.
 */

export const VIDEO_UNIVERSE = "https://video.igem.org";

/** The path of a watch or embed link, holding the video's UUID or its short ID: `/w/<id>`, `/videos/watch/<id>` or `/videos/embed/<id>`. */
const VIDEO_PATH_PATTERN = /^\/(?:w|videos\/(?:watch|embed))\/([\w-]+)\/?$/;

export interface VideoInfo {
    /** The video's UUID, or for a video still awaiting approval, the ID from its link. */
    uuid: string;
    /** Width over height. */
    aspect_ratio: number;
    /** Set when Video Universe is not yet showing the video, so its details are placeholders. */
    pending?: true;
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
    // Until approved, Video Universe hides a video from anyone signed out (as not found or not allowed),
    // so it is embedded by the ID in its link, and the embed plays it once approved
    if (isErr(response) && axios.isAxiosError(response) && [401, 403, 404].includes(response.response?.status ?? 0))
        return { uuid: video_id, aspect_ratio: 16 / 9, pending: true };
    if (isErr(response))
        return new ExporterError(
            `Could not reach Video Universe for the video ${video_id}.`,
            ["igem video server"],
            response,
        );

    const video = response.data as Partial<{
        uuid: string;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aspectRatio: number | null;
    }>;
    if (!video.uuid)
        return new ExporterError(`The Video Universe video ${video_id} did not come back as a video.`, [
            "igem video server",
            "bug?",
        ]);

    return {
        uuid: video.uuid,
        // Older uploads have no ratio recorded, and are almost all 16:9
        aspect_ratio: video.aspectRatio || 16 / 9,
    };
}

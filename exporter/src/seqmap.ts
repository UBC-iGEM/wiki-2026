import { $unsafeSync, ExporterError, isErr, type ExporterResult } from "./utils";
import { parseFile } from "seqparse";

/**
 * Reading GenBank files for the Seqmap component at export time.
 */

/** A parsed sequence, as passed to `seqviz`. */
export interface SeqmapSeq {
    name: string;
    seq: string;
    type: "dna" | "rna" | "aa";
    annotations: {
        name: string;
        /** 0-based, inclusive. */
        start: number;
        /** 0-based, exclusive. */
        end: number;
        /** 1 forward, -1 reverse, 0 neither. */
        direction: number;
        color?: string;
    }[];
}

/** Parse a GenBank file; only its first record is used. */
export function parseGenbank(text: string, file_name: string): ExporterResult<SeqmapSeq> {
    const records = $unsafeSync(() => parseFile(text, { fileName: file_name }));
    const parsed = isErr(records) ? records : records[0];
    if (parsed === undefined || isErr(parsed))
        return new ExporterError(`"${file_name}" is not a readable GenBank file.`, ["malformed content"], parsed);
    if (parsed.seq === "") return new ExporterError(`"${file_name}" has no sequence.`, ["malformed content"]);

    return {
        name: parsed.name,
        seq: parsed.seq,
        type: parsed.type === "unknown" ? "dna" : parsed.type,
        annotations: parsed.annotations.map(({ name, start, end, direction, color }) => ({
            name,
            start,
            end,
            direction: direction ?? 0,
            ...(color ? { color } : {}),
        })),
    };
}

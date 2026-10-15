import { CONFIG } from "./config";
import { convertToAvif, downloadToTempFile } from "./media";
import { $unsafe, ExporterError, isErr, isExporterErr, type ExporterResult, type Result } from "./utils";
import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import FormData from "form-data";
import mime from "mime-types";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import * as nodePath from "node:path";
import { CookieJar } from "tough-cookie";

interface UploadResult {
    file_name: string;
    key: string;
    location: string; // public CDN URL to reference in markdown
    content_type: string;
}

let CLIENT_PROMISE: Promise<ExporterResult<ToolsClient>> | null = null;
const ASSETS_FOLDER = "assets";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Public interface to a singleton `ToolsClient` interface.
 */
export async function getToolsClient(): Promise<ExporterResult<ToolsClient>> {
    if (CLIENT_PROMISE) return CLIENT_PROMISE;

    CLIENT_PROMISE = (async (): Promise<ExporterResult<ToolsClient>> => {
        const { IGEM_TOOLS_USERNAME: username, IGEM_TOOLS_PASSWORD: password } = process.env;

        if (!username || !password) {
            new ExporterError(
                "The environment variable IGEM_TOOLS_USERNAME or IGEM_TOOLS_PASSWORD is unset. The exporter has not been configured with the necessary credentials.",
                ["exporter configuration", "igem tools server"],
            ).logAndQuit();
        }

        const tools_client_res = await ToolsClient.withAuthentication({
            username: username!,
            password: password!,
            team_id: CONFIG.team_id,
        });
        if (isErr(tools_client_res))
            return new ExporterError(
                "Failed to authenticate with the iGEM Tools API for uploading media.",
                ["igem tools server"],
                tools_client_res,
            );

        return tools_client_res;
    })();

    return CLIENT_PROMISE;
}

class ToolsClient {
    private client: AxiosInstance;
    private uploaded_asset_names_promise: Promise<ExporterResult<Set<string>>> | null = null;

    private constructor(private team_id: string) {
        // Internally holds a cookie store so we don't need to constantly re-authenticate our session
        const jar = new CookieJar();
        this.client = wrapper(
            axios.create({
                jar,
                withCredentials: true,
                baseURL: "https://api.igem.org/v1",
            }),
        );
        this.team_id = team_id;
    }

    public static async withAuthentication({
        username,
        password,
        team_id,
    }: {
        username: string;
        password: string;
        team_id: string;
    }): Promise<Result<ToolsClient>> {
        const instance = new ToolsClient(team_id);

        const params = new URLSearchParams({
            identifier: username,
            password,
        });

        const post_res = await $unsafe(
            async () => await instance.client.post("/auth/sign-in", params, { timeout: 30000 }),
        );
        if (isErr(post_res)) return post_res;

        return instance;
    }

    // Simple upload function to igem CDN. No specific directory specified yet.
    public async upload({
        uid,
        url,
        original_file,
    }: {
        uid: string;
        url: string;
        original_file?: { file_name: string };
    }): Promise<ExporterResult<UploadResult>> {
        const folder_name = ASSETS_FOLDER;

        const final_extension = original_file
            ? nodePath.extname(original_file.file_name).toLowerCase().slice(1)
            : "avif";
        if (original_file && !final_extension)
            return new ExporterError(
                `Failed to upload asset with UID ${uid}: the original filename has no extension.`,
                ["malformed content"],
            );

        const final_filename = `${uid}.${final_extension}`;
        const content_type = original_file
            ? mime.contentType(final_filename) || "application/octet-stream"
            : "image/avif";
        const expected_public_url = `https://static.igem.wiki/teams/${this.team_id}/wiki/${folder_name}/${final_filename}`;

        const already_uploaded = await this.alreadyUploaded({ folder_name, file_name: final_filename });

        if (isExporterErr(already_uploaded)) return already_uploaded;

        if (already_uploaded) {
            return {
                file_name: final_filename,
                key: `${folder_name}/${final_filename}`,
                location: expected_public_url,
                content_type,
            };
        }

        // Get source stream from url/notion
        const download_res = await downloadToTempFile({
            url,
            uid,
            extension_hint: original_file ? final_extension : undefined,
        });
        if (isExporterErr(download_res)) return download_res;

        const { file_path: temp_file_path, cleanup } = download_res;

        // Remove the temporary files however the upload ends
        try {
            let upload_file_path = temp_file_path;
            if (!original_file) {
                const avif_temp_file_path = nodePath.join(nodePath.dirname(temp_file_path), final_filename);
                const convert_res = await convertToAvif(temp_file_path, avif_temp_file_path);
                if (isExporterErr(convert_res)) return convert_res;

                const avif_temp_file_stat = await $unsafe(async () => await stat(avif_temp_file_path));
                if (isErr(avif_temp_file_stat))
                    return new ExporterError(
                        `Failed to read the converted image for asset with UID ${uid}.`,
                        ["bug?"],
                        avif_temp_file_stat,
                    );

                if (avif_temp_file_stat.size > MAX_UPLOAD_BYTES)
                    return new ExporterError(
                        `Image was not uploaded: compressed AVIF is ${avif_temp_file_stat.size} bytes, which is larger than the ${MAX_UPLOAD_BYTES} byte limit.`,
                        ["igem tools server"],
                    );

                upload_file_path = avif_temp_file_path;
            }

            // build data
            // Make POST request to igem api endpoint
            // /websites/teams/{teamId}?directory={folderName}
            const post_res = await $unsafe(async () => {
                const form_data = new FormData();
                form_data.append("file", createReadStream(upload_file_path), {
                    filename: final_filename,
                    contentType: content_type,
                });

                return await this.client.post(
                    `/teams/${this.team_id}/repositories/${CONFIG.repo_uuid}/files`,
                    form_data,
                    {
                        params: { directory: folder_name },
                        headers: form_data.getHeaders?.(),
                        timeout: 60000,
                        maxBodyLength: Infinity,
                        maxContentLength: Infinity,
                    },
                );
            });
            if (isErr(post_res))
                return new ExporterError(`Failed to upload asset with UID ${uid}.`, ["igem tools server"], post_res);

            const job_data = post_res.data?.data;
            const upload_key = job_data?.uploadKey; // e.g., "teams/6279/wiki/assets/test-img.avif"

            // return the upload result
            let public_url: string;
            if (upload_key) {
                public_url = `https://static.igem.wiki/${upload_key}`;
            } else {
                public_url = expected_public_url;
            }

            return {
                file_name: final_filename,
                key: `${folder_name}/${final_filename}`,
                location: public_url,
                content_type,
            };
        } finally {
            await cleanup();
        }
    }

    public async alreadyUploaded({
        folder_name,
        file_name,
    }: {
        folder_name: string;
        file_name: string;
    }): Promise<ExporterResult<boolean>> {
        const uploaded_names = await this.getUploadedAssetNames({ folder_name });

        if (isExporterErr(uploaded_names)) return uploaded_names;

        return uploaded_names.has(file_name);
    }

    /**
     * The cached names of files in `folder_name`, e.g. `0123abcd.avif`.
     *
     * Names include the extension, so a UID uploaded under a different format is uploaded again.
     */
    private async getUploadedAssetNames({
        folder_name,
    }: {
        folder_name: string;
    }): Promise<ExporterResult<Set<string>>> {
        if (this.uploaded_asset_names_promise) {
            return this.uploaded_asset_names_promise;
        }

        this.uploaded_asset_names_promise = (async (): Promise<ExporterResult<Set<string>>> => {
            const names = await this.listFiles(folder_name);
            if (isExporterErr(names)) return names;
            return new Set(names);
        })();

        const result = await this.uploaded_asset_names_promise;

        // If the GET failed, do not permanently cache the failed result.
        if (isExporterErr(result)) {
            this.uploaded_asset_names_promise = null;
        }

        return result;
    }

    /** The names of every file in the assets folder, e.g. `0123abcd.avif`. Not cached. */
    public listAssets(): Promise<ExporterResult<string[]>> {
        return this.listFiles(ASSETS_FOLDER);
    }

    private async listFiles(folder_name: string): Promise<ExporterResult<string[]>> {
        const response = await $unsafe(
            async () =>
                await this.client.get(`/teams/${this.team_id}/repositories/${CONFIG.repo_uuid}/files`, {
                    params: { directory: folder_name },
                    timeout: 30000,
                }),
        );
        if (isErr(response))
            return new ExporterError(`Failed to list the files in "${folder_name}".`, ["igem tools server"], response);

        const files: unknown = response.data?.files;
        if (!Array.isArray(files))
            return new ExporterError(`The file list for "${folder_name}" came back in an unexpected shape.`, [
                "igem tools server",
            ]);
        return files.map((file: { name: string }) => file.name);
    }

    /** Delete one file from the assets folder by name, e.g. `0123abcd.avif`. */
    public async deleteAsset(file_name: string): Promise<ExporterResult<void>> {
        const response = await $unsafe(
            async () =>
                await this.client.delete(
                    `/teams/${this.team_id}/repositories/${CONFIG.repo_uuid}/files/${encodeURIComponent(file_name)}`,
                    { params: { directory: ASSETS_FOLDER }, timeout: 30000 },
                ),
        );
        if (isErr(response))
            return new ExporterError(
                `Failed to delete "${ASSETS_FOLDER}/${file_name}".`,
                ["igem tools server"],
                response,
            );
    }
}

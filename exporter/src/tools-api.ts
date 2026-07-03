import { CONFIG } from "./config";
import type { PagePath } from "./map";
import { $unsafe, $withRetries, ExporterError, isErr, isExporterErr, type ExporterResult, type Result } from "./utils";
import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import FormData from "form-data";
import mime from "mime-types";
import { CookieJar } from "tough-cookie";

interface UploadResult {
    file_name: string;
    key: string;
    location: string; // public CDN URL to reference in markdown
    content_type: string;
}

let CLIENT_PROMISE: Promise<ExporterResult<ToolsClient>> | null = null;
const ASSETS_FOLDER = "assets";

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
    private uploadedAssetUidsPromise: Promise<ExporterResult<Set<string>>> | null = null;

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

        const post_res = await $withRetries($unsafe, async () => await instance.client.post("/auth/sign-in", params));
        if (isErr(post_res)) return post_res;

        return instance;
    }

    // Simple upload function to igem CDN. No specific directory specified yet.
    public async upload({
        uid,
        url,
        path,
    }: {
        uid: string;
        url: string;
        path: PagePath;
    }): Promise<ExporterResult<UploadResult>> {
        const folder_name = ASSETS_FOLDER;

        // accounting for server-side file extension auto-conversion
        const final_extension = "avif";
        const final_filename = `${uid}.${final_extension}`;
        const expected_public_url = `https://static.igem.wiki/teams/${this.team_id}/wiki/${folder_name}/${final_filename}`;

        const already_uploaded = await this.alreadyUploaded({
            folder_name,
            uid,
            path,
        });

        if (isExporterErr(already_uploaded)) return already_uploaded;

        if (already_uploaded) {
            console.log(`[image-upload] skipped existing ${uid} -> ${expected_public_url}`);

            return {
                file_name: final_filename,
                key: `${folder_name}/${final_filename}`,
                location: expected_public_url,
                content_type: "image/avif",
            };
        }

        // Get image stream from url/notion
        const response = await $withRetries($unsafe, async () => await axios.get(url, { responseType: "stream" }));
        if (isErr(response))
            return new ExporterError(
                `Failed to retrieve data from url "${url}" while attempting to upload asset on page "${path}" with UID ${uid}.`,
                ["igem tools server", "notion server"],
                response,
            );

        // Infer extension and content type
        const content_type = String(response.headers["content-type"]) || "image/jpeg";
        const file_extension = mime.extension(content_type) || "jpg";

        // build data
        const form_data = new FormData();
        form_data.append("file", response.data, `${uid}.${file_extension}`);

        // Make POST request to igem api endpoint
        // /websites/teams/{teamId}?directory={folderName}
        const post_res = await $withRetries(
            $unsafe,
            async () =>
                await this.client.post(
                    `/teams/${this.team_id}/repositories/${CONFIG.repo_uuid}/files`,
                    form_data,
                    {
                        params: { directory: folder_name },
                        headers: form_data.getHeaders?.(),
                    }),
        );
        if (isErr(post_res))
            return new ExporterError(
                `Failed to upload asset on page "${path}" with UID ${uid}.`,
                ["igem tools server"],
                post_res,
            );
        
        const job_data = post_res.data?.data;
        const upload_key = job_data?.uploadKey; // e.g., "teams/6279/wiki/assets/test-img.avif"

        // return the upload result
        let public_url: string;
        if (upload_key) {
            public_url = `https://static.igem.wiki/${upload_key}`;
        } else {
            public_url = expected_public_url;
        }

        console.log(`[image-upload] uploaded ${uid} -> ${public_url}`);
        
        return {
            file_name: final_filename,
            key: `${folder_name}/${final_filename}`,
            location: public_url,
            content_type: "image/avif",
        };
    }

    public async alreadyUploaded({
        folder_name,
        uid,
        path,
    }: {
        folder_name: string;
        uid: string;
        path: PagePath;
    }): Promise<ExporterResult<boolean>> {
        const uploaded_uids = await this.getUploadedAssetUids({
            folder_name,
            path,
        });

        if (isExporterErr(uploaded_uids)) return uploaded_uids;

        return uploaded_uids.has(uid);
    }

    // assumes UID == filename excluding file extension
    private getUidFromRemoteFile(file: any): string | null {
        const file_name =
            file.name ??
            file.key?.split("/").pop() ??
            file.uploadKey?.split("/").pop() ??
            "";

        if (!file_name) return null;

        const dot_index = file_name.lastIndexOf(".");

        if (dot_index === -1) {
            return file_name;
        }

        return file_name.slice(0, dot_index);
    }
    

    // Make GET request to igem api endpoint to retrieve list of files in a directory
    private async getUploadedAssetUids({
        folder_name,
        path,
    }: {
        folder_name: string;
        path: PagePath;
    }): Promise<ExporterResult<Set<string>>> {
        if (this.uploadedAssetUidsPromise) {
            return this.uploadedAssetUidsPromise;
        }

        this.uploadedAssetUidsPromise = (async (): Promise<ExporterResult<Set<string>>> => {
            const response = await $withRetries(
                $unsafe,
                async () =>
                    await this.client.get(`/teams/${this.team_id}/repositories/${CONFIG.repo_uuid}/files`, {
                        params: { directory: folder_name },
                    }),
            );

            if (isErr(response))
                return new ExporterError(
                    `Failed to retrieve uploaded asset list for folder "${folder_name}" while exporting page "${path}".`,
                    ["igem tools server"],
                    response,
                );

            const files = Array.isArray(response.data)
                ? response.data
                : Array.isArray(response.data?.files)
                ? response.data.files
                : Array.isArray(response.data?.data)
                    ? response.data.data
                    : [];

            const uploaded_uids = new Set<string>();

            for (const file of files) {
                const uid = this.getUidFromRemoteFile(file);
                if (uid) uploaded_uids.add(uid);
            }

            console.log(`[image-upload] loaded ${uploaded_uids.size} existing asset UID(s) from ${folder_name}`);

            return uploaded_uids;
        })();

        const result = await this.uploadedAssetUidsPromise;

        // If the GET failed, do not permanently cache the failed result.
        if (isExporterErr(result)) {
            this.uploadedAssetUidsPromise = null;
        }

        return result;
    }
}

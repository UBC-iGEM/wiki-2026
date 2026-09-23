import baseConfig from "../eslint.config";
import eslintPluginAstro from "eslint-plugin-astro";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([...baseConfig, globalIgnores(["dist/**"]), ...eslintPluginAstro.configs.recommended]);

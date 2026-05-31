import baseConfig from "../eslint.config";
import eslintPluginAstro from "eslint-plugin-astro";
import { defineConfig } from "eslint/config";

export default defineConfig([...baseConfig, ...eslintPluginAstro.configs.recommended]);

import { registerHooks } from "node:module";
import { resolve } from "./ts-from-js-loader.mjs";

registerHooks({ resolve });

import config from "../postcss.config.mjs";

// Next loads PostCSS config from the project directory, which is pages-app for
// the static export, so the root Tailwind setup is re-exported rather than
// duplicated. One place defines the pipeline.
export default config;

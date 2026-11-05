import { mergeConfig } from "vitest/config";
import BuiltSequencer from "../../gate/ci-built-sequencer.mjs";
import config from "./vitest.config.mjs";

export default mergeConfig(config, {
	test: { sequence: { sequencer: BuiltSequencer } },
});

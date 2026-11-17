import { requestRecipeStorage } from "./recipe-offline.mjs";

export async function saveRecipeOffline(
	id,
	release = document.querySelector("#site-update-notice")?.dataset.release,
) {
	const result = await requestRecipeStorage({
		type: "SAVE_RECIPE",
		id,
		release,
	});
	window.dispatchEvent(new CustomEvent("recipe-saved", { detail: result }));
	return result;
}

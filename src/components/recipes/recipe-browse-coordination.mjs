// All participating tabs finish their browse responses before an outgoing
// worker is retired. A new browse request waits until activation is verified.
export const RECIPE_BROWSE_LOCK = "recipe-browse-activation";

export const withRecipeBrowse = (signal, operation) =>
	navigator.locks.request(
		RECIPE_BROWSE_LOCK,
		{ mode: "shared", signal },
		operation,
	);

export const withRecipeActivation = (operation) =>
	navigator.locks.request(RECIPE_BROWSE_LOCK, operation);

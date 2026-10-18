import type { InferGetStaticPropsType } from "astro";
import data from "../../../../components/recipes/recipe-data.server.mjs";
import { buildReleaseSha } from "../../../../lib/build-release.js";

export function getStaticPaths() {
	return data.recipes.map((recipe) => ({
		params: { id: recipe.id },
		props: { recipe },
	}));
}

type Props = InferGetStaticPropsType<typeof getStaticPaths>;
export function GET({ props }: { props: Props }) {
	return Response.json({
		schemaVersion: 1,
		releaseId: buildReleaseSha(),
		recipe: props.recipe,
	});
}

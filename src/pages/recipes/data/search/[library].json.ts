import { buildBrowseSearch } from "../../../../components/recipes/recipe-browse-library.server.mjs";
import data from "../../../../components/recipes/recipe-data.server.mjs";
import { buildReleaseSha } from "../../../../lib/build-release.js";

export function getStaticPaths() {
	const release = buildReleaseSha();
	return [{ params: { library: `index-${release}` }, props: { release } }];
}

export function GET({ props }: { props: { release: string } }) {
	return Response.json(buildBrowseSearch(data.recipes, props.release));
}

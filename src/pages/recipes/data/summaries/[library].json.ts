import { buildBrowseLibrary } from "../../../../components/recipes/recipe-browse-library.server.mjs";
import data from "../../../../components/recipes/recipe-data.server.mjs";
import { buildReleaseSha } from "../../../../lib/build-release.js";

export function getStaticPaths() {
	const release = buildReleaseSha();
	return [{ params: { library: `library-${release}` }, props: { release } }];
}

export function GET({ props }: { props: { release: string } }) {
	return Response.json(buildBrowseLibrary(data.recipes, props.release));
}

import { createServer } from "node:http";

// Forward the real fixture unchanged, withholding only the final bytes of one
// real browse response. Headers arriving alone must not release the shared lock.
export async function streamBrowseResponse(
	origin,
	hold = (url) => url.searchParams.has("heldBody"),
) {
	const started = Promise.withResolvers();
	const body = Promise.withResolvers();
	const requests = [];
	const errors = [];
	const server = createServer(async (request, response) => {
		requests.push(request.url);
		try {
			const upstream = await fetch(`${origin}${request.url}`, {
				headers: request.headers,
			});
			const bytes = Buffer.from(await upstream.arrayBuffer());
			response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
			if (hold(new URL(request.url, origin))) {
				const split = Math.floor(bytes.length / 2);
				response.write(bytes.subarray(0, split));
				started.resolve({
					status: upstream.status,
					body: JSON.parse(bytes.toString("utf8")),
				});
				await body.promise;
				response.end(bytes.subarray(split));
			} else response.end(bytes);
		} catch (error) {
			errors.push(error);
			response.destroy(error);
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		origin: `http://127.0.0.1:${server.address().port}`,
		started: started.promise,
		release: () => body.resolve(),
		requests,
		errors,
		close: () => {
			body.resolve();
			server.closeAllConnections();
			return new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

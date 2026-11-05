declare const self: SharedWorkerGlobalScope;
const worker = self;
worker.onconnect = (event) => {
	const port = event.ports[0];
	if (!port) throw new Error("Missing SharedWorker message port");
	const target = new URL(worker.location.href).searchParams.get("target");
	if (!target) throw new Error("Missing loopback sentinel URL");
	fetch(target)
		.then((r) => r.text())
		.then(
			(value) => port.postMessage(value),
			() => port.postMessage("denied"),
		);
};

export {};

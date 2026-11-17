declare const self: DedicatedWorkerGlobalScope;
const worker = self;
const target = new URL(worker.location.href).searchParams.get("target");
if (!target) throw new Error("Missing loopback sentinel URL");
fetch(target)
	.then((r) => r.text())
	.then(
		(value) => worker.postMessage(value),
		() => worker.postMessage("denied"),
	);

export {};

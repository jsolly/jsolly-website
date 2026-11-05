export type Phase =
	| "context:create:before"
	| "context:create:after"
	| "page:create:before"
	| "page:create:after"
	| "goto:before"
	| "goto:after"
	| "card-count:before"
	| "card-count:after"
	| "deferred-count:before"
	| "deferred-count:after"
	| "scroll:before"
	| "scroll:after"
	| "natural-width:before"
	| "natural-width:after"
	| "loading:before"
	| "loading:after"
	| "grid-text:before"
	| "grid-text:after"
	| "context:close:before"
	| "context:close:after";
export type Fields = Record<string, string | number | boolean | null>;
export interface Observation {
	atMs: number;
	javaScriptEnabled: boolean | null;
	kind: string;
	fields: Fields;
}
export interface PendingRequest {
	javaScriptEnabled: boolean;
	url: string;
	method: string;
	resourceType: string;
}
export interface Truncation {
	eventsDropped: number;
	pendingDropped: number;
	stringsClipped: number;
	textUnitsOmitted: number;
	outputPacketsClipped: number;
	outputBytesOmitted: number;
}

export interface CurrentPhase {
	javaScriptEnabled: boolean;
	stage: Phase;
}

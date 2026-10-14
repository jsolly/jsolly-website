import assert from "node:assert/strict";
import { it } from "node:test";
import { cookingNotes } from "./cooking-notes.mjs";

it("keeps ingredient state while removing nutrition import commentary", () => {
	assert.equal(
		cookingNotes(
			"raw; skinless · Optional; excluded or included as stated in the publisher nutrition.",
		),
		"raw · skinless",
	);
});
it("keeps cooking quantities and package guidance", () => {
	const note =
		"Beat egg and weigh 25 g. Keep liquid at 375 mL minimum. · drained · shelf-stable";
	assert.equal(
		cookingNotes(note),
		"Beat egg and weigh 25 g. · Keep liquid at 375 mL minimum. · drained · shelf-stable",
	);
});
it("removes conversion provenance without losing the ingredient state", () => {
	assert.equal(
		cookingNotes(
			"skinless, boneless; cut into 1-inch pieces · (450g) is the source parenthetical; original US quantity controls.",
		),
		"skinless, boneless · cut into 1-inch pieces",
	);
});
it("retains nutrition references that actually specify cooking quantities", () => {
	const note =
		"Nutrition serving description gives 4–5 lettuce leaves per serving; method gives no total amount.";
	assert.equal(
		cookingNotes(note),
		"Nutrition serving description gives 4–5 lettuce leaves per serving · method gives no total amount.",
	);
	assert.equal(
		cookingNotes(
			"skinless, boneless · Source says 3–6 thighs; three chosen for its three-serving yield.",
		),
		"skinless, boneless",
	);
	assert.equal(
		cookingNotes("source suggests celery, onion and lemon wedges"),
		"Use celery, onion and lemon wedges",
	);
	assert.equal(
		cookingNotes(
			"Source method allows up to 1 tablespoon olive oil OR unmeasured nonstick spray.",
		),
		"Use up to 1 tablespoon olive oil OR unmeasured nonstick spray.",
	);
	assert.equal(
		cookingNotes("Choose fully cooked smoked sausage for source timing."),
		"Choose fully cooked smoked sausage.",
	);
});

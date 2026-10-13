// Import decisions belong in provenance, rather than beside cooking inputs.
const IMPORT_NOTE =
	/(?:not counted in nutrition|included in this estimate|excluded or included as stated in the publisher nutrition|is the source parenthetical; original US quantity controls|^Source quantity range .* (?:lower endpoint chosen explicitly|lower value selected for scaling)|^Unquantified amount remains unknown, not zero|^Added from (?:the )?source method|^Ingredient recovered from the source method|^Source misspells tablespoons)/iu;
const SENTENCES = /(?<=\.)\s+(?=[A-Z(])/u;
export function cookingNotes(state) {
	return state
		.split(" · ")
		.flatMap((part) => part.split(SENTENCES))
		.filter((part) => !IMPORT_NOTE.test(part))
		.join(" · ");
}

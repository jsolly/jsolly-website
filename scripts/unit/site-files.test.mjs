import assert from "node:assert/strict";
import it from "node:test";
import { securityTxtProblems } from "../site-files.mjs";

// The security.txt check behind both hosts' tests, fed realistic broken
// files. Each case starts from the shape jsolly.com ships and breaks one thing.
const COMMITTED = "2026-10-05T20:31:00-04:00";
const EXPECTED = {
	contact: "https://www.jsolly.com/contact/",
	"preferred-languages": "en",
	canonical: "https://www.jsolly.com/.well-known/security.txt",
};

function file({
	contact = "Contact: https://www.jsolly.com/contact/",
	expires = "Expires: 2027-09-01T00:00:00.000Z",
	canonical = "Canonical: https://www.jsolly.com/.well-known/security.txt",
	extra = [],
} = {}) {
	return [
		"# Report security issues through the contact form.",
		contact,
		expires,
		"Preferred-Languages: en",
		canonical,
		...extra,
		"",
	]
		.filter((line) => line !== null)
		.join("\n");
}

it("a security.txt that is expired, too long-lived, unparseable or pointing elsewhere is rejected with the reason", () => {
	assert.deepEqual(
		securityTxtProblems(file(), EXPECTED, { committed: COMMITTED }),
		[],
		"the shipped shape passes",
	);
	const cases = [
		{
			name: "expired before the commit",
			text: file({ expires: "Expires: 2026-09-01T00:00:00.000Z" }),
			problem:
				"Expires 2026-09-01T00:00:00.000Z is not after 2026-10-05T20:31:00-04:00",
		},
		{
			name: "a year or more out",
			text: file({ expires: "Expires: 2027-10-06T00:31:00Z" }),
			problem:
				"Expires 2027-10-06T00:31:00Z is 365 days or more after 2026-10-05T20:31:00-04:00",
		},
		{
			name: "a date without a time or offset",
			text: file({ expires: "Expires: 2027-09-01" }),
			problem: 'Expires is ["2027-09-01"], not one RFC 3339 time',
		},
		{
			name: "Expires given twice",
			text: file({ extra: ["Expires: 2027-08-01T00:00:00.000Z"] }),
			problem:
				'Expires is ["2027-09-01T00:00:00.000Z","2027-08-01T00:00:00.000Z"], not one RFC 3339 time',
		},
		{
			name: "no Contact",
			text: file({ contact: null }),
			problem: 'contact is [], not ["https://www.jsolly.com/contact/"]',
		},
		{
			name: "the old blog's mailbox as Contact",
			text: file({ contact: "Contact: mailto:john@blogthedata.com" }),
			problem:
				'contact is ["mailto:john@blogthedata.com"], not ["https://www.jsolly.com/contact/"]',
		},
		{
			name: "the other host's Canonical",
			text: file({
				canonical:
					"Canonical: https://www.blogthedata.com/.well-known/security.txt",
			}),
			problem:
				'canonical is ["https://www.blogthedata.com/.well-known/security.txt"], not ["https://www.jsolly.com/.well-known/security.txt"]',
		},
		{
			name: "a line that is not a field",
			text: file({ extra: ["Contact https://www.jsolly.com/contact/"] }),
			problem: 'line "Contact https://www.jsolly.com/contact/" is not a field',
		},
	];
	for (const { name, text, problem } of cases) {
		assert.deepEqual(
			securityTxtProblems(text, EXPECTED, { committed: COMMITTED }),
			[problem],
			name,
		);
	}
});

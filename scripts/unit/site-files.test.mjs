import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "vitest";
import {
	fieldLines,
	fieldValues,
	headCommitDate,
	securityTxtProblems,
} from "../../build/site-files.mjs";

// The security.txt check behind both hosts' tests, fed realistic broken
// files (each case starts from the shape jsolly.com ships and breaks one
// thing), and jsolly.com's shipped file.
const SECURITY_TXT = new URL(
	"../../public/.well-known/security.txt",
	import.meta.url,
);
const LEGACY_SECURITY_TXT = new URL(
	"../../legacy/blogthedata/public/.well-known/security.txt",
	import.meta.url,
);
const COMMITTED = "2026-10-05T20:31:00-04:00";
const BAD_COMMIT_DATE = /committed "" is not a time/u;
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

it("a security.txt that is expired, too long-lived, impossible, unparseable, carrying an extra field or pointing elsewhere is rejected with the reason", () => {
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
			name: "month 13",
			text: file({ expires: "Expires: 2027-13-01T00:00:00Z" }),
			problem: "Expires 2027-13-01T00:00:00Z is not a valid time",
		},
		{
			name: "hour 25",
			text: file({ expires: "Expires: 2027-09-01T25:00:00Z" }),
			problem: "Expires 2027-09-01T25:00:00Z is not a valid time",
		},
		{
			name: "February 30, which Date.parse rolls into March",
			text: file({ expires: "Expires: 2027-02-30T00:00:00Z" }),
			problem: "Expires 2027-02-30T00:00:00Z is not a valid time",
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
			name: "the expired PGP key offered as Encryption",
			text: file({ extra: ["Encryption: https://www.jsolly.com/pgp-key.txt"] }),
			problem:
				"unexpected field encryption: https://www.jsolly.com/pgp-key.txt",
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
	assert.throws(
		() => securityTxtProblems(file(), EXPECTED, { committed: "" }),
		BAD_COMMIT_DATE,
		"an unreadable commit date fails loudly instead of passing",
	);
});

it("security researchers on jsolly.com get a valid, unexpired security.txt that expires with the old host's", () => {
	const text = readFileSync(SECURITY_TXT, "utf8");
	assert.deepEqual(
		securityTxtProblems(text, EXPECTED, { committed: headCommitDate() }),
		[],
	);
	// One yearly bump moves both hosts' Expires together.
	assert.deepEqual(
		fieldValues(fieldLines(text).fields, "expires"),
		fieldValues(
			fieldLines(readFileSync(LEGACY_SECURITY_TXT, "utf8")).fields,
			"expires",
		),
	);
});

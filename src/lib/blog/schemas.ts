import { z } from "zod";
import { DEFAULT_IMAGE } from "./constants.js";

const SLUG = /^[A-Za-z0-9_-]+$/u;

const slug = z.string().regex(SLUG);
const timestamp = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

// legacyId, legacyImage and legacyAuthorId stay in the frontmatter as
// unmanaged PagesCMS data; the default object schema strips them (J19).
export const postSchema = z.object({
	slug,
	title: z.string().min(1),
	category: slug,
	description: z.string(),
	draft: z.boolean().default(true),
	image: z.string().default(DEFAULT_IMAGE),
	imageAlt: z.string().default(""),
	imageAttribution: z.string().default(""),
	imageWidth: z.number().int().positive().nullable().default(null),
	imageHeight: z.number().int().positive().nullable().default(null),
	published: timestamp,
	updated: timestamp,
	author: z.string().default("John Solly"),
	feedAuthor: z.string().default("John_Solly"),
	excerpt: z.string().default(""),
	related: z.array(slug).default([]),
});

export const categorySchema = z.object({
	slug,
	name: z.string().min(1),
	description: z.string(),
});

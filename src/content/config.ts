import { defineCollection, z } from "astro:content";

const projectsCollection = defineCollection({
	type: "content",
	schema: ({ image }) =>
		z.object({
			title: z.string().min(1, "Title is required"),
			metaimg: image().refine(
				(img) => img !== undefined,
				"Meta image is required",
			),
			metaimgAlt: z.string().min(1, "Meta image alt text is required"),
			metaimgWidth: z.number().positive("Meta image width must be positive"),
			metaimgHeight: z.number().positive("Meta image height must be positive"),
			snippet: z.string().min(1, "Snippet is required"),
			logos: z
				.array(
					z.object({
						url: image().refine(
							(img) => img !== undefined,
							"Logo image is required",
						),
						alt: z.string().min(1, "Logo alt text is required"),
						label: z.string().optional(),
					}),
				)
				.optional(),
		}),
});

export const collections = {
	projects: projectsCollection,
};

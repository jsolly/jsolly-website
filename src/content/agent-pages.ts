const PAGES: Record<string, (origin: string) => string> = {
	"/": homeMarkdown,
	"/about": aboutMarkdown,
	"/contact": contactMarkdown,
	"/privacy": privacyMarkdown,
};

export function markdownForPath(
	pathname: string,
	origin: string,
): string | undefined {
	const render = PAGES[pathname];
	return render?.(origin);
}

export function maintenanceMarkdown(origin: string): string {
	return `# Maintenance

jsolly.com is temporarily offline for maintenance. There is no product API. Try again later, or check [${origin}/](${origin}/) for the HTML status page.
`;
}

export function notFoundMarkdown(origin: string): string {
	return `# Not found

This path does not exist on jsolly.com.

## Where to go next

- [Home](${origin}/)
- [About](${origin}/about/)
- [Contact](${origin}/contact/)
- [Privacy](${origin}/privacy/)
- [Agent index (llms.txt)](${origin}/llms.txt)
- [Sitemap](${origin}/sitemap-index.xml)
- [Resume (PDF)](${origin}/John-Solly-Resume.pdf)

Request any of those URLs with \`Accept: text/markdown\` to get a Markdown body. The site is a static personal homepage — there is no public API or MCP server.
`;
}

function homeMarkdown(origin: string): string {
	return `# Hi, I'm John Solly

Health-IT Division CTO at Leidos, leading digital modernization for federal health and benefits agencies. This is my personal website.

## About this site

[jsolly.com](${origin}/) is a small static site: who I am, how to reach me, and pointers to the work I publish elsewhere. It is not a product, docs portal, or corporate site for Leidos.

I spent most of my career building spatial systems — at Esri, startups, and federal agencies. I now lead technology strategy for Leidos' Health IT division, supporting agencies such as SSA, VA, and HHS. My primary focus is the convergence of spatial computing and AI: helping machines interpret the physical world and applying that to missions that matter.

### Pages

- [About](${origin}/about/) — background, focus areas, and how I got here
- [Contact](${origin}/contact/) — social profiles and a contact form
- [Privacy](${origin}/privacy/) — data practices for this static site
- [Resume (PDF)](${origin}/John-Solly-Resume.pdf)
- [Blog](https://www.blogthedata.com/) — writing lives on Blogthedata, not here

### For agents

Start at [${origin}/llms.txt](${origin}/llms.txt) for when-to-use guidance and links. Send \`Accept: text/markdown\` on any page URL (or fetch the \`.md\` sibling) to skip the HTML chrome.

## Testimonials

- Taylor Oshan, University of Maryland: "John is a talented geospatial developer and a capable leader"
- Amy Brazil, YellowfinBI: "I'd hire him back in a heartbeat."
- Craig Utley, YellowfinBI: "John delivered for customers, and earned the respect of his peers"
- Meredith Bean, GMU: "John was an extraordinary TA to me as a student in an introductory GIS class."
- Kathryn Thorpe, YellowfinBI: "John is amazingly bright, levelheaded, and goal-oriented."
`;
}

function aboutMarkdown(origin: string): string {
	return `# John Solly

Health-IT Division CTO and software engineer.

A hands-on AI practitioner who transitioned to a CTO role to broaden my impact.

Most of my career has been dedicated to developing spatial systems at Esri, startups, and federal agencies. Currently, I lead technology strategy for Leidos' Health IT division, supporting agencies such as SSA, VA, and HHS.

My primary focus is the convergence of spatial computing and AI, enabling machines to interpret the physical world and applying these capabilities to meaningful missions.

Please [reach out](${origin}/contact/) if you are interested in spatial systems or advancing AI within the federal government.

- [Home](${origin}/)
- [Contact](${origin}/contact/)
- [Resume (PDF)](${origin}/John-Solly-Resume.pdf)
- [Blog](https://www.blogthedata.com/)
`;
}

function contactMarkdown(origin: string): string {
	return `# Contact John Solly

Use this page when you want to get in touch about spatial computing, GIS, applied AI, or federal health IT (SSA, VA, HHS). I am glad to hear from other technical leaders and from engineers who care about craft.

This site does not publish a public inbox address. Use Say Hello on the HTML contact page (Mailchimp) or the profiles below.

## Profiles

- [GitHub](https://github.com/jsolly)
- [LinkedIn](https://www.linkedin.com/in/jsolly/)
- [X](https://x.com/_jsolly)
- [YouTube](https://www.youtube.com/channel/UCxsK9UorVj2F17DMSXLuSQw)
- [Blogthedata](https://www.blogthedata.com/)

## Other pages

- [Home](${origin}/)
- [About](${origin}/about/)
- [Privacy](${origin}/privacy/)
- [Agent index (llms.txt)](${origin}/llms.txt)
`;
}

function privacyMarkdown(origin: string): string {
	return `# Privacy Policy & Data Practices

Last updated: June 2026

jsolly.com is the personal website of John Solly. It is a static site with no analytics or advertising trackers, and it does not collect personal information directly.

## Contact form

If you reach out through the contact link, your message is handled by Mailchimp (an Intuit company) and is subject to Mailchimp's privacy policy. Please don't send anything you wouldn't want stored there.

## Hosting & logs

The site is hosted on Vercel, which may record standard server and CDN logs (such as IP address and user agent) for security and operations, per Vercel's privacy policy.

## Cookies

This site sets no first-party tracking cookies.

## Questions

Questions about this policy? [Get in touch](${origin}/contact/).
`;
}

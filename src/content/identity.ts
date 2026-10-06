// John's role and the site's self-description, in the J18 wording of the
// blogthedata merge plan, shared by every page, the JSON-LD and the agent
// Markdown. public/llms.txt cannot import them; a unit test holds it to them.
export const UNIT = "Enterprise Health";
export const EMPLOYER = "Leidos Digital";
// The formal title (JSON-LD jobTitle).
export const JOB_TITLE = `CTO, ${UNIT}, ${EMPLOYER}`;
// The title in prose: "John Solly, CTO of Enterprise Health at Leidos Digital".
export const ROLE = `CTO of ${UNIT} at ${EMPLOYER}`;
// The short label under his name.
export const SHORT_ROLE = `CTO, ${UNIT} & Software Engineer`;
// The role in a page <title> that already names him elsewhere.
export const TITLE_ROLE = `${UNIT} CTO`;
export const ROLE_STRATEGY = `lead technology strategy for ${UNIT} at ${EMPLOYER}`;

export const BLOG_DESCRIPTION =
	"articles about geospatial development, web development, AI and productivity";
export const RECIPES_DESCRIPTION =
	"easy meals and smoothies, with serving scaling and appliance filters";

// Markdown negotiation (PA3, J11): only the five portfolio pages have a
// Markdown variant; real /blog/ and /recipes/ routes return HTML.
export const MARKDOWN_PAGES = "home, about, contact, privacy or terms";
export const HTML_ONLY_PAGES = "blog and recipe pages are HTML only";

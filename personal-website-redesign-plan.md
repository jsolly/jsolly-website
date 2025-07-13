# Personal Website Redesign Implementation Roadmap

This document is a template for creating a detailed implementation plan. It will be used by an AI agent to automatically implement features or perform refactoring tasks. The agent will follow the steps sequentially to ensure a successful outcome.

---

## 1. Problem Statement

The current website design resembles a generic, "fake" landing page. The goal is to redesign the homepage to give it a more personal and authentic feel, better showcasing the user's identity and work.

---

## 2. Definition of Done

- [ ] The homepage (`index.astro`) is redesigned to move away from the generic 2x3 card grid layout.
- [ ] A new "hero" section is created with a personal introduction and a professional photo.
- [ ] A "Featured Projects" section is added to the homepage to directly showcase work.
- [ ] The new design is responsive and maintains or improves user experience.
- [ ] All existing pages remain accessible through navigation.

---

## 3. Out of Scope

- A complete redesign of pages other than the homepage.
- Changes to the existing color palette or typography, unless necessary for the new layout.
- Creation of new content (e.g., new project write-ups or blog posts).

---

## 4. Execution Plan

### Phase 1: Planning and Component Scaffolding
- [ ] **Task 1.1:** Create new components for the homepage sections: `src/components/home/Hero.astro` for the introduction and `src/components/home/FeaturedProjects.astro` for the project showcase.
- [ ] **Task 1.2:** In `Hero.astro`, add a personal greeting, a brief bio, and a headshot. Use existing assets like `src/images/jsollyLarge.webp`.
- [ ] **Task 1.3:** In `FeaturedProjects.astro`, set it up to fetch and display a selection of projects from `src/content/projects/`.

### Phase 2: Homepage Implementation
- [ ] **Task 2.1:** Modify `src/pages/index.astro` to remove the existing `LinkCard` grid.
- [ ] **Task 2.2:** Integrate the new `Hero.astro` and `FeaturedProjects.astro` components into `index.astro`.
- [ ] **Task 2.3:** Ensure the layout is clean, logical, and guides the user through the content.

### Phase 3: Styling and Refinement
- [ ] **Task 3.1:** Apply styles using Tailwind CSS to ensure the new components are visually appealing and consistent with the site's overall design.
- [ ] **Task 3.2:** Verify that the new homepage is fully responsive across different screen sizes.
- [ ] **Task 3.3:** Add a "View All Projects" link or button to the `FeaturedProjects` section that navigates to the main projects or showcase page.

---

## 5. Technical Details

### Files to Modify
- `src/pages/index.astro`: To replace the current layout with the new component-based structure.
- `src/components/LinkCard.astro`: This component might be deprecated on the homepage but could be used elsewhere.

### New Files to Create
- `personal-website-redesign-plan.md`: This implementation plan.
- `src/components/home/Hero.astro`: A new component for the personal introduction/hero section.
- `src/components/home/FeaturedProjects.astro`: A new component to display a gallery of featured projects.

### Key Dependencies
- `Astro`: The core framework, no new dependencies needed.
- `Tailwind CSS`: For styling, no new dependencies needed.

---

## 6. Risks and Mitigations

| Risk | Impact | Mitigation Plan |
|------|--------|-----------------|
| New design does not align with user's taste. | Medium | The redesign is based on common patterns for personal sites. The user can provide feedback after the initial implementation. |
| Breaking links to other pages. | High | All existing pages will be linked from the main navigation or a footer menu, ensuring no dead ends are created. A "View All" link will also be provided for projects. |

--- 
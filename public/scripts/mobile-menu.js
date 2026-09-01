const mobileMenuButton = document.getElementById("mobile-menu-button");
const mobileMenu = document.getElementById("mobile-menu");

if (mobileMenuButton && mobileMenu) {
	mobileMenuButton.addEventListener("click", () => {
		const isExpanded =
			mobileMenuButton.getAttribute("aria-expanded") === "true";
		mobileMenuButton.setAttribute("aria-expanded", (!isExpanded).toString());
		mobileMenu.classList.toggle("hidden");
	});
}

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			colors: {
				// Modern primary palette - now grayscale for black-and-white look
				primary: {
					50: "#fafafa",
					100: "#f5f5f5",
					200: "#e5e5e5",
					300: "#d4d4d4",
					400: "#a3a3a3",
					500: "#737373",
					600: "#404040",
					700: "#262626",
					800: "#171717",
					900: "#0a0a0a",
				},
				// Accent is now a subtle light gray
				accent: {
					50: "#f7fafc",
					100: "#f1f1f1",
					200: "#e2e2e2",
					300: "#cccccc",
					400: "#b3b3b3",
					500: "#8c8c8c",
					600: "#666666",
					700: "#4d4d4d",
					800: "#333333",
					900: "#1a1a1a",
				},
				// Minimal blue for rare accent use only
				blue: {
					500: "#2563eb", // Only this blue is kept for rare accents
				},
				// Neutral grays with better contrast
				neutral: {
					50: "#fafafa",
					100: "#f5f5f5",
					200: "#e5e5e5",
					300: "#d4d4d4",
					400: "#a3a3a3",
					500: "#737373",
					600: "#525252",
					700: "#404040",
					800: "#262626",
					900: "#171717",
					950: "#0a0a0a",
				},
				// Semantic colors
				background: "#fafafa", // Neutral 50
				card: "#ffffff",
				text: {
					primary: "#171717", // Neutral 900
					secondary: "#525252", // Neutral 600
					muted: "#737373", // Neutral 500
				},
				border: "#e5e5e5", // Neutral 200
				success: "#10b981", // Emerald 500
				warning: "#f59e0b", // Amber 500
				error: "#ef4444", // Red 500
			},
			fontFamily: {
				// Modern font stack with better readability
				sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
				body: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
				heading: [
					"Poppins",
					"Inter",
					"ui-sans-serif",
					"system-ui",
					"sans-serif",
				],
				mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
			},
			// Enhanced spacing and sizing
			spacing: {
				18: "4.5rem",
				88: "22rem",
			},
			// Modern border radius
			borderRadius: {
				xl: "1rem",
				"2xl": "1.5rem",
				"3xl": "2rem",
			},
			// Enhanced shadows for depth
			boxShadow: {
				soft: "0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)",
				medium:
					"0 4px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
				large:
					"0 10px 40px -10px rgba(0, 0, 0, 0.15), 0 2px 10px -2px rgba(0, 0, 0, 0.05)",
			},
			// Smooth transitions
			transitionDuration: {
				400: "400ms",
				600: "600ms",
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ivq: {
          bg: "#050d21",
          card: "rgba(10, 25, 55, 0.55)",
          border: "rgba(120, 160, 255, 0.15)",
          accent: "#2962ff",
          text: "#dce8ff",
          muted: "#8ca4cf",
        },
      },
    },
  },
  plugins: [],
};

export default config;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // ── Neo-brutalism palette ──
        deep:        '#2198a8',
        teal:        '#1a7d8f',
        borteal:     '#9f9065',
        liteal:      '#ede8d8',
        tealBg:      '#d4eff3',
        chatBg:      '#ffffff',
        surface:     '#ede8d8',
        surfaceAlt:  '#ecdcc0',
        textPrimary: '#2a2a2a',
        muted:       '#9f9065',
        textMuted:   '#9f9065',
        textSubtle:  '#8a7850',
        accent:      '#2198a8',
        accentBg:    '#d4eff3',
        danger:      '#e53e3e',
        nbDark:      '#2a2a2a',
      },
    },
  },
  plugins: [],
};

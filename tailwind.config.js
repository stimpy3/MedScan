/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors:{
        primary:'#1E40AF',
        secondary:'#F59E0B',
        accent:'#10B981',
        background:'#F3F4F6',
        textPrimary:'#111827',
        textSecondary:'#6B7280',
      }
    },
  },
  plugins: [],
}


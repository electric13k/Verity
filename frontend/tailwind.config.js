/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        matcha: '#809671',
        pistache: '#B3B792',
        chai: '#D2AB80',
        carob: '#725C3A',
        almond: '#E5E0D8',
        vanilla: '#E5D2B8',
        canvas: '#120E09',
        surface: {
          0: '#1A1410',
          1: '#231C14',
          2: '#2E2318',
        }
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        zentra: {
          primary: '#1E3A8A', // Deep Navy
          secondary: '#D97706', // High-Contrast Amber
          surface: '#F8FAFC',
          dark: '#0F172A',
        },
      },
    },
  },
  plugins: [],
};

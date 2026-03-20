/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './**/*.{js,ts,jsx,tsx}',
    '!./node_modules/**',
  ],
  theme: {
    extend: {
      screens: {
        xs: '400px',
      },
      colors: {
        gamma: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#079271',
          400: '#059669',
          500: '#034334',
          600: '#022C22',
          700: '#022C22',
          800: '#011f18',
          900: '#011610',
        },
        hospital: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          900: '#0c4a6e',
        },
      },
    },
  },
  plugins: [],
};

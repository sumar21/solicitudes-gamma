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
        hospital: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          900: '#0c4a6e',
        },
        mattermost: {
          sidebar: '#1d1f27',
          bg: '#ffffff',
          header: '#ffffff',
        },
      },
    },
  },
  plugins: [],
};

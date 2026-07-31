/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './login.html',
    './app/**/*.{html,js}',
    './js/**/*.{html,js}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1d4ed8',
        secondary: '#f59e0b',
        accent: '#10b981'
      }
    }
  },
  plugins: []
};

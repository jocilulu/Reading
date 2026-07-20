/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif',
        ],
        serif: ['Georgia', 'Songti SC', 'SimSun', 'serif'],
      },
      colors: {
        ink: {
          50: '#f7f6f3',
          100: '#efeeea',
          200: '#e3e2dd',
          700: '#37352f',
          800: '#2f2e2b',
          900: '#191918',
        },
      },
      maxWidth: {
        article: '680px',
      },
    },
  },
  plugins: [],
}

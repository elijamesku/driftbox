import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['Input Mono', 'Cascadia Code', 'Consolas', 'Courier New', 'monospace'],
        monoCondensed: ['InputMonoCondensed', 'Input Mono', 'monospace'],
        monoNarrow: ['InputMonoNarrow', 'Input Mono', 'monospace'],
      },
      colors: {
        // Min Theme inspired color system
        bg: {
          DEFAULT: '#1E1E1E',
          raised: '#252526',
        },
        surface: {
          1: '#2D2D2D',
          2: '#333333',
          3: '#3C3C3C',
        },
        text: {
          primary: '#D4D4D4',
          secondary: '#A6A6A6',
          muted: '#808080',
        },
        accent: {
          blue: '#A855F7', // Brighter purple like the screenshot (rgb(168, 85, 247))
          purple: '#A855F7', // Brighter purple (alias)
          green: '#6A9955',
          orange: '#CE9178',
          yellow: '#D7BA7D',
          red: '#F44747',
        },
        border: '#3C3C3C',
        sel: '#264F78',
      },
      borderRadius: {
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        card: '0 4px 8px rgba(0,0,0,0.4)',
        glow: '0 0 8px rgba(92, 75, 153, 0.2)', // Subtle midnight purple glow
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      animation: {
        'gradient': 'gradient 8s ease infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slideIn 150ms ease-out',
        'fade-in': 'fadeIn 120ms ease-out',
      },
      keyframes: {
        gradient: {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center'
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center'
          },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      typography: {
        DEFAULT: {
          css: {
            // Remove syntax highlighting colors - use uniform text color
            'code::before': {
              content: '""'
            },
            'code::after': {
              content: '""'
            },
            'code': {
              color: '#d4d4d4',  // Uniform gray color for all code text
              backgroundColor: 'transparent',
              fontWeight: '400',
            },
            'pre code': {
              color: '#d4d4d4',  // Uniform gray for code inside pre blocks
            },
            'pre': {
              color: '#d4d4d4',  // Uniform color for all pre content
              backgroundColor: '#181818',
            },
            // Remove default link colors in code
            'a code': {
              color: '#d4d4d4',
            },
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
export default config


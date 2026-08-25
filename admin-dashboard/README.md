# Admin Dashboard PWA

A Progressive Web App built with React, TypeScript, and Tailwind CSS.

## Features

- ⚛️ React 18 with TypeScript
- 🎨 Tailwind CSS for styling
- 📱 PWA support with service worker
- ⚡ Vite for fast development and building
- 🔥 Hot Module Replacement (HMR)

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

Build for production:

```bash
npm run build
```

The production build will be in the `dist` directory.

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

## PWA Features

This app is configured as a Progressive Web App with:

- Service worker for offline support
- Web app manifest
- Auto-update on new versions
- Installable on mobile and desktop devices

## Project Structure

```
admin-dashboard/
├── src/
│   ├── App.tsx          # Main app component
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles with Tailwind
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration with PWA plugin
├── tailwind.config.js   # Tailwind CSS configuration
└── package.json         # Dependencies and scripts
```

## Next Steps

- Add routing (React Router)
- Set up state management (Redux, Zustand, etc.)
- Add authentication
- Create admin dashboard components
- Connect to your backend API

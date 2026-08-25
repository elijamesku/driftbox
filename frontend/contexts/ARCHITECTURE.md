# Context Provider Architecture

## 📐 Clean Folder Structure

```
frontend/
├── contexts/                          # ✅ All context-related code in one place
│   ├── AuthContext.tsx               # Authentication context
│   ├── GitHubContext.tsx             # GitHub context
│   ├── index.tsx                     # Providers wrapper + re-exports
│   ├── README.md                     # Full documentation
│   ├── QUICK_START.md                # Quick start guide
│   ├── EXAMPLES.md                   # Usage examples
│   └── ARCHITECTURE.md               # This file
│
├── app/
│   └── layout.tsx                    # Imports: { Providers } from '@/contexts'
│
└── components/
    └── [your components use hooks from '@/contexts']
```

## 🎯 Why This Structure?

### ✅ **Benefits**

1. **Co-location**: All context-related code lives in one directory
2. **Clean imports**: Single import point via `index.tsx`
3. **Discoverability**: Easy to find all contexts in one place
4. **Maintainability**: Add new contexts easily without touching `app/`
5. **Separation of concerns**: `app/` stays focused on routing/layout

### ❌ **Previous Structure (Before)**

```
frontend/
├── contexts/
│   ├── AuthContext.tsx
│   └── GitHubContext.tsx
├── app/
│   └── providers.tsx              # ❌ Separated from contexts
```

**Problems:**
- Provider wrapper separated from actual contexts
- Two places to look for context code
- Less intuitive import path

### ✅ **New Structure (After)**

```
frontend/
├── contexts/
│   ├── AuthContext.tsx
│   ├── GitHubContext.tsx
│   └── index.tsx                  # ✅ Everything together
```

**Benefits:**
- Single source of truth
- Clean barrel exports via `index.tsx`
- Natural import: `from '@/contexts'`

## 📦 Import Patterns

### Recommended (using barrel exports)

```typescript
// ✅ Import hooks from index
import { useAuth, useGitHub } from '@/contexts'

// ✅ Import Providers for layout
import { Providers } from '@/contexts'
```

### Also Valid (direct imports)

```typescript
// ✅ Direct import if you prefer
import { useAuth } from '@/contexts/AuthContext'
import { useGitHub } from '@/contexts/GitHubContext'
```

## 🏗️ Component Hierarchy

```
app/layout.tsx (Server Component)
│
└─ <Providers> from @/contexts/index.tsx (Client Component)
   │
   ├─ <AuthProvider> from @/contexts/AuthContext.tsx
   │  │
   │  └─ <GitHubProvider> from @/contexts/GitHubContext.tsx
   │     │
   │     └─ {children} (Your app pages & components)
```

## 🔄 Data Flow

```
1. User visits app
   └─> app/layout.tsx renders
       └─> <Providers> wraps children
           └─> AuthProvider initializes
               ├─> Reads token from localStorage
               ├─> Fetches user data from API
               └─> GitHubProvider initializes
                   └─> Reads GitHub token from user data
                       └─> App renders with auth state

2. Component uses context
   └─> import { useAuth } from '@/contexts'
       └─> const { user, token } = useAuth()
           └─> Access to auth state anywhere in tree
```

## 📋 Adding New Contexts

To add a new context (e.g., `SettingsContext`):

1. **Create the context file**: `contexts/SettingsContext.tsx`

```typescript
'use client'
import { createContext, useContext } from 'react'

interface SettingsContextType {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // ... implementation
  return <SettingsContext.Provider value={...}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within SettingsProvider')
  return context
}
```

2. **Add to `contexts/index.tsx`**:

```typescript
'use client'

import { AuthProvider } from './AuthContext'
import { GitHubProvider } from './GitHubContext'
import { SettingsProvider } from './SettingsContext' // ← Add import

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>           {/* ← Add provider */}
      <AuthProvider>
        <GitHubProvider>
          {children}
        </GitHubProvider>
      </AuthProvider>
    </SettingsProvider>
  )
}

export { useAuth } from './AuthContext'
export { useGitHub } from './GitHubContext'
export { useSettings } from './SettingsContext' // ← Add export
```

3. **Use anywhere**:

```typescript
import { useSettings } from '@/contexts'

function MyComponent() {
  const { theme, setTheme } = useSettings()
  // ...
}
```

## 🎨 Best Practices

### 1. **Keep contexts focused**
- Each context has a single responsibility
- Don't mix unrelated state

### 2. **Use barrel exports**
- Export everything from `index.tsx`
- Provides clean import experience

### 3. **Type everything**
- Full TypeScript types for all contexts
- Improves DX and catches errors

### 4. **Document your contexts**
- Add JSDoc comments to providers
- Document hook return types

### 5. **Test context consumers**
- Easy to mock contexts in tests
- Wrap components in test providers

## 📊 Comparison with Other Patterns

### Context vs Redux

| Feature | Context | Redux |
|---------|---------|-------|
| Setup complexity | ✅ Simple | ❌ Complex |
| Boilerplate | ✅ Minimal | ❌ Verbose |
| DevTools | ❌ Limited | ✅ Excellent |
| Performance | ✅ Good* | ✅ Excellent |
| Learning curve | ✅ Easy | ❌ Steep |

*With proper memoization

### Context vs Zustand

| Feature | Context | Zustand |
|---------|---------|---------|
| Setup | ✅ Native React | ✅ Simple |
| TypeScript | ✅ Built-in | ✅ Excellent |
| Bundle size | ✅ 0 bytes | ⚠️ ~1KB |
| React integration | ✅ Native | ✅ Hooks |
| Outside React | ❌ No | ✅ Yes |

## 🚀 Performance Tips

### 1. Split contexts by update frequency

```typescript
// ✅ Good: Separate fast-changing and slow-changing state
<AuthProvider>        {/* Rarely updates */}
  <ThemeProvider>     {/* Occasionally updates */}
    <RealtimeProvider> {/* Frequently updates */}
      {children}
    </RealtimeProvider>
  </ThemeProvider>
</AuthProvider>
```

### 2. Memoize context values

```typescript
const value = useMemo(() => ({
  user,
  login,
  logout
}), [user]) // Only recreate when user changes
```

### 3. Split large contexts

```typescript
// ❌ Bad: One giant context
<AppContext> {/* Everything in one */}

// ✅ Good: Focused contexts
<AuthContext>
  <GitHubContext>
    <SettingsContext>
```

## 🔍 Debugging

### Check context availability

```typescript
function DebugAuth() {
  const auth = useAuth()
  console.log('Auth state:', auth)
  return null
}

// Add to your app temporarily
<Providers>
  <DebugAuth />
  {children}
</Providers>
```

### React DevTools

Look for:
- `AuthContext.Provider`
- `GitHubContext.Provider`

In the component tree to verify providers are mounted.

## 📚 Additional Resources

- [React Context Documentation](https://react.dev/reference/react/useContext)
- [Next.js Context Best Practices](https://nextjs.org/docs/getting-started/react-essentials#context)
- [Kent C. Dodds - Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react)

## ✨ Summary

This architecture provides:
- ✅ Clean, organized structure
- ✅ Easy to understand and maintain
- ✅ Scalable for future contexts
- ✅ Type-safe throughout
- ✅ Follows React/Next.js best practices
- ✅ Developer-friendly API

All context code lives in `contexts/` with a single import point via `index.tsx`. Simple, clean, and effective! 🎉


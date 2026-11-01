import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base を相対パスにしておくと、Capacitor などでスマホアプリに包むときもそのまま動く
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});

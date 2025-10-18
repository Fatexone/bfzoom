// src/components/video/VideoCall/VideoFooter.tsx
"use client";

export default function VideoFooter() {
  return (
    <footer className="w-full text-center py-3 bg-black/40 border-t border-white/10 text-gray-400 text-xs">
      <p>© {new Date().getFullYear()} — BFZoom. Tous droits réservés.</p>
    </footer>
  );
}

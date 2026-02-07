"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Maximize,
  PhoneOff,
  Sparkles,
} from "lucide-react";

interface VideoControlsProps {
  isMuted: boolean;
  cameraOn: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onFullscreen: () => void;
  onLeave: () => void;
  onToggleBlur?: () => void;
  isBlurOn?: boolean;
}

/* =======================================================
   🎛️ CONTROLS — Mute / Caméra / Plein écran / Quitter
   Responsive et tactile (iPhone, iPad, Desktop)
======================================================= */
export default function VideoControls({
  isMuted,
  cameraOn,
  onToggleMute,
  onToggleCamera,
  onFullscreen,
  onLeave,
  onToggleBlur,
  isBlurOn = false,
}: VideoControlsProps) {
  const constraintsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [dockKey, setDockKey] = useState<
    "bottom-center" | "bottom-left" | "bottom-right" | "top-center"
  >("bottom-center");
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);

  const computeDockPositions = useCallback(() => {
    const container = constraintsRef.current;
    const menu = menuRef.current;
    if (!container || !menu) return null;

    const containerRect = container.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 16;

    const positions = {
      "bottom-center": {
        x: Math.max(0, (containerRect.width - menuRect.width) / 2),
        y: Math.max(0, containerRect.height - menuRect.height - margin),
      },
      "bottom-left": {
        x: margin,
        y: Math.max(0, containerRect.height - menuRect.height - margin),
      },
      "bottom-right": {
        x: Math.max(0, containerRect.width - menuRect.width - margin),
        y: Math.max(0, containerRect.height - menuRect.height - margin),
      },
      "top-center": {
        x: Math.max(0, (containerRect.width - menuRect.width) / 2),
        y: margin,
      },
    };

    return { positions, containerRect, menuRect };
  }, []);

  const snapToDock = useCallback(
    (nextKey: typeof dockKey) => {
      const data = computeDockPositions();
      if (!data) return;
      setDockKey(nextKey);
      setDockPos(data.positions[nextKey]);
    },
    [computeDockPositions]
  );

  const handleDragEnd = useCallback(() => {
    const data = computeDockPositions();
    if (!data || !menuRef.current) return;

    const { positions, containerRect } = data;
    const menuRectNow = menuRef.current.getBoundingClientRect();
    const current = {
      x: menuRectNow.left - containerRect.left,
      y: menuRectNow.top - containerRect.top,
    };

    const entries = Object.entries(positions) as Array<[typeof dockKey, { x: number; y: number }]>;
    const nearest = entries.reduce(
      (acc, [key, pos]) => {
        const dx = current.x - pos.x;
        const dy = current.y - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist < acc.dist) return { key, dist };
        return acc;
      },
      { key: dockKey, dist: Number.POSITIVE_INFINITY }
    );

    setDockKey(nearest.key);
    setDockPos(positions[nearest.key]);
  }, [computeDockPositions, dockKey]);

  useEffect(() => {
    queueMicrotask(() => {
      snapToDock(dockKey);
    });
  }, [dockKey, snapToDock]);

  useEffect(() => {
    const handleResize = () => snapToDock(dockKey);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [dockKey, snapToDock]);

  const controls = [
    {
      label: isMuted ? "Réactiver micro" : "Couper micro",
      icon: isMuted ? MicOff : Mic,
      action: onToggleMute,
      color: isMuted ? "bg-red-600 hover:bg-red-700" : "bg-sky-600 hover:bg-sky-700",
    },
    {
      label: cameraOn ? "Couper caméra" : "Allumer caméra",
      icon: cameraOn ? Video : VideoOff,
      action: onToggleCamera,
      color: cameraOn
        ? "bg-sky-600 hover:bg-sky-700"
        : "bg-red-600 hover:bg-red-700",
    },
    {
      label: "Plein écran",
      icon: Maximize,
      action: onFullscreen,
      color: "bg-blue-600 hover:bg-blue-700",
    },
    ...(onToggleBlur
      ? [
          {
            label: isBlurOn ? "Flou actif" : "Flou arrière-plan",
            icon: Sparkles,
            action: onToggleBlur,
            color: isBlurOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700",
          },
        ]
      : []),
    {
      label: "Quitter",
      icon: PhoneOff,
      action: onLeave,
      color: "bg-red-700 hover:bg-red-800",
    },
  ];

  return (
    <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40">
      <motion.div
        ref={menuRef}
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.12}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        style={dockPos ? { x: dockPos.x, y: dockPos.y } : undefined}
        className="
          pointer-events-auto
          fixed left-0 top-0
          flex flex-col items-center gap-2
          bg-white/80 backdrop-blur-md
          border border-sky-200 shadow-lg
          px-4 sm:px-6 py-3 rounded-2xl
        "
      >
        <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
          {controls.map(({ label, icon: Icon, action, color }) => (
            <motion.button
              key={label}
              onClick={action}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className={`
                flex flex-col items-center justify-center gap-1
                ${color} text-white rounded-xl
                px-3 py-2 sm:px-4 sm:py-3
                shadow-md select-none
                active:scale-95
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-sky-300/60
              `}
            >
              <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
              <span className="text-[10px] sm:text-xs font-medium">{label}</span>
            </motion.button>
          ))}
        </div>
        <button
          onClick={() => snapToDock("bottom-center")}
          className="
            text-xs text-slate-600 hover:text-slate-800
            px-2 py-1 rounded-lg
            border border-slate-200 bg-white/80
          "
        >
          Recentrer
        </button>
      </motion.div>
    </div>
  );
}
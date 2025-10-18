"use client";

import { useState, useEffect, useRef } from "react";
import * as bodyPix from "@tensorflow-models/body-pix";
import "@tensorflow/tfjs";
import { motion } from "framer-motion";
import { Upload, Image as ImageIcon, Droplets, Sparkles, Loader2 } from "lucide-react";

interface Props {
  videoEffect: string;
  setVideoEffect: (effect: string) => void;
}

export default function VideoEffects({ videoEffect, setVideoEffect }: Props) {
  const [background, setBackground] = useState<string>("none");
  const [blurLevel, setBlurLevel] = useState<number>(5);
  const [model, setModel] = useState<bodyPix.BodyPix | null>(null);
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /* =====================================================
     📦 Charger le modèle BodyPix
  ===================================================== */
  useEffect(() => {
    (async () => {
      const loadedModel = await bodyPix.load();
      setModel(loadedModel);
      console.log("✅ BodyPix chargé !");
    })();
  }, []);

  /* =====================================================
     🎥 Démarrer la caméra (sécurisé)
  ===================================================== */
  useEffect(() => {
    let isMounted = true;
    let stream: MediaStream | null = null;

    const setupCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          el.onloadeddata = () => setVideoReady(true);
        }
      } catch (err) {
        console.error("❌ Erreur caméra :", err);
      }
    };

    setupCamera();

    return () => {
      isMounted = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /* =====================================================
     🔄 Synchronisation parent -> local
  ===================================================== */
  useEffect(() => {
    if (videoEffect.startsWith("custom:")) {
      const url = videoEffect.slice("custom:".length);
      setCustomBg(url);
      setBackground("custom");
    } else {
      setBackground(videoEffect || "none");
    }
  }, [videoEffect]);

  /* =====================================================
     ✨ Application BodyPix (sécurisée)
  ===================================================== */
  useEffect(() => {
    if (!model || !videoRef.current || !canvasRef.current) return;

    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;
    const ctx = canvasEl.getContext("2d");
    const bgImage = new Image();
    let isCancelled = false;

    const startSegmentation = () => {
      if (!videoEl.videoWidth || !videoEl.videoHeight) {
        requestAnimationFrame(startSegmentation);
        return;
      }

      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;

      const renderFrame = async () => {
        if (isCancelled || !ctx) return;

        try {
          const segmentation = await model.segmentPerson(videoEl, {
            internalResolution: "medium",
            segmentationThreshold: 0.7,
          });

          const mask = segmentation.data;
          ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
          const frame = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
          const pixels = frame.data;

          if (background === "blur") {
            for (let i = 0; i < mask.length; i++) {
              if (mask[i] === 0) {
                const idx = i * 4;
                pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = 180 + blurLevel * 2;
              }
            }
            ctx.putImageData(frame, 0, 0);
          } else if (
            (background === "custom" && customBg) ||
            (background !== "none" && background !== "blur")
          ) {
            if (background === "custom" && customBg) bgImage.src = customBg;
            else bgImage.src = background;

            if (bgImage.complete) ctx.drawImage(bgImage, 0, 0, canvasEl.width, canvasEl.height);

            for (let i = 0; i < mask.length; i++) {
              if (mask[i] === 1) {
                const idx = i * 4;
                const x = i % canvasEl.width;
                const y = Math.floor(i / canvasEl.width);
                const r = pixels[idx];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];
                const a = pixels[idx + 3];
                const imgData = ctx.createImageData(1, 1);
                imgData.data.set([r, g, b, a]);
                ctx.putImageData(imgData, x, y);
              }
            }
          } else {
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
          }
        } catch (err) {
          console.warn("⚠️ Erreur BodyPix frame :", err);
        }

        requestAnimationFrame(renderFrame);
      };

      renderFrame();
    };

    if (videoEl.readyState >= 2) startSegmentation();
    else videoEl.addEventListener("loadeddata", startSegmentation);

    return () => {
      isCancelled = true;
      videoEl.removeEventListener("loadeddata", startSegmentation);
    };
  }, [model, background, blurLevel, customBg]);

  /* =====================================================
     🖼️ Upload d’un fond personnalisé
  ===================================================== */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCustomBg(url);
    setBackground("custom");
    setVideoEffect(`custom:${url}`);
  };

  /* =====================================================
     🧭 Choix d’effet
  ===================================================== */
  const selectEffect = (effect: string) => {
    setBackground(effect);
    setVideoEffect(effect);
  };

  /* =====================================================
     🎨 Interface utilisateur
  ===================================================== */
  return (
    <div className="flex flex-col items-center justify-center gap-4 bg-black/40 text-white p-4 rounded-xl w-full max-w-lg mx-auto border border-white/10">
      {/* Aperçu du flux */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/10 shadow-lg bg-black/60">
        {!videoReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 text-sm gap-2 z-10">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p>Connexion caméra...</p>
          </div>
        )}

        {/* Vidéo source (non visible) */}
        <video ref={videoRef} autoPlay playsInline muted className="hidden" />

        {/* Canvas — affichage flou/fond (corrigé) */}
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full object-cover rounded-xl transition-opacity duration-500 pointer-events-none z-0 ${
            videoReady ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      {/* Menu des effets */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2 w-full"
      >
        <button
          onClick={() => selectEffect("none")}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
            background === "none" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
          }`}
        >
          <Sparkles className="w-4 h-4" /> Aucun
        </button>

        <button
          onClick={() => selectEffect("blur")}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
            background === "blur" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
          }`}
        >
          <Droplets className="w-4 h-4" /> Flou
        </button>

        <button
          onClick={() => selectEffect("/backgrounds/beach.jpg")}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
            background === "/backgrounds/beach.jpg"
              ? "bg-blue-600"
              : "bg-gray-700 hover:bg-gray-600 text-gray-200"
          }`}
        >
          <ImageIcon className="w-4 h-4" /> Plage
        </button>

        <button
          onClick={() => selectEffect("/backgrounds/office.jpg")}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
            background === "/backgrounds/office.jpg"
              ? "bg-blue-600"
              : "bg-gray-700 hover:bg-gray-600 text-gray-200"
          }`}
        >
          <ImageIcon className="w-4 h-4" /> Bureau
        </button>

        <label className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 cursor-pointer font-semibold">
          <Upload className="w-4 h-4" /> Perso
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>
      </motion.div>

      {/* Réglage flou */}
      {background === "blur" && (
        <div className="flex items-center justify-center gap-3 mt-2 w-full">
          <label className="text-sm text-gray-300">Intensité</label>
          <input
            type="range"
            min={1}
            max={15}
            value={blurLevel}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setBlurLevel(v);
              setVideoEffect(`blur:${v}`);
            }}
            className="w-2/3 accent-blue-600"
          />
          <span className="text-sm text-gray-300">{blurLevel}</span>
        </div>
      )}
    </div>
  );
}
